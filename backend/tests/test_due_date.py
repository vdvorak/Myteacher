"""An attempt still open when a refusing due date passes is submitted with what it holds (#85),
lazily: the first read after the due date submits it, at the due date's time."""

# ruff: noqa: F811
from datetime import timedelta

from sqlalchemy import func, select

from myteacher.persistence import open_session
from myteacher.runs.models import Assessment
from tests.helpers import back_to_teacher, create_engine_for
from tests.test_attempts import (  # noqa: F401 - `course` is a fixture
    RIGHT,
    WRONG,
    answer,
    as_student,
    attempt,
    course,
    draft,
    my_release,
    my_releases,
    released,
    started,
)
from tests.test_open_assessment import ASSESSED
from tests.test_results import by_name, results

DUE = "2026-09-25T08:00:00Z"


def refusing(client, course, **settings) -> int:
    return released(client, course, due_at=DUE, late_submissions="refuse", **settings)


def first(detail: dict) -> dict[str, list[dict]]:
    """The first pass's tries by exercise."""
    return {
        exercise_id: progress["tries"]
        for exercise_id, progress in detail["first"]["answers"].items()
        if progress["tries"]
    }


def test_saved_drafts_are_assessed_at_the_due_date_with_feedback_at_the_end(teacher, course, clock):
    release_id = refusing(teacher, course, feedback_mode="at_the_end")
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]
    draft(teacher, attempt_id, "hablar", RIGHT["hablar"])
    draft(teacher, attempt_id, "gaps", WRONG["gaps"])
    draft(teacher, attempt_id, "write", RIGHT["write"])
    clock.now += timedelta(days=2)

    detail = my_release(teacher, release_id)

    assert detail["state"] == "submitted"
    assert detail["late"] is False
    assert detail["can_start"] is False
    submitted = detail["attempt"]
    assert (submitted["id"], submitted["submitted_at"]) == (attempt_id, DUE)
    tries = first(submitted)
    assert sorted(tries) == ["gaps", "hablar", "write"]
    assert tries["hablar"][0]["result"]["correct"] is True
    assert tries["gaps"][0]["result"]["correct"] is False
    assert tries["write"][0]["result"]["status"] == "pending"


def test_closed_exercises_left_or_not_fitting_count_for_nothing_and_empty_open_ones_are_not_sent(
    teacher, course, clock
):
    release_id = refusing(teacher, course, feedback_mode="at_the_end")
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]
    # The attempt's variant blanks g1: an answer filling g2 does not fit it.
    draft(teacher, attempt_id, "gaps", {"type": "cloze", "gaps": {"g2": "Praga"}})
    draft(teacher, attempt_id, "write", {"type": "free_text", "text": "  "})
    clock.now += timedelta(days=2)

    assert first(attempt(teacher, attempt_id)) == {}
    back_to_teacher(teacher)
    jana = by_name(results(teacher, course, release_id))["Jana Veselá"]
    assert jana["state"] == "submitted"
    assert jana["cells"] == {
        "hablar": "unanswered",
        "gaps": "unanswered",
        "pairs": "unanswered",
        "order": "unanswered",
        "select": "unanswered",
        "write": "unanswered",
    }


def test_the_tries_taken_stand_at_the_due_date_with_immediate_feedback(teacher, course, clock):
    release_id = refusing(teacher, course)
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]
    answer(teacher, attempt_id, "hablar", WRONG["hablar"])
    # A draft is what is being composed; with immediate feedback only a try is assessed.
    draft(teacher, attempt_id, "gaps", RIGHT["gaps"])
    clock.now += timedelta(days=2)

    submitted = attempt(teacher, attempt_id)

    assert (submitted["submitted_at"], submitted["late"]) == (DUE, False)
    assert {k: len(v) for k, v in first(submitted).items()} == {"hablar": 1}


def test_the_students_list_and_the_teachers_results_submit_it_too(teacher, course, clock):
    at_the_end = refusing(teacher, course, feedback_mode="at_the_end")
    immediate = refusing(teacher, course)
    as_student(teacher)
    started(teacher, at_the_end)
    started(teacher, immediate)
    clock.now += timedelta(days=2)

    assert {r["id"]: r["state"] for r in my_releases(teacher)} == {
        at_the_end: "submitted",
        immediate: "submitted",
    }
    back_to_teacher(teacher)
    assert by_name(results(teacher, course, at_the_end))["Jana Veselá"]["state"] == "submitted"


def test_a_second_round_after_the_due_date_repeats_what_was_left(teacher, course, clock):
    release_id = refusing(teacher, course, feedback_mode="at_the_end")
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]
    draft(teacher, attempt_id, "hablar", RIGHT["hablar"])
    clock.now += timedelta(days=2)

    second = teacher.post(f"/api/attempts/{attempt_id}/second-round")

    assert second.status_code == 200
    assert [e["id"] for e in second.json()["exercises"]] == ["gaps", "pairs", "order", "select"]


def test_work_is_still_refused_after_the_due_date_once_submitted(teacher, course, clock):
    release_id = refusing(teacher, course)
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]
    clock.now += timedelta(days=2)
    attempt(teacher, attempt_id)

    refused = answer(teacher, attempt_id, "hablar", RIGHT["hablar"])

    assert (refused.status_code, refused.json()) == (409, {"detail": "past_due"})


def test_reading_it_again_submits_it_once(teacher, course, clock, settings):
    release_id = refusing(teacher, course, feedback_mode="at_the_end")
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]
    draft(teacher, attempt_id, "hablar", RIGHT["hablar"])
    clock.now += timedelta(days=2)

    for _ in range(3):
        my_release(teacher, release_id)
        attempt(teacher, attempt_id)

    with open_session(create_engine_for(settings)) as db:
        assert db.scalar(select(func.count()).select_from(Assessment)) == 1


def test_before_the_due_date_the_attempt_stays_open(teacher, course, clock):
    release_id = refusing(teacher, course, feedback_mode="at_the_end")
    as_student(teacher)
    started(teacher, release_id)
    clock.now += timedelta(hours=23)

    assert my_release(teacher, release_id)["state"] == "in_progress"


def test_a_release_accepting_late_work_leaves_the_attempt_open(teacher, course, clock):
    release_id = released(teacher, course, feedback_mode="at_the_end", due_at=DUE)
    as_student(teacher)
    started(teacher, release_id)
    clock.now += timedelta(days=2)

    detail = my_release(teacher, release_id)

    assert (detail["state"], detail["attempt"]["submitted_at"]) == ("in_progress", None)


def test_assessing_open_answers_submits_what_the_due_date_closed(teacher, course, clock, models):
    release_id = refusing(teacher, course, feedback_mode="at_the_end")
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]
    draft(teacher, attempt_id, "write", RIGHT["write"])
    back_to_teacher(teacher)
    clock.now += timedelta(days=2)
    models.script(ASSESSED)

    started_job = teacher.post(f"/api/runs/{course.run}/releases/{release_id}/open-assessment")

    assert started_job.status_code == 202, started_job.json()
    finished = teacher.get(f"/api/jobs/{started_job.json()['job']['id']}").json()
    assert finished["result"] == {"assessed": 1, "flagged": 0}


def test_overriding_and_publishing_cover_what_the_due_date_closed(teacher, course, clock, settings):
    release_id = refusing(teacher, course)
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]
    answer(teacher, attempt_id, "hablar", WRONG["hablar"])
    back_to_teacher(teacher)
    clock.now += timedelta(days=2)
    with open_session(create_engine_for(settings)) as db:
        assessment_id = db.scalars(select(Assessment.id)).one()

    overridden = teacher.put(
        f"/api/runs/{course.run}/releases/{release_id}/assessments/{assessment_id}/override",
        json={"score": 1, "reason": "Accepted spelling."},
    )

    assert overridden.status_code == 200, overridden.json()
    published = teacher.post(f"/api/runs/{course.run}/releases/{release_id}/publication")
    assert published.json() == {"published": 1}
