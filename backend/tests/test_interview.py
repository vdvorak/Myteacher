import json

import pytest
from pydantic_ai.exceptions import ModelAPIError, ModelHTTPError
from sqlalchemy import select

from myteacher import erasure
from myteacher.assistant import prompts
from myteacher.assistant.generations import GenerationRecord
from myteacher.lesson.catalog import COMPONENT_CATALOG
from myteacher.persistence import open_session
from tests.helpers import TEACHER, TEACHER_PASSWORD, as_student, create_engine_for, sign_in
from tests.test_courses import as_other_teacher, create_course

KEY = "sk-ant-api03-teacherskey-7f3a"
OTHER_KEY = "sk-ant-api03-colleagueskey-91bc"

ROUND_ONE = {
    "step": {
        "kind": "round",
        "questions": [
            {
                "question": "How old are your students?",
                "recommended_answer": "Sixteen, second year of Spanish.",
            },
            {
                "question": "Which sources do you want me to use?",
                "recommended_answer": "Your textbook, chapters 1 to 4.",
            },
        ],
    }
}
ROUND_TWO = {
    "step": {
        "kind": "round",
        "questions": [
            {"question": "Which exercise types do you like?", "recommended_answer": "Cloze."}
        ],
    }
}
BRIEF = {
    "step": {
        "kind": "brief",
        "brief": {
            "audience": "Sixteen-year-olds in their second year of Spanish",
            "level": "A2",
            "preferred_exercise_types": ["cloze", "matching"],
            "feedback_mode": "at_the_end",
        },
        "sources_offered": False,
        "summary": "You offered no sources, so I will generate without sources.",
    }
}


def add_key(client, api_key=KEY) -> None:
    me = client.get("/api/auth/me").json()
    url = f"/api/accounts/{me['id']}/provider-credentials/anthropic"
    assert client.put(url, json={"api_key": api_key}).status_code == 200


def interview_url(course_id: int) -> str:
    return f"/api/courses/{course_id}/interview"


def start(client, course_id):
    return client.post(interview_url(course_id))


def answer(client, course_id, *answers):
    return client.post(f"{interview_url(course_id)}/answers", json={"answers": list(answers)})


def interview(client, course_id) -> dict:
    return client.get(interview_url(course_id)).json()


def job(client, job_id) -> dict:
    return client.get(f"/api/jobs/{job_id}").json()


def generations(settings) -> list[GenerationRecord]:
    with open_session(create_engine_for(settings)) as db:
        records = list(db.scalars(select(GenerationRecord).order_by(GenerationRecord.id)))
        db.expunge_all()
        return records


@pytest.fixture
def course(teacher) -> int:
    add_key(teacher)
    return create_course(teacher).json()["id"]


# Rounds


def test_starting_the_interview_runs_a_job_that_asks_the_first_round(teacher, course, models):
    models.script(ROUND_ONE)

    started = start(teacher, course)

    assert started.status_code == 202
    assert started.json()["job"]["state"] == "queued"
    finished = job(teacher, started.json()["job"]["id"])
    assert finished["state"] == "succeeded"
    assert finished["kind"] == "course_interview"
    assert finished["error_kind"] is None
    body = interview(teacher, course)
    assert body["state"] == "active"
    assert body["job"]["id"] == finished["id"]
    assert body["rounds"] == [
        {
            "number": 1,
            "questions": [
                {
                    "number": 1,
                    "question": "How old are your students?",
                    "recommended_answer": "Sixteen, second year of Spanish.",
                },
                {
                    "number": 2,
                    "question": "Which sources do you want me to use?",
                    "recommended_answer": "Your textbook, chapters 1 to 4.",
                },
            ],
            "answers": None,
        }
    ]


def test_a_course_without_an_interview_has_none(teacher, course):
    assert teacher.get(interview_url(course)).json() is None


def test_answers_produce_the_next_round(teacher, course, models):
    models.script(ROUND_ONE, ROUND_TWO)
    start(teacher, course)

    answered = answer(teacher, course, "Fifteen and sixteen.", "")

    assert answered.status_code == 202
    body = interview(teacher, course)
    assert [r["number"] for r in body["rounds"]] == [1, 2]
    assert body["rounds"][0]["answers"] == ["Fifteen and sixteen.", ""]
    assert body["rounds"][1]["answers"] is None
    # The assistant saw the whole transcript, answers included.
    sent = json.loads(models.requests[-1]["prompt"])
    assert sent["transcript"][0]["answers"] == ["Fifteen and sixteen.", ""]
    assert sent["course"]["taught_language"] == "es"


def test_the_last_answers_produce_a_brief_patch_applied_to_the_brief(teacher, course, models):
    models.script(ROUND_ONE, BRIEF)
    teacher.patch(f"/api/courses/{course}/brief", json={"tone": "Friendly"})
    start(teacher, course)

    answer(teacher, course, "Sixteen.", "None.")

    body = interview(teacher, course)
    assert body["state"] == "finished"
    assert body["sources_offered"] is False
    assert body["summary"] == "You offered no sources, so I will generate without sources."
    brief = teacher.get(f"/api/courses/{course}").json()["brief"]
    assert brief["audience"] == "Sixteen-year-olds in their second year of Spanish"
    assert brief["level"] == "A2"
    assert brief["preferred_exercise_types"] == ["cloze", "matching"]
    assert brief["feedback_mode"] == "at_the_end"
    assert brief["tone"] == "Friendly"  # not in the patch, so kept
    # The brief stays editable afterwards.
    edited = teacher.patch(f"/api/courses/{course}/brief", json={"level": "A2+"})
    assert edited.json()["level"] == "A2+"


def test_a_patched_type_list_wins_over_the_other_one(teacher, course, models):
    teacher.patch(f"/api/courses/{course}/brief", json={"forbidden_exercise_types": ["cloze"]})
    models.script(ROUND_ONE, BRIEF)
    start(teacher, course)

    answer(teacher, course, "a", "b")

    brief = teacher.get(f"/api/courses/{course}").json()["brief"]
    assert brief["preferred_exercise_types"] == ["cloze", "matching"]
    assert brief["forbidden_exercise_types"] == []


def test_after_enough_rounds_the_assistant_must_return_the_brief(
    teacher, course, models, monkeypatch
):
    from myteacher.courses import interview as interviews

    monkeypatch.setattr(interviews, "MAX_ROUNDS", 1)
    # A further round is refused as invalid output, and the retry returns the brief.
    models.script(ROUND_ONE, ROUND_TWO, BRIEF)
    start(teacher, course)

    answer(teacher, course, "a", "b")

    assert interview(teacher, course)["state"] == "finished"
    assert json.loads(models.requests[1]["prompt"])["must_finish"] is True


def test_answers_must_match_the_open_round(teacher, course, models):
    models.script(ROUND_ONE)
    start(teacher, course)

    assert answer(teacher, course, "only one").status_code == 422
    assert answer(teacher, course, "a", "b", "c").status_code == 422
    assert answer(teacher, course, "x" * 5001, "b").status_code == 422
    assert interview(teacher, course)["rounds"][0]["answers"] is None


def test_there_is_nothing_to_answer_without_an_open_round(teacher, course, models):
    assert answer(teacher, course, "a").json() == {"detail": "no_open_round"}
    models.script(ROUND_ONE, BRIEF)
    start(teacher, course)
    answer(teacher, course, "a", "b")

    refused = answer(teacher, course, "a", "b")

    assert refused.status_code == 409
    assert refused.json() == {"detail": "no_open_round"}


def test_one_interview_runs_at_a_time_and_a_new_one_can_follow(teacher, course, models):
    models.script(ROUND_ONE)
    first = start(teacher, course).json()["interview"]["id"]

    refused = start(teacher, course)
    teacher.post(f"{interview_url(course)}/end")
    models.script(ROUND_ONE)
    again = start(teacher, course)

    assert refused.status_code == 409
    assert refused.json() == {"detail": "interview_active"}
    assert again.status_code == 202
    assert again.json()["interview"]["id"] != first


# Ending early


def test_the_interview_is_ended_early_leaving_the_brief_as_it_is(teacher, course, models):
    models.script(ROUND_ONE)
    start(teacher, course)
    before = teacher.get(f"/api/courses/{course}").json()["brief"]

    ended = teacher.post(f"{interview_url(course)}/end")

    assert ended.status_code == 200
    assert ended.json()["state"] == "ended"
    assert teacher.get(f"/api/courses/{course}").json()["brief"] == before
    assert answer(teacher, course, "a", "b").status_code == 409
    assert teacher.patch(f"/api/courses/{course}/brief", json={"level": "B1"}).status_code == 200


def test_ending_without_an_active_interview_is_refused(teacher, course):
    refused = teacher.post(f"{interview_url(course)}/end")

    assert refused.status_code == 409
    assert refused.json() == {"detail": "no_active_interview"}


# Generation records and prompts


def test_every_call_writes_a_generation_record_with_the_manifest_version(
    teacher, course, models, admin_settings
):
    models.script(ROUND_ONE, BRIEF)
    start(teacher, course)
    answer(teacher, course, "a", "b")

    records = generations(admin_settings)

    assert len(records) == 2
    for record in records:
        assert record.task_kind == "course_interview"
        assert record.prompt_version == prompts.current_version("course_interview")
        assert len(record.prompt_hash) == 64
        assert record.provider == "anthropic"
        assert record.model == "claude-opus-5-5"
        assert record.course_id == course
        assert record.status == "succeeded"
        assert record.input_tokens > 0 and record.output_tokens > 0
        assert record.duration_ms >= 0
        assert record.inputs["course"]["name"] == "Španělština 2.B"
    assert records[0].output == ROUND_ONE
    assert records[1].output == BRIEF


def test_prompts_include_the_pedagogy_and_the_catalog(teacher, course, models):
    models.script(ROUND_ONE)
    start(teacher, course)

    instructions = models.requests[0]["instructions"]

    assert "knowledge before skills" in instructions.lower()
    for exercise_type in COMPONENT_CATALOG:
        assert exercise_type in instructions
    assert "{{" not in instructions


def test_the_teachers_own_key_and_strong_slot_pay(teacher, course, models):
    models.script(ROUND_ONE)

    start(teacher, course)

    assert models.calls[-1] == ("anthropic", "claude-opus-5-5", KEY)


def change_meanwhile(settings, course_id, change, then):
    """A scripted answer that first changes the course as the teacher would during the call."""

    def during_the_call():
        from myteacher.courses import interview as interviews
        from myteacher.courses import service as courses

        with open_session(create_engine_for(settings)) as db:
            course = courses.get_course(db, course_id)
            change(db, course, interviews.latest(db, course))
            db.commit()
        return then

    return during_the_call


def test_the_brief_patch_lands_on_the_brief_as_it_is_after_the_call(
    teacher, course, models, admin_settings
):
    from myteacher.courses import service as courses

    def forbid_matching(db, course_row, _):
        courses.change_brief(course_row, {"forbidden_exercise_types": ["matching", "free_text"]})

    models.script(ROUND_ONE, change_meanwhile(admin_settings, course, forbid_matching, BRIEF))
    start(teacher, course)

    answer(teacher, course, "a", "b")

    brief = teacher.get(f"/api/courses/{course}").json()["brief"]
    assert brief["preferred_exercise_types"] == ["cloze", "matching"]
    # The teacher's change during the call is kept, except what the patch now prefers.
    assert brief["forbidden_exercise_types"] == ["free_text"]


def test_an_interview_ended_during_the_call_ignores_the_answer(
    teacher, course, models, admin_settings
):
    def end_it(db, _, interview_row):
        interview_row.state = "ended"

    models.script(ROUND_ONE, change_meanwhile(admin_settings, course, end_it, BRIEF))
    start(teacher, course)
    before = teacher.get(f"/api/courses/{course}").json()["brief"]

    answered = answer(teacher, course, "a", "b").json()

    assert interview(teacher, course)["state"] == "ended"
    assert teacher.get(f"/api/courses/{course}").json()["brief"] == before
    assert job(teacher, answered["job"]["id"])["state"] == "succeeded"


def test_of_two_concurrent_changes_to_an_interview_the_second_is_refused(
    teacher, course, models, admin_settings
):
    from sqlalchemy.orm.exc import StaleDataError

    from myteacher.courses import interview as interviews
    from myteacher.courses import service as courses

    models.script(ROUND_ONE)
    start(teacher, course)
    engine = create_engine_for(admin_settings)

    with open_session(engine) as first, open_session(engine) as second:
        one = interviews.latest(first, courses.get_course(first, course))
        other = interviews.latest(second, courses.get_course(second, course))
        interviews.record_answers(one, ["a", "b"])
        first.commit()
        interviews.end(other)
        with pytest.raises(StaleDataError):
            second.flush()

    assert interview(teacher, course)["rounds"][0]["answers"] == ["a", "b"]
    assert interview(teacher, course)["state"] == "active"


def test_an_interview_started_by_a_concurrent_request_is_refused(
    teacher, course, models, monkeypatch
):
    from myteacher.courses import interview as interviews

    models.script(ROUND_ONE)
    start(teacher, course)
    # Another request started one after this one looked.
    monkeypatch.setattr(interviews, "latest", lambda db, course: None)

    refused = start(teacher, course)

    assert refused.status_code == 409
    assert refused.json() == {"detail": "interview_active"}


def test_every_model_request_has_a_timeout(teacher, course, models):
    models.script(ROUND_ONE)

    start(teacher, course)

    assert models.requests[0]["settings"]["timeout"] == 120


def test_the_generation_record_survives_a_failure_after_the_call(
    teacher, course, models, admin_settings, monkeypatch
):
    from myteacher.courses import interview as interviews

    def broken(*args):
        raise RuntimeError("bug while applying")

    monkeypatch.setattr(interviews, "_land", broken)
    models.script(ROUND_ONE)

    started = start(teacher, course).json()

    assert job(teacher, started["job"]["id"])["error_kind"] == "other"
    (record,) = generations(admin_settings)
    assert record.status == "succeeded"


# Failures


def test_invalid_output_is_retried_once(teacher, course, models):
    models.script({"step": {"kind": "round", "questions": []}}, ROUND_ONE)

    started = start(teacher, course).json()

    assert job(teacher, started["job"]["id"])["state"] == "succeeded"
    assert len(models.requests) == 2


def test_output_invalid_twice_fails_the_job_with_the_raw_output(
    teacher, course, models, admin_settings
):
    bad = {"step": {"kind": "round", "questions": "none"}}
    models.script(bad, bad)

    started = start(teacher, course).json()

    failed = job(teacher, started["job"]["id"])
    assert failed["state"] == "failed"
    assert failed["error_kind"] == "invalid_output"
    assert json.loads(failed["raw_output"]) == bad
    (record,) = generations(admin_settings)
    assert record.status == "failed"
    assert record.error_kind == "invalid_output"
    assert json.loads(record.raw_output) == bad
    assert interview(teacher, course)["rounds"] == []


@pytest.mark.parametrize(
    ("error", "kind"),
    [
        (ModelHTTPError(401, "claude-opus-5-5", {"error": "invalid x-api-key"}), "authentication"),
        (ModelHTTPError(429, "claude-opus-5-5", {"error": "rate_limit"}), "quota"),
        (ModelHTTPError(529, "claude-opus-5-5", {"error": "overloaded"}), "transient"),
        (ModelAPIError("claude-opus-5-5", "connection refused"), "transient"),
        (ModelHTTPError(404, "claude-opus-5-5", {"error": "model not found"}), "other"),
    ],
)
def test_a_provider_failure_fails_the_job_with_its_kind(
    teacher, course, models, admin_settings, error, kind
):
    models.script(error)

    started = start(teacher, course).json()

    failed = job(teacher, started["job"]["id"])
    assert failed["state"] == "failed"
    assert failed["error_kind"] == kind
    assert failed["raw_output"] is None
    (record,) = generations(admin_settings)
    assert record.status == "failed" and record.error_kind == kind


def test_a_failed_step_is_retried_by_the_teacher(teacher, course, models):
    models.script(ModelHTTPError(429, "claude-opus-5-5", {"error": "rate_limit"}))
    start(teacher, course)

    models.script(ROUND_ONE)
    retried = teacher.post(f"{interview_url(course)}/retry")

    assert retried.status_code == 202
    assert job(teacher, retried.json()["job"]["id"])["state"] == "succeeded"
    assert len(interview(teacher, course)["rounds"]) == 1


def test_only_a_failed_step_is_retried(teacher, course, models):
    models.script(ROUND_ONE)
    start(teacher, course)

    refused = teacher.post(f"{interview_url(course)}/retry")

    assert refused.status_code == 409
    assert refused.json() == {"detail": "nothing_to_retry"}


def test_without_a_provider_key_the_interview_does_not_start(teacher):
    cid = create_course(teacher).json()["id"]

    refused = start(teacher, cid)

    assert refused.status_code == 409
    assert refused.json() == {"detail": "no_provider_key"}
    assert teacher.get(interview_url(cid)).json() is None


def test_an_interrupted_job_fails_at_the_next_start(admin_settings, clock, sender, models):
    from fastapi.testclient import TestClient

    from myteacher.app import create_app
    from myteacher.jobs.models import Job

    app = create_app(admin_settings, clock=clock, sender=sender, model_factory=models)
    with TestClient(app):
        pass
    with open_session(create_engine_for(admin_settings)) as db:
        from myteacher.accounts.models import Account

        account_id = db.scalars(select(Account.id)).first()
        db.add(
            Job(account_id=account_id, kind="course_interview", state="running", created_at=clock())
        )
        db.commit()

    with TestClient(app):
        pass

    with open_session(create_engine_for(admin_settings)) as db:
        (stuck,) = db.scalars(select(Job))
        assert stuck.state == "failed"
        assert stuck.error_kind == "interrupted"


# Access


def test_another_teacher_cannot_see_or_run_the_interview(teacher, course, models, sender):
    models.script(ROUND_ONE)
    started = start(teacher, course).json()
    as_other_teacher(teacher, sender)
    add_key(teacher, OTHER_KEY)

    assert teacher.get(interview_url(course)).status_code == 404
    assert start(teacher, course).status_code == 404
    assert answer(teacher, course, "a", "b").status_code == 404
    assert teacher.post(f"{interview_url(course)}/end").status_code == 404
    assert teacher.get(f"/api/jobs/{started['job']['id']}").status_code == 404


def test_a_viewer_reads_the_interview_but_cannot_run_it(
    teacher, course, models, sender, monkeypatch
):
    from myteacher.api import courses as courses_api

    models.script(ROUND_ONE)
    started = start(teacher, course).json()
    as_other_teacher(teacher, sender)
    add_key(teacher, OTHER_KEY)
    monkeypatch.setattr(courses_api, "can_view_course", lambda actor, course: True)

    assert interview(teacher, course)["state"] == "active"
    assert job(teacher, started["job"]["id"])["state"] == "succeeded"
    assert answer(teacher, course, "a", "b").status_code == 403
    assert teacher.post(f"{interview_url(course)}/end").status_code == 403
    assert teacher.post(f"{interview_url(course)}/retry").status_code == 403


def test_an_editor_answers_on_their_own_key(teacher, course, models, sender, monkeypatch):
    from myteacher.api import courses as courses_api

    models.script(ROUND_ONE, ROUND_TWO)
    start(teacher, course)
    as_other_teacher(teacher, sender)
    add_key(teacher, OTHER_KEY)
    monkeypatch.setattr(courses_api, "can_view_course", lambda actor, course: True)
    monkeypatch.setattr(courses_api, "can_edit_course", lambda actor, course: True)

    assert answer(teacher, course, "a", "b").status_code == 202

    assert models.calls[-1][2] == OTHER_KEY


def test_students_cannot_reach_the_interview(teacher, course, sender):
    as_student(teacher, sender)

    assert teacher.get(interview_url(course)).status_code == 403
    assert start(teacher, course).status_code == 403


def test_interview_tables_hold_no_student_data(teacher, course):
    tables = {rule.table for rule in erasure.rules()}

    assert not {"interview", "job"} & tables
    # Generation records hold student data only when assessing an open answer, and name the
    # student then (test_open_assessment); an interview's records name none.
    teacher.cookies.clear()
    sign_in(teacher, TEACHER, TEACHER_PASSWORD)
