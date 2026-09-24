import json

import pytest

from myteacher.assistant import prompts
from myteacher.persistence import open_session
from tests.helpers import create_engine_for
from tests.test_concept_maps import PROPOSAL, map_url
from tests.test_course_access import COLLEAGUE, as_teacher, grant, invite_teachers
from tests.test_courses import create_course
from tests.test_interview import BRIEF, ROUND_ONE, add_key, generations, job
from tests.test_interview import answer as answer_course_round
from tests.test_interview import start as start_course_interview
from tests.test_topics import add, topics_url

TOPIC_ROUND = {
    "step": {
        "kind": "round",
        "questions": [
            {
                "question": "Do your students already know the present tense of ser and ir?",
                "recommended_answer": "Yes, from the previous topic.",
            },
            {
                "question": "Should the topic stress irregular verbs?",
                "recommended_answer": "Only ser, ir and hacer.",
            },
        ],
    }
}
ADDITIONS = {
    "step": {
        "kind": "additions",
        "additions": {
            "prior_knowledge": "The present tense of ser and ir.",
            "emphasis": "Only ser, ir and hacer among the irregular verbs.",
        },
        "summary": "The topic builds on the present tense and keeps to three irregular verbs.",
    }
}
NO_ADDITIONS = {"goals": None, "prior_knowledge": None, "emphasis": None, "notes": None}


def interview_url(course_id: int, topic_id: int) -> str:
    return f"/api/courses/{course_id}/topics/{topic_id}/interview"


def start(client, topic):
    return client.post(interview_url(*topic))


def answer(client, topic, *answers):
    return client.post(f"{interview_url(*topic)}/answers", json={"answers": list(answers)})


def interview(client, topic) -> dict | None:
    return client.get(interview_url(*topic)).json()


def topic_of(client, topic) -> dict:
    return next(t for t in client.get(topics_url(topic[0])).json() if t["id"] == topic[1])


@pytest.fixture
def topic(teacher) -> tuple[int, int]:
    """A course with the key to pay and one topic: (course id, topic id)."""
    add_key(teacher)
    cid = create_course(teacher).json()["id"]
    tid = add(teacher, cid, "Pretérito indefinido").json()[0]["id"]
    return cid, tid


def test_a_topic_without_an_interview_has_none_and_no_additions(teacher, topic):
    assert interview(teacher, topic) is None
    assert topic_of(teacher, topic)["additions"] == NO_ADDITIONS


def test_starting_the_topic_interview_asks_a_round_from_the_brief(
    teacher, topic, models, admin_settings
):
    models.script(ROUND_ONE, BRIEF)
    start_course_interview(teacher, topic[0])
    answer_course_round(teacher, topic[0], "a", "b")
    models.script(TOPIC_ROUND)

    started = start(teacher, topic)

    assert started.status_code == 202
    finished = job(teacher, started.json()["job"]["id"])
    assert finished["state"] == "succeeded"
    assert finished["kind"] == "topic_interview"
    body = interview(teacher, topic)
    assert body["state"] == "active"
    assert body["topic_id"] == topic[1]
    assert [q["question"] for q in body["rounds"][0]["questions"]] == [
        "Do your students already know the present tense of ser and ir?",
        "Should the topic stress irregular verbs?",
    ]
    assert body["rounds"][0]["answers"] is None
    sent = json.loads(models.requests[-1]["prompt"])
    # It inherits the course brief, so that it asks only what is specific to the topic.
    assert sent["brief"]["level"] == "A2"
    assert sent["topic"] == {"name": "Pretérito indefinido", "position": 0, "additions": {}}
    assert sent["topics"] == ["Pretérito indefinido"]
    assert sent["must_finish"] is False
    record = generations(admin_settings)[-1]
    assert record.task_kind == "topic_interview"
    assert record.prompt_version == prompts.manifest()["topic_interview"]
    assert models.calls[-1][1] == "claude-opus-5-5"


def test_the_last_answers_store_the_additions_on_the_topic(teacher, topic, models):
    models.script(TOPIC_ROUND, ADDITIONS)
    start(teacher, topic)

    answered = answer(teacher, topic, "Yes.", "")

    assert answered.status_code == 202
    body = interview(teacher, topic)
    assert body["state"] == "finished"
    assert body["summary"] == ADDITIONS["step"]["summary"]
    assert body["rounds"][0]["answers"] == ["Yes.", ""]
    assert topic_of(teacher, topic)["additions"] == {
        **NO_ADDITIONS,
        "prior_knowledge": "The present tense of ser and ir.",
        "emphasis": "Only ser, ir and hacer among the irregular verbs.",
    }


def test_additions_left_out_keep_what_the_topic_had(teacher, topic, models):
    teacher.patch(
        f"{topics_url(topic[0])}/{topic[1]}", json={"additions": {"goals": "Tell a story."}}
    )
    models.script(TOPIC_ROUND, ADDITIONS)
    start(teacher, topic)

    answer(teacher, topic, "a", "b")

    additions = topic_of(teacher, topic)["additions"]
    assert additions["goals"] == "Tell a story."
    assert additions["emphasis"] == "Only ser, ir and hacer among the irregular verbs."
    # The next interview sees what the topic already has.
    models.script(TOPIC_ROUND)
    start(teacher, topic)
    assert json.loads(models.requests[-1]["prompt"])["topic"]["additions"] == {
        "goals": "Tell a story.",
        "prior_knowledge": "The present tense of ser and ir.",
        "emphasis": "Only ser, ir and hacer among the irregular verbs.",
    }


def test_the_topic_interview_is_short(teacher, topic, models):
    models.script(TOPIC_ROUND, TOPIC_ROUND, TOPIC_ROUND, TOPIC_ROUND)
    start(teacher, topic)
    for _ in range(2):
        answer(teacher, topic, "a", "b")
    models.script(ADDITIONS)

    answer(teacher, topic, "a", "b")

    assert json.loads(models.requests[-1]["prompt"])["must_finish"] is True
    assert interview(teacher, topic)["state"] == "finished"


def test_a_round_instead_of_the_additions_when_it_must_finish_is_asked_for_again(
    teacher, topic, models
):
    models.script(TOPIC_ROUND, TOPIC_ROUND, TOPIC_ROUND)
    start(teacher, topic)
    for _ in range(2):
        answer(teacher, topic, "a", "b")
    models.script(TOPIC_ROUND, TOPIC_ROUND)

    answered = answer(teacher, topic, "a", "b")

    assert job(teacher, answered.json()["job"]["id"])["error_kind"] == "invalid_output"
    assert interview(teacher, topic)["state"] == "active"


def test_one_topic_interview_runs_at_a_time_per_topic(teacher, topic, models):
    other = (topic[0], add(teacher, topic[0], "Imperfecto").json()[1]["id"])
    models.script(TOPIC_ROUND, TOPIC_ROUND, ROUND_ONE)
    start(teacher, topic)

    refused = start(teacher, topic)

    assert refused.status_code == 409
    assert refused.json() == {"detail": "interview_active"}
    # Other topics and the course interview are separate.
    assert start(teacher, other).status_code == 202
    assert start_course_interview(teacher, topic[0]).status_code == 202


def test_the_topic_interview_ends_early_leaving_the_additions(teacher, topic, models):
    models.script(TOPIC_ROUND, TOPIC_ROUND)
    start(teacher, topic)

    ended = teacher.post(f"{interview_url(*topic)}/end")

    assert ended.status_code == 200
    assert ended.json()["state"] == "ended"
    assert topic_of(teacher, topic)["additions"] == NO_ADDITIONS
    assert answer(teacher, topic, "a", "b").json() == {"detail": "no_open_round"}
    assert start(teacher, topic).status_code == 202


def test_a_failed_step_is_retried(teacher, topic, models):
    from pydantic_ai.exceptions import ModelHTTPError

    models.script(ModelHTTPError(429, "claude", {"error": "rate limited"}))
    started = start(teacher, topic)
    assert job(teacher, started.json()["job"]["id"])["error_kind"] == "quota"
    models.script(TOPIC_ROUND)

    retried = teacher.post(f"{interview_url(*topic)}/retry")

    assert retried.status_code == 202
    assert len(interview(teacher, topic)["rounds"]) == 1
    assert teacher.post(f"{interview_url(*topic)}/retry").json() == {"detail": "nothing_to_retry"}


def test_the_topic_interview_needs_a_key(teacher):
    cid = create_course(teacher).json()["id"]
    tid = add(teacher, cid, "Presente").json()[0]["id"]

    refused = start(teacher, (cid, tid))

    assert refused.status_code == 409
    assert refused.json() == {"detail": "no_provider_key"}


def test_a_viewer_reads_the_topic_interview_but_cannot_run_it(teacher, sender, topic, models):
    models.script(TOPIC_ROUND)
    start(teacher, topic)
    invite_teachers(teacher, sender, COLLEAGUE)
    grant(teacher, topic[0], COLLEAGUE, "view")
    as_teacher(teacher, COLLEAGUE)

    assert interview(teacher, topic)["state"] == "active"
    refused = [
        start(teacher, topic),
        answer(teacher, topic, "a", "b"),
        teacher.post(f"{interview_url(*topic)}/retry"),
        teacher.post(f"{interview_url(*topic)}/end"),
        teacher.patch(f"{topics_url(topic[0])}/{topic[1]}", json={"additions": {"notes": "x"}}),
    ]
    assert [r.status_code for r in refused] == [403] * 5


def test_a_topic_of_another_course_has_no_interview(teacher, topic):
    other = create_course(teacher).json()["id"]

    assert teacher.get(interview_url(other, topic[1])).status_code == 404
    assert start(teacher, (other, topic[1])).status_code == 404


def test_an_interview_ended_during_the_call_ignores_the_additions(
    teacher, topic, models, admin_settings
):
    from myteacher.courses.models import TopicInterview

    def end_it():
        with open_session(create_engine_for(admin_settings)) as db:
            for row in db.query(TopicInterview):
                row.state = "ended"
            db.commit()
        return ADDITIONS

    models.script(TOPIC_ROUND, end_it)
    start(teacher, topic)

    answered = answer(teacher, topic, "a", "b").json()

    assert job(teacher, answered["job"]["id"])["state"] == "succeeded"
    assert interview(teacher, topic)["state"] == "ended"
    assert topic_of(teacher, topic)["additions"] == NO_ADDITIONS


def test_removing_the_topic_removes_its_interview(teacher, topic, models):
    models.script(TOPIC_ROUND)
    start(teacher, topic)

    assert teacher.delete(f"{topics_url(topic[0])}/{topic[1]}").status_code == 200

    assert teacher.get(interview_url(*topic)).status_code == 404


# Additions by hand


def test_the_teacher_changes_and_clears_additions_by_hand(teacher, topic):
    url = f"{topics_url(topic[0])}/{topic[1]}"
    teacher.patch(url, json={"additions": {"goals": " Tell a story. ", "notes": "Songs."}})

    changed = teacher.patch(url, json={"additions": {"notes": None}})

    assert changed.status_code == 200
    assert changed.json()[0]["additions"] == {**NO_ADDITIONS, "goals": "Tell a story."}
    assert teacher.patch(url, json={"additions": {"goals": "x" * 2001}}).status_code == 422
    assert teacher.patch(url, json={"additions": {"level": "B1"}}).status_code == 422


# The map proposal


def test_the_map_proposal_uses_the_brief_and_the_topics_additions(teacher, topic, models):
    models.script(TOPIC_ROUND, ADDITIONS, PROPOSAL)
    start(teacher, topic)
    answer(teacher, topic, "a", "b")

    assert teacher.post(f"{map_url(*topic)}/proposal").status_code == 202

    sent = json.loads(models.requests[-1]["prompt"])
    assert "brief" in sent
    assert sent["topic"]["additions"] == {
        "prior_knowledge": "The present tense of ser and ir.",
        "emphasis": "Only ser, ir and hacer among the irregular verbs.",
    }
    assert prompts.manifest()["concept_map"] == "v2"
