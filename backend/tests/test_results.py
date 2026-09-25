"""The results of a release for the run teacher (#69): students × exercises from the attempts that
count, a summary per exercise, and a student's every attempt with its assessments."""

# ruff: noqa: F811
from datetime import timedelta

from sqlalchemy import select

from myteacher.courses.models import ClassroomMaterialVersion
from myteacher.persistence import open_session
from tests.helpers import OTHER_STUDENT, back_to_teacher, create_engine_for, create_student
from tests.test_attempts import (  # noqa: F401 - `course` is a fixture
    CLOSED,
    RIGHT,
    WRONG,
    answer,
    as_student,
    course,
    released,
    started,
    submit,
)
from tests.test_course_access import COLLEAGUE, as_teacher, grant, invite_teachers
from tests.test_course_runs import add_member

EXERCISES = ["hablar", "gaps", "pairs", "order", "select", "write"]


def results_url(course, release_id) -> str:
    return f"/api/runs/{course.run}/releases/{release_id}/results"


def results(client, course, release_id) -> dict:
    response = client.get(results_url(course, release_id))
    assert response.status_code == 200, response.json()
    return response.json()


def by_name(body) -> dict[str, dict]:
    return {student["name"]: student for student in body["students"]}


def test_the_results_cover_every_student_with_a_cell_per_exercise(teacher, course, clock):
    release_id = released(
        teacher, course, feedback_mode="at_the_end", due_at="2026-09-25T08:00:00Z"
    )
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]
    clock.now += timedelta(days=2)
    submit(
        teacher,
        attempt_id,
        {**{k: RIGHT[k] for k in CLOSED}, "hablar": WRONG["hablar"], "write": RIGHT["write"]},
    )
    back_to_teacher(teacher)

    body = results(teacher, course, release_id)

    assert [e["id"] for e in body["exercises"]] == EXERCISES
    assert body["release"]["id"] == release_id
    students = by_name(body)
    assert list(students) == ["Jana Veselá", "Petr Malý"]
    assert students["Jana Veselá"] == {
        "id": course.jana,
        "name": "Jana Veselá",
        "in_run": True,
        "state": "submitted",
        "late": True,
        "attempts": 1,
        "cells": {
            "hablar": "wrong",
            "gaps": "right",
            "pairs": "right",
            "order": "right",
            "select": "right",
            "write": "open",
        },
    }
    assert students["Petr Malý"]["state"] == "not_started"
    assert students["Petr Malý"]["cells"] == {}


def test_an_open_exercise_left_empty_is_not_answered(teacher, course):
    release_id = released(teacher, course, feedback_mode="at_the_end")
    as_student(teacher)
    submit(teacher, started(teacher, release_id)["id"], {k: RIGHT[k] for k in CLOSED})
    back_to_teacher(teacher)

    cells = by_name(results(teacher, course, release_id))["Jana Veselá"]["cells"]

    assert cells["write"] == "unanswered"


def test_an_attempt_in_progress_shows_no_results_yet(teacher, course):
    release_id = released(teacher, course)
    as_student(teacher)
    answer(teacher, started(teacher, release_id)["id"], "hablar", WRONG["hablar"])
    back_to_teacher(teacher)

    jana = by_name(results(teacher, course, release_id))["Jana Veselá"]

    assert jana["state"] == "in_progress"
    assert jana["cells"] == {}


def test_a_student_no_longer_in_the_run_stays_in_the_results_marked(teacher, course):
    release_id = released(teacher, course, feedback_mode="at_the_end")
    as_student(teacher, OTHER_STUDENT)
    submit(teacher, started(teacher, release_id)["id"], {k: RIGHT[k] for k in CLOSED})
    back_to_teacher(teacher)
    teacher.delete(f"/api/classes/{course.klass}/members/{course.petr}")
    teacher.delete(f"/api/classes/{course.klass}/members/{course.jana}")

    students = by_name(results(teacher, course, release_id))

    # Jana never started and left: nothing of hers belongs to the release any more.
    assert list(students) == ["Petr Malý"]
    assert students["Petr Malý"]["in_run"] is False
    assert students["Petr Malý"]["cells"]["hablar"] == "right"


def test_a_chosen_release_lists_its_chosen_students_only(teacher, course):
    release_id = released(teacher, course, audience="chosen", student_ids=[course.petr])
    eva = create_student(teacher, "eva@skola.example", name="Eva Malá").json()["id"]
    add_member(teacher, course.klass, eva)

    assert list(by_name(results(teacher, course, release_id))) == ["Petr Malý"]


def test_a_whole_run_release_includes_students_who_joined_later(teacher, course):
    release_id = released(teacher, course)
    eva = create_student(teacher, "eva@skola.example", name="Eva Malá").json()["id"]
    add_member(teacher, course.klass, eva)

    assert "Eva Malá" in by_name(results(teacher, course, release_id))


def test_with_repeated_attempts_the_last_submitted_counts(teacher, course):
    release_id = released(teacher, course, feedback_mode="at_the_end", attempts="repeated")
    as_student(teacher)
    submit(teacher, started(teacher, release_id)["id"], {k: WRONG[k] for k in CLOSED})
    submit(teacher, started(teacher, release_id)["id"], {k: RIGHT[k] for k in CLOSED})
    started(teacher, release_id)  # a third, still open
    back_to_teacher(teacher)

    jana = by_name(results(teacher, course, release_id))["Jana Veselá"]

    assert jana["attempts"] == 3
    assert jana["state"] == "in_progress"
    assert {jana["cells"][k] for k in CLOSED} == {"right"}


def test_the_summary_counts_wrong_answers_of_counted_attempts_only(teacher, course):
    release_id = released(teacher, course, feedback_mode="at_the_end", attempts="repeated")
    as_student(teacher)
    submit(teacher, started(teacher, release_id)["id"], {k: WRONG[k] for k in CLOSED})
    submit(
        teacher,
        started(teacher, release_id)["id"],
        {**{k: RIGHT[k] for k in CLOSED}, "gaps": WRONG["gaps"]},
    )
    as_student(teacher, OTHER_STUDENT)
    submit(
        teacher,
        started(teacher, release_id)["id"],
        {**{k: RIGHT[k] for k in CLOSED}, "gaps": WRONG["gaps"], "write": RIGHT["write"]},
    )
    back_to_teacher(teacher)

    summary = {e["id"]: e for e in results(teacher, course, release_id)["exercises"]}

    assert summary["gaps"] == {
        **summary["gaps"],
        "right": 0,
        "wrong": 2,
        "open": 0,
        "unanswered": 0,
    }
    assert summary["hablar"]["wrong"] == 0
    assert summary["hablar"]["right"] == 2
    assert (summary["write"]["open"], summary["write"]["unanswered"]) == (1, 1)
    assert summary["hablar"]["prompt"] == "Ayer yo ___ con Ana."
    assert summary["hablar"]["type"] == "multiple_choice"


# A student's detail


def test_a_students_detail_shows_every_attempt_with_its_assessments_and_solutions(teacher, course):
    release_id = released(
        teacher, course, feedback_mode="at_the_end", attempts="repeated", show_solutions=False
    )
    as_student(teacher)
    first = started(teacher, release_id)["id"]
    submit(teacher, first, {k: WRONG[k] for k in CLOSED})
    second = started(teacher, release_id)["id"]
    submit(teacher, second, {k: RIGHT[k] for k in CLOSED})
    back_to_teacher(teacher)

    response = teacher.get(f"{results_url(course, release_id)}/{course.jana}")

    assert response.status_code == 200
    body = response.json()
    assert body["student"] == {"id": course.jana, "name": "Jana Veselá", "in_run": True}
    assert [(a["id"], a["number"], a["counts"]) for a in body["attempts"]] == [
        (second, 2, True),
        (first, 1, False),
    ]
    earlier = body["attempts"][1]["first"]["answers"]["hablar"]["tries"][0]
    assert earlier["answer"] == WRONG["hablar"]
    # The teacher sees the solution the release hides from the student.
    assert earlier["result"]["solution"]["option_id"] == "a"


def test_the_detail_of_a_student_the_release_is_not_for_is_not_found(teacher, course):
    release_id = released(teacher, course, audience="chosen", student_ids=[course.petr])

    assert teacher.get(f"{results_url(course, release_id)}/{course.jana}").status_code == 404
    assert teacher.get(f"{results_url(course, release_id)}/999").status_code == 404


# The run teacher alone


def test_only_the_run_teacher_sees_the_results(teacher, sender, course):
    release_id = released(teacher, course)
    invite_teachers(teacher, sender, COLLEAGUE)
    grant(teacher, course.id, COLLEAGUE, "edit")

    as_teacher(teacher, COLLEAGUE)
    assert teacher.get(results_url(course, release_id)).status_code == 404
    assert teacher.get(f"{results_url(course, release_id)}/{course.jana}").status_code == 404
    as_student(teacher)
    assert teacher.get(results_url(course, release_id)).status_code == 403


def test_the_results_of_another_runs_release_are_not_found(teacher, course):
    release_id = released(teacher, course)
    other = teacher.post(f"/api/courses/{course.id}/runs", json={"name": "Jiný"}).json()["id"]

    assert teacher.get(f"/api/runs/{other}/releases/{release_id}/results").status_code == 404


def test_the_summary_lists_the_exercises_the_students_answer(teacher, course, settings):
    release_id = released(teacher, course)
    with open_session(create_engine_for(settings)) as db:
        # As if the version held a type outside the catalog, which students never get.
        version = db.scalars(select(ClassroomMaterialVersion)).one()
        numeric = {"type": "numeric", "id": "distance", "prompt": "How far?", "correct_value": 5}
        version.lesson = {**version.lesson, "blocks": [*version.lesson["blocks"], numeric]}
        db.commit()

    assert [e["id"] for e in results(teacher, course, release_id)["exercises"]] == EXERCISES
