"""What the redesigned run and release pages read (#102): the runs a material is released in,
each release's progress, who is behind, and the open answers of a release one at a time."""

# ruff: noqa: F811
from datetime import timedelta

from tests.helpers import OTHER_STUDENT, back_to_teacher
from tests.test_attempts import (  # noqa: F401 - `course` is a fixture
    CLOSED,
    MATERIAL,
    RIGHT,
    Course,
    as_student,
    course,
    released,
    started,
    submit,
)
from tests.test_classroom_materials import materials_url
from tests.test_course_access import COLLEAGUE, as_teacher, grant, invite_teachers
from tests.test_course_runs import start_run
from tests.test_courses import as_other_teacher, create_course
from tests.test_open_assessment import ASSESSED, INJECTION, answered, assess_open
from tests.test_releases import release
from tests.test_topics import add


def material_releases(client, course: Course) -> list[dict]:
    response = client.get(f"{materials_url(*course.topic)}/{course.material}/releases")
    assert response.status_code == 200, response.json()
    return response.json()


def run_releases(client, course: Course) -> list[dict]:
    response = client.get(f"/api/runs/{course.run}/releases")
    assert response.status_code == 200, response.json()
    return response.json()


def open_answers(client, course: Course, release_id: int) -> list[dict]:
    response = client.get(f"/api/runs/{course.run}/releases/{release_id}/open-answers")
    assert response.status_code == 200, response.json()
    return response.json()


# The runs a material is released in


def test_a_material_says_which_runs_it_is_released_in(teacher, course: Course, clock):
    release_id = released(teacher, course)

    assert material_releases(teacher, course) == [
        {
            "run_id": course.run,
            "run_name": teacher.get(f"/api/runs/{course.run}").json()["name"],
            "release_id": release_id,
            "version": 1,
            "released_at": clock.now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
    ]


def test_a_retracted_release_is_not_listed_for_the_material(teacher, course: Course):
    release_id = released(teacher, course)
    teacher.post(
        f"/api/runs/{course.run}/releases/{release_id}/retraction", json={"reason": "Oops."}
    )

    assert material_releases(teacher, course) == []


def test_only_the_runs_the_teacher_teaches_are_listed_for_the_material(
    teacher, course: Course, sender
):
    invite_teachers(teacher, sender, COLLEAGUE)
    grant(teacher, course.id, COLLEAGUE, "edit")
    as_teacher(teacher, COLLEAGUE)
    theirs = start_run(teacher, course.id, name="Svobodův běh").json()["id"]
    assert release(teacher, theirs, course.material).status_code == 201

    assert [r["run_name"] for r in material_releases(teacher, course)] == ["Svobodův běh"]
    back_to_teacher(teacher)
    assert material_releases(teacher, course) == []


def test_a_material_of_another_topic_or_course_is_not_found(teacher, course: Course, sender):
    other_topic = add(teacher, course.id, "Imperfecto").json()[-1]["id"]
    other_course = create_course(teacher, name="Algebra").json()["id"]
    url = f"classroom-materials/{course.material}/releases"

    assert teacher.get(f"/api/courses/{course.id}/topics/{other_topic}/{url}").status_code == 404
    assert (
        teacher.get(f"/api/courses/{other_course}/topics/{course.topic[1]}/{url}").status_code
        == 404
    )
    as_other_teacher(teacher, sender)
    assert teacher.get(f"{materials_url(*course.topic)}/{url.split('/', 1)[1]}").status_code == 404


# Each release's progress


def test_each_release_says_how_many_submitted_and_how_many_answers_wait(teacher, course: Course):
    release_id, _ = answered(teacher, course)

    [listed] = run_releases(teacher, course)

    assert listed["id"] == release_id
    assert listed["topic_id"] == course.topic[1]
    assert (listed["submitted"], listed["total"], listed["waiting"]) == (1, 2, 1)
    assert listed["overdue_student_ids"] == []


def test_the_students_who_did_not_submit_by_the_due_date_are_behind(teacher, course: Course, clock):
    answered(teacher, course, due_at=(clock.now + timedelta(hours=1)).isoformat())
    clock.now += timedelta(hours=2)

    [listed] = run_releases(teacher, course)

    assert listed["overdue_student_ids"] == [course.petr]


def test_an_attempt_closed_at_a_refusing_due_date_counts_as_submitted(
    teacher, course: Course, clock
):
    due = (clock.now + timedelta(hours=1)).isoformat()
    release_id = released(teacher, course, due_at=due, late_submissions="refuse")
    as_student(teacher)
    started(teacher, release_id)
    back_to_teacher(teacher)
    clock.now += timedelta(hours=2)

    [listed] = run_releases(teacher, course)

    assert listed["submitted"] == 1
    assert listed["overdue_student_ids"] == [course.petr]


# The open answers of a release


def test_the_open_answers_come_with_the_student_the_prompt_and_the_assessment(
    teacher, course: Course
):
    release_id, _ = answered(teacher, course)

    [answer] = open_answers(teacher, course, release_id)

    assert answer["student"] == {"id": course.jana, "name": "Jana Veselá"}
    assert answer["exercise_id"] == "write"
    assert answer["prompt"] == "Write about yourself."
    assert answer["answer"] == {"type": "free_text", "text": INJECTION}
    assert answer["review"]["score"] is None
    assert answer["review"]["flagged"] is False


def test_flagged_answers_come_first(teacher, course: Course, models):
    release_id, _ = answered(teacher, course)
    as_student(teacher, OTHER_STUDENT)
    attempt_id = started(teacher, release_id)["id"]
    body = {**{k: RIGHT[k] for k in CLOSED}, "write": {"type": "free_text", "text": "Soy Petr."}}
    assert submit(teacher, attempt_id, body).status_code == 200
    back_to_teacher(teacher)
    too_many = {**ASSESSED, "criteria": [{"criterion_id": "content", "points": 5, "comment": ""}]}
    unknown = {**ASSESSED, "criteria": [{"criterion_id": "style", "points": 1, "comment": ""}]}
    models.script(ASSESSED, too_many, unknown)
    assess_open(teacher, course, release_id)

    answers = open_answers(teacher, course, release_id)

    assert [(a["student"]["id"], a["review"]["flagged"]) for a in answers] == [
        (course.petr, True),
        (course.jana, False),
    ]


def test_only_the_answer_of_the_attempt_that_counts_is_listed(teacher, course: Course):
    release_id, first = answered(teacher, course, attempts="repeated")
    as_student(teacher)
    again = started(teacher, release_id)["id"]
    body = {**{k: RIGHT[k] for k in CLOSED}, "write": {"type": "free_text", "text": "Soy Jana."}}
    assert submit(teacher, again, body).status_code == 200
    back_to_teacher(teacher)

    answers = open_answers(teacher, course, release_id)

    assert [a["answer"]["text"] for a in answers] == ["Soy Jana."]
    assert first != again


def test_only_the_run_teacher_reads_the_open_answers(teacher, course: Course, sender):
    release_id, _ = answered(teacher, course)
    invite_teachers(teacher, sender, COLLEAGUE)
    as_teacher(teacher, COLLEAGUE)

    response = teacher.get(f"/api/runs/{course.run}/releases/{release_id}/open-answers")

    assert response.status_code == 404
