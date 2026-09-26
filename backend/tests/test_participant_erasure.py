"""A link run's participants' names and answers are deleted 90 days after its last release, or
earlier when its teacher asks; the run and its results stay, with anonymous rows (#122)."""

# ruff: noqa: F811

from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from myteacher.app import create_app
from myteacher.assistant.generations import GenerationRecord
from myteacher.persistence import open_session
from myteacher.runs import participants
from myteacher.runs.models import Participant
from tests.helpers import as_student, back_to_teacher, create_engine_for
from tests.test_course_access import COLLEAGUE, as_teacher, grant, invite_teachers
from tests.test_link_runs import check, me, start_link_run
from tests.test_open_assessment import ASSESSED
from tests.test_participant_work import (
    released,
    results_url,
    right,
    run,  # noqa: F401 - a fixture
    submitted,
)

WRITTEN = "Jmenuji se Eva a bydlím v Brně."


def sweep(settings, clock) -> int:
    with open_session(create_engine_for(settings)) as db:
        erased = participants.sweep(db, clock())
        db.commit()
    return erased


def later(teacher, clock, **delta) -> None:
    """Move the clock on; the teacher's session has expired by then, so they sign in again."""
    clock.now += timedelta(**delta)
    back_to_teacher(teacher)


def erase_now(client, run_id):
    return client.delete(f"/api/runs/{run_id}/participant-data")


def done(teacher, run, feedback_mode="at_the_end") -> int:
    """A release where Eva submitted a written answer."""
    release_id = released(teacher, run, feedback_mode=feedback_mode)
    submitted(teacher, run.eva, release_id, right(WRITTEN))
    return release_id


def names(teacher, run, release_id) -> list[str]:
    return [s["name"] for s in teacher.get(results_url(run, release_id)).json()["students"]]


def answers(teacher, run, release_id) -> dict[str, dict]:
    """Eva's answers in the attempt that counts, by exercise."""
    eva = teacher.get(results_url(run, release_id)).json()["students"][0]
    detail = teacher.get(f"{results_url(run, release_id)}/{eva['id']}").json()
    first = detail["attempts"][0]["first"]["answers"]
    return {key: answer["tries"][0]["answer"] for key, answer in first.items()}


def written_answers(teacher, run, release_id) -> list[str]:
    eva = teacher.get(results_url(run, release_id)).json()["students"][0]
    detail = teacher.get(f"{results_url(run, release_id)}/{eva['id']}").json()
    return [
        done["answer"]["text"]
        for attempt in detail["attempts"]
        for answer in attempt["first"]["answers"].values()
        for done in answer["tries"]
        if "text" in done["answer"]
    ]


# After 90 days


def test_nothing_is_deleted_before_ninety_days(teacher, run, clock, settings):
    release_id = done(teacher, run)
    later(teacher, clock, days=89, hours=23)

    assert sweep(settings, clock) == 0

    assert names(teacher, run, release_id) == ["Eva Malá", "Jan Novák (1)", "Jan Novák (2)"]
    assert written_answers(teacher, run, release_id) == [WRITTEN]
    assert me(teacher, run.eva).status_code == 200


def test_everything_goes_ninety_days_after_the_last_release(teacher, run, clock, settings):
    first = done(teacher, run)
    later(teacher, clock, days=30)
    second = released(teacher, run, feedback_mode="at_the_end")
    later(teacher, clock, days=89)
    assert sweep(settings, clock) == 0
    later(teacher, clock, days=1)

    assert sweep(settings, clock) == 1

    # The teacher's language names the anonymous rows.
    assert names(teacher, run, first) == ["Účastník 1", "Účastník 2", "Účastník 3"]
    assert names(teacher, run, second) == ["Účastník 1", "Účastník 2", "Účastník 3"]
    assert written_answers(teacher, run, first) == [""]
    assert me(teacher, run.eva).status_code == 401
    found = teacher.get(f"/api/runs/{run.id}").json()
    assert found["participants_erased_at"] is not None
    assert found["joining_open"] is False
    teacher.cookies.clear()
    assert check(teacher, found["join_token"]).json()["closed"] is True


def test_results_stay_readable_with_their_counts(teacher, run, clock, settings):
    release_id = done(teacher, run)
    before = teacher.get(results_url(run, release_id)).json()
    later(teacher, clock, days=90)

    sweep(settings, clock)

    after = teacher.get(results_url(run, release_id)).json()
    assert after["exercises"] == before["exercises"]
    assert [(s["state"], s["cells"]) for s in after["students"]] == [
        (s["state"], s["cells"]) for s in before["students"]
    ]
    [listed] = teacher.get(f"/api/runs/{run.id}/releases").json()
    assert (listed["submitted"], listed["total"]) == (1, 3)


def test_a_run_that_released_nothing_goes_ninety_days_after_it_started(
    teacher,
    run,
    clock,
    settings,
):
    later(teacher, clock, days=90)

    assert sweep(settings, clock) == 1

    lobby = teacher.get(f"/api/runs/{run.id}/lobby").json()["participants"]
    assert [p["name"] for p in lobby] == ["Účastník 1", "Účastník 2", "Účastník 3"]


def test_the_devices_they_used_are_forgotten(teacher, run, settings):
    headers = {"X-Participant-Token": run.eva, "X-Participant-Device": "phone-5f1c"}
    assert teacher.post("/api/participant/open", headers=headers).status_code == 200

    erase_now(teacher, run.id)

    lobby = teacher.get(f"/api/runs/{run.id}/lobby").json()["participants"]
    assert [p["devices"] for p in lobby] == [0, 0, 0]
    with open_session(create_engine_for(settings)) as db:
        assert list(db.scalars(select(Participant.device))) == [None, None, None]


def test_the_app_sweeps_when_it_starts(teacher, run, clock, admin_settings, sender, models):
    later(teacher, clock, days=90)

    with TestClient(create_app(admin_settings, clock=clock, sender=sender, model_factory=models)):
        pass

    assert me(teacher, run.eva).status_code == 401


def test_the_assistants_records_keep_no_answer_text(teacher, run, clock, models, settings):
    release_id = done(teacher, run)
    models.script(ASSESSED)
    assert (
        teacher.post(f"/api/runs/{run.id}/releases/{release_id}/open-assessment").status_code == 202
    )
    with open_session(create_engine_for(settings)) as db:
        [record] = db.scalars(
            select(GenerationRecord).where(GenerationRecord.task_kind == "open_assessment")
        )
        assert WRITTEN in str(record.inputs)

    erase_now(teacher, run.id)

    with open_session(create_engine_for(settings)) as db:
        [record] = db.scalars(
            select(GenerationRecord).where(GenerationRecord.task_kind == "open_assessment")
        )
        assert (record.inputs, record.output, record.raw_output) == ({}, None, None)
    eva = teacher.get(results_url(run, release_id)).json()["students"][0]
    detail = teacher.get(f"{results_url(run, release_id)}/{eva['id']}").json()
    review = detail["attempts"][0]["first"]["answers"]["write"]["tries"][0]["assessment"]
    assert (review["score"], review["justification"], review["feedback"]) == (1.0, None, None)


# On request


def test_the_teacher_deletes_them_earlier(teacher, run):
    release_id = done(teacher, run)

    erased = erase_now(teacher, run.id)

    assert erased.status_code == 200
    assert erased.json()["participants_erased_at"] == "2026-09-24T08:00:00Z"
    assert names(teacher, run, release_id) == ["Účastník 1", "Účastník 2", "Účastník 3"]
    assert me(teacher, run.eva).status_code == 401
    # Once is enough; asking again changes nothing.
    assert erase_now(teacher, run.id).status_code == 200


def test_only_the_run_teacher_deletes_them(teacher, sender, run):
    invite_teachers(teacher, sender, COLLEAGUE)
    back_to_teacher(teacher)
    grant(teacher, run.course, COLLEAGUE, "edit")

    as_teacher(teacher, COLLEAGUE)
    assert erase_now(teacher, run.id).status_code == 404
    back_to_teacher(teacher)
    as_student(teacher, sender)
    assert erase_now(teacher, run.id).status_code == 403
    back_to_teacher(teacher)
    assert me(teacher, run.eva).status_code == 200


def test_an_enrolled_run_has_no_participants_to_delete(teacher, run):
    enrolled = teacher.post(f"/api/courses/{run.course}/runs", json={"name": "2.B"}).json()

    assert erase_now(teacher, enrolled["id"]).status_code == 404
    assert start_link_run(teacher, run.course).json()["participants_erased_at"] is None


def test_every_call_on_their_answers_is_blanked_failed_ones_too(teacher, run, models, settings):
    release_id = done(teacher, run)
    unfit = {**ASSESSED, "criteria": [{"criterion_id": "style", "points": 1, "comment": ""}]}
    models.script(unfit, unfit)
    teacher.post(f"/api/runs/{run.id}/releases/{release_id}/open-assessment")

    erase_now(teacher, run.id)

    with open_session(create_engine_for(settings)) as db:
        records = list(
            db.scalars(
                select(GenerationRecord).where(GenerationRecord.task_kind == "open_assessment")
            )
        )
    assert records
    assert all((r.inputs, r.output, r.raw_output) == ({}, None, None) for r in records)


def test_gaps_typed_in_are_blanked_too(teacher, run):
    release_id = done(teacher, run)
    assert answers(teacher, run, release_id)["gaps"]["gaps"] == {"g1": "soy"}

    erase_now(teacher, run.id)

    assert answers(teacher, run, release_id)["gaps"]["gaps"] == {"g1": ""}


def test_joining_does_not_open_again_after_the_erasure(teacher, run):
    erase_now(teacher, run.id)

    refused = teacher.put(f"/api/runs/{run.id}/joining", json={"open": True})

    assert (refused.status_code, refused.json()) == (409, {"detail": "participants_erased"})


def test_a_failing_sweep_does_not_stop_the_app_from_starting(
    admin_settings, clock, sender, models, monkeypatch
):
    def failing(db, now):
        raise RuntimeError("the database is locked")

    monkeypatch.setattr(participants, "sweep", failing)

    with TestClient(
        create_app(admin_settings, clock=clock, sender=sender, model_factory=models)
    ) as client:
        assert client.get("/api/health").status_code == 200
