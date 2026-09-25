"""What the student's home on a phone reads (#104): each piece of work with its course, how far
the attempt being worked on got, the score of the one that counts, whether results were
published since the student last looked, and retracted work with the teacher's reason."""

# ruff: noqa: F811
from datetime import timedelta

from tests.helpers import back_to_teacher
from tests.test_attempts import (  # noqa: F401 - `course` is a fixture
    CLOSED,
    RIGHT,
    WRONG,
    Course,
    as_student,
    course,
    draft,
    my_release,
    my_releases,
    released,
    started,
    submit,
)
from tests.test_open_assessment import (
    ASSESSED,
    answered,
    assess_open,
    detail,
    override,
    publish,
    tries,
)


def mine(client) -> dict:
    [found] = my_releases(client)
    return found


def test_each_piece_of_work_names_its_course(teacher, course: Course):
    released(teacher, course)
    as_student(teacher)

    assert mine(teacher)["course"] == "Španělština 2.B"


def test_work_being_done_says_how_many_exercises_are_answered(teacher, course: Course):
    release_id = released(teacher, course, feedback_mode="at_the_end")
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]
    draft(teacher, attempt_id, "hablar", RIGHT["hablar"])
    draft(teacher, attempt_id, "gaps", RIGHT["gaps"])

    found = mine(teacher)

    assert found["state"] == "in_progress"
    assert found["progress"] == {"answered": 2, "total": 6}
    assert found["score"] is None


def test_work_not_started_has_no_progress(teacher, course: Course):
    released(teacher, course)
    as_student(teacher)

    assert mine(teacher)["progress"] is None


def test_submitted_work_has_the_score_the_student_sees_with_written_answers_pending(
    teacher, course: Course
):
    release_id = released(teacher, course, feedback_mode="at_the_end")
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]
    body = {
        **{k: RIGHT[k] for k in CLOSED if k != "hablar"},
        "hablar": WRONG["hablar"],
        "write": RIGHT["write"],
    }
    assert submit(teacher, attempt_id, body).status_code == 200

    found = mine(teacher)

    assert found["progress"] is None
    assert found["score"] == {"points": 4.0, "total": 6, "pending": 1}


def test_published_results_are_new_until_the_student_opens_the_work(
    teacher, course: Course, models
):
    release_id, _ = answered(teacher, course)
    as_student(teacher)
    assert mine(teacher)["new_assessment"] is False
    back_to_teacher(teacher)
    models.script(ASSESSED)
    assess_open(teacher, course, release_id)
    publish(teacher, course, release_id)
    as_student(teacher)

    assert mine(teacher)["new_assessment"] is True
    assert mine(teacher)["score"]["pending"] == 0
    my_release(teacher, release_id)
    assert mine(teacher)["new_assessment"] is False


def test_a_later_publishing_is_new_again(teacher, course: Course, models, clock):
    release_id, _ = answered(teacher, course)
    models.script(ASSESSED)
    assess_open(teacher, course, release_id)
    publish(teacher, course, release_id)
    as_student(teacher)
    my_release(teacher, release_id)
    back_to_teacher(teacher)
    clock.now += timedelta(minutes=5)
    results = teacher.get(f"/api/runs/{course.run}/releases/{release_id}/results/{course.jana}")
    review = results.json()["attempts"][0]["first"]["answers"]["write"]["tries"][0]["assessment"]
    override(teacher, course, release_id, review["id"], 0.5)
    publish(teacher, course, release_id)
    as_student(teacher)

    assert mine(teacher)["new_assessment"] is True


def test_retracted_work_stays_in_the_list_with_the_reason(teacher, course: Course):
    release_id = released(teacher, course)
    teacher.post(
        f"/api/runs/{course.run}/releases/{release_id}/retraction",
        json={"reason": "Wrong material."},
    )
    as_student(teacher)

    found = mine(teacher)

    assert found["id"] == release_id
    assert found["retraction"] == {"reason": "Wrong material.", "whole_release": True}


def test_a_retracted_attempt_says_why_until_another_is_started(teacher, course: Course):
    release_id = released(teacher, course, attempts="repeated")
    as_student(teacher)
    started(teacher, release_id)
    back_to_teacher(teacher)
    teacher.post(
        f"/api/runs/{course.run}/releases/{release_id}/students/{course.jana}/retraction",
        json={"reason": "A typo."},
    )
    as_student(teacher)

    assert mine(teacher)["retraction"] == {"reason": "A typo.", "whole_release": False}


def test_a_published_override_of_a_closed_answer_counts_in_the_score(teacher, course: Course):
    release_id, _ = answered(teacher, course)
    review = tries(detail(teacher, course, release_id)["attempts"][0], "hablar")[0]["assessment"]
    override(teacher, course, release_id, review["id"], 0.0, "Copied from a neighbour.")
    publish(teacher, course, release_id)
    as_student(teacher)

    # Five closed answers were right; one is now scored 0, and the written one waits.
    assert mine(teacher)["score"] == {"points": 4.0, "total": 6, "pending": 1}


def test_results_stay_new_while_another_attempt_is_shown(teacher, course: Course, models):
    release_id, _ = answered(teacher, course, attempts="repeated")
    as_student(teacher)
    started(teacher, release_id)
    back_to_teacher(teacher)
    models.script(ASSESSED)
    assess_open(teacher, course, release_id)
    publish(teacher, course, release_id)
    as_student(teacher)

    shown = my_release(teacher, release_id)

    assert shown["attempt"]["number"] == 2
    assert mine(teacher)["new_assessment"] is True


def test_the_list_says_whether_the_work_can_be_started(teacher, course: Course, clock):
    released(
        teacher,
        course,
        due_at=(clock.now + timedelta(hours=1)).isoformat(),
        late_submissions="refuse",
    )
    as_student(teacher)
    assert mine(teacher)["can_start"] is True
    clock.now += timedelta(hours=2)

    assert mine(teacher)["can_start"] is False
