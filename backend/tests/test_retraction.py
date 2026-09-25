"""Retracting a student's attempt or a whole release (#71): the answers stay with the teacher but
count for nothing, the student is told why and taken out, and a new attempt can start."""

# ruff: noqa: F811
from datetime import UTC, datetime

from myteacher.persistence import open_session
from myteacher.runs.models import Attempt
from tests.helpers import OTHER_STUDENT, back_to_teacher, create_engine_for
from tests.test_attempts import (  # noqa: F401 - `course` is a fixture
    CLOSED,
    RIGHT,
    WRONG,
    answer,
    as_student,
    course,
    draft,
    my_release,
    my_releases,
    released,
    start,
    started,
    submit,
)
from tests.test_course_access import COLLEAGUE, as_teacher, grant, invite_teachers
from tests.test_open_assessment import ASSESSED
from tests.test_results import by_name, results, results_url

REASON = "The second exercise had a mistake."


def retract_attempt(client, course, release_id, student_id, reason=REASON):
    return client.post(
        f"/api/runs/{course.run}/releases/{release_id}/students/{student_id}/retraction",
        json={"reason": reason},
    )


def retract_release(client, course, release_id, reason=REASON):
    return client.post(
        f"/api/runs/{course.run}/releases/{release_id}/retraction", json={"reason": reason}
    )


def submitted(client, course, answers=None, **settings) -> tuple[int, int]:
    """A release Jana submitted: (release, attempt); the client is the teacher again."""
    release_id = released(client, course, feedback_mode="at_the_end", **settings)
    as_student(client)
    attempt_id = started(client, release_id)["id"]
    submit(client, attempt_id, answers or {k: WRONG[k] for k in CLOSED})
    back_to_teacher(client)
    return release_id, attempt_id


# Retracting an attempt


def test_a_retracted_attempt_counts_for_nothing_and_a_new_one_starts(teacher, course):
    release_id, attempt_id = submitted(teacher, course)

    retracted = retract_attempt(teacher, course, release_id, course.jana)

    assert retracted.status_code == 204
    jana = by_name(results(teacher, course, release_id))["Jana Veselá"]
    assert (jana["state"], jana["cells"], jana["attempts"]) == ("not_started", {}, 0)
    summary = {e["id"]: e for e in results(teacher, course, release_id)["exercises"]}
    assert summary["hablar"]["wrong"] == 0
    as_student(teacher)
    detail = my_release(teacher, release_id)
    assert detail["can_start"] is True
    assert detail["retraction"] == {"reason": REASON, "whole_release": False}
    fresh = start(teacher, release_id)
    assert fresh.status_code == 201
    assert fresh.json()["number"] == 2
    assert my_release(teacher, release_id)["retraction"] is None


def test_the_teacher_keeps_the_answers_of_a_retracted_attempt(teacher, course):
    release_id, attempt_id = submitted(teacher, course)
    retract_attempt(teacher, course, release_id, course.jana)

    detail = teacher.get(f"{results_url(course, release_id)}/{course.jana}").json()

    [kept] = detail["attempts"]
    assert kept["id"] == attempt_id
    assert kept["counts"] is False
    assert kept["retraction_reason"] == REASON
    assert kept["retracted_at"] == "2026-09-24T08:00:00Z"
    assert kept["first"]["answers"]["hablar"]["tries"][0]["answer"] == WRONG["hablar"]


def test_a_student_inside_a_retracted_attempt_is_taken_out(teacher, course):
    release_id = released(teacher, course)
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]
    back_to_teacher(teacher)
    retract_attempt(teacher, course, release_id, course.jana)

    as_student(teacher)
    for refused in (
        teacher.get(f"/api/attempts/{attempt_id}"),
        draft(teacher, attempt_id, "hablar", RIGHT["hablar"]),
        answer(teacher, attempt_id, "hablar", RIGHT["hablar"]),
        teacher.post(f"/api/attempts/{attempt_id}/second-round"),
    ):
        assert refused.status_code == 410
        assert refused.json() == {"detail": "attempt_retracted"}


def test_a_retracted_attempt_frees_a_release_taking_one_attempt(teacher, course):
    release_id, _ = submitted(teacher, course)
    as_student(teacher)
    assert start(teacher, release_id).status_code == 409
    back_to_teacher(teacher)

    retract_attempt(teacher, course, release_id, course.jana)

    as_student(teacher)
    assert start(teacher, release_id).status_code == 201


def test_retracting_a_student_who_has_not_started_is_refused(teacher, course):
    release_id = released(teacher, course)

    refused = retract_attempt(teacher, course, release_id, course.jana)

    assert refused.status_code == 409
    assert refused.json() == {"detail": "nothing_to_retract"}


def test_a_retraction_needs_a_reason(teacher, course):
    release_id, _ = submitted(teacher, course)

    assert retract_attempt(teacher, course, release_id, course.jana, "  ").status_code == 422
    assert retract_release(teacher, course, release_id, "").status_code == 422


def test_only_the_attempt_that_counts_or_is_open_is_retracted(teacher, course):
    release_id = released(teacher, course, feedback_mode="at_the_end", attempts="repeated")
    as_student(teacher)
    first = started(teacher, release_id)["id"]
    submit(teacher, first, {k: RIGHT[k] for k in CLOSED})
    second = started(teacher, release_id)["id"]
    back_to_teacher(teacher)

    retract_attempt(teacher, course, release_id, course.jana)

    jana = by_name(results(teacher, course, release_id))["Jana Veselá"]
    # The open second attempt went; the submitted first still counts.
    assert (jana["state"], jana["cells"]["hablar"]) == ("submitted", "right")
    detail = teacher.get(f"{results_url(course, release_id)}/{course.jana}").json()
    assert [(a["id"], a["retraction_reason"]) for a in detail["attempts"]] == [
        (second, REASON),
        (first, None),
    ]


def test_retracted_open_answers_are_not_assessed_or_published(teacher, course, models):
    release_id, _ = submitted(
        teacher,
        course,
        {**{k: RIGHT[k] for k in CLOSED}, "write": RIGHT["write"]},
    )
    retract_attempt(teacher, course, release_id, course.jana)

    assert results(teacher, course, release_id)["open_answers"]["waiting"] == 0
    assert teacher.post(f"/api/runs/{course.run}/releases/{release_id}/open-assessment").json() == {
        "detail": "nothing_to_assess"
    }


# Retracting a release


def test_a_retracted_release_disappears_from_students_and_retracts_every_attempt(teacher, course):
    release_id, jana_attempt = submitted(teacher, course)
    as_student(teacher, OTHER_STUDENT)
    petr_attempt = started(teacher, release_id)["id"]
    back_to_teacher(teacher)

    retracted = retract_release(teacher, course, release_id)

    assert retracted.status_code == 200
    assert retracted.json()["retraction_reason"] == REASON
    assert retracted.json()["retracted_at"] == "2026-09-24T08:00:00Z"
    as_student(teacher)
    assert my_releases(teacher) == []
    detail = my_release(teacher, release_id)
    assert detail["retraction"] == {"reason": REASON, "whole_release": True}
    assert (detail["attempt"], detail["can_start"]) == (None, False)
    assert start(teacher, release_id).status_code == 410
    assert teacher.get(f"/api/attempts/{jana_attempt}").status_code == 410
    as_student(teacher, OTHER_STUDENT)
    assert answer(teacher, petr_attempt, "hablar", RIGHT["hablar"]).status_code == 410


def test_the_teacher_keeps_a_retracted_releases_answers(teacher, course):
    release_id, attempt_id = submitted(teacher, course)

    retract_release(teacher, course, release_id)

    listed = teacher.get(f"/api/runs/{course.run}/releases").json()
    assert listed[0]["retraction_reason"] == REASON
    detail = teacher.get(f"{results_url(course, release_id)}/{course.jana}").json()
    assert detail["attempts"][0]["id"] == attempt_id
    assert detail["attempts"][0]["retraction_reason"] == REASON
    assert by_name(results(teacher, course, release_id))["Jana Veselá"]["cells"] == {}


def test_a_release_is_retracted_once(teacher, course):
    release_id, _ = submitted(teacher, course)
    retract_release(teacher, course, release_id)

    for refused in (
        retract_release(teacher, course, release_id),
        retract_attempt(teacher, course, release_id, course.jana),
    ):
        assert refused.status_code == 409
        assert refused.json() == {"detail": "release_retracted"}


# The run teacher alone


def test_only_the_run_teacher_retracts(teacher, sender, course):
    release_id, _ = submitted(teacher, course)
    invite_teachers(teacher, sender, COLLEAGUE)
    grant(teacher, course.id, COLLEAGUE, "edit")

    as_teacher(teacher, COLLEAGUE)
    assert retract_attempt(teacher, course, release_id, course.jana).status_code == 404
    assert retract_release(teacher, course, release_id).status_code == 404
    as_student(teacher)
    assert retract_release(teacher, course, release_id).status_code == 403


def test_an_answer_retracted_while_the_assistant_assesses_is_not_sent(
    teacher, course, models, settings
):
    release_id, _ = submitted(
        teacher, course, {**{k: RIGHT[k] for k in CLOSED}, "write": RIGHT["write"]}
    )
    as_student(teacher, OTHER_STUDENT)
    petrs = started(teacher, release_id)["id"]
    submit(teacher, petrs, {**{k: RIGHT[k] for k in CLOSED}, "write": RIGHT["write"]})
    back_to_teacher(teacher)
    asked_before = len(models.calls)

    def retract_petr_meanwhile():
        with open_session(create_engine_for(settings)) as db:
            db.get_one(Attempt, petrs).retracted_at = datetime(2026, 9, 24, 9, tzinfo=UTC)
            db.commit()
        return ASSESSED

    models.script(retract_petr_meanwhile)

    started_job = teacher.post(f"/api/runs/{course.run}/releases/{release_id}/open-assessment")

    finished = teacher.get(f"/api/jobs/{started_job.json()['job']['id']}").json()
    assert (finished["state"], finished["result"]) == ("succeeded", {"assessed": 1, "flagged": 0})
    assert len(models.calls) - asked_before == 1
