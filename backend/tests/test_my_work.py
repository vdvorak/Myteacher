"""What the app shell shows every teacher (#100): all the runs they teach, across courses, and
the assistant work they started lately, with where its result is."""

# ruff: noqa: F811
from datetime import timedelta

from tests.helpers import back_to_teacher
from tests.test_attempts import (  # noqa: F401 - `course` is a fixture
    MATERIAL,
    Course,
    as_student,
    course,
    released,
)
from tests.test_concept_maps import PROPOSAL, map_url
from tests.test_course_access import COLLEAGUE, access_url, as_teacher, grant, invite_teachers
from tests.test_course_runs import start_run
from tests.test_courses import as_other_teacher, create_course
from tests.test_open_assessment import ASSESSED, answered
from tests.test_topics import add


def my_runs(client) -> list[dict]:
    response = client.get("/api/runs")
    assert response.status_code == 200, response.json()
    return response.json()


def recent_jobs(client) -> list[dict]:
    response = client.get("/api/jobs")
    assert response.status_code == 200, response.json()
    return response.json()


# My course runs


def test_the_runs_a_teacher_teaches_are_listed_across_courses(teacher, course: Course, clock):
    release_id = released(teacher, course)
    other = create_course(teacher, name="Algebra 1.A", subject="Mathematics", taught_language=None)
    start_run(teacher, other.json()["id"], name="Algebra 2026/27")

    runs = my_runs(teacher)

    assert [(r["course"]["name"], r["name"]) for r in runs] == [
        ("Algebra 1.A", "Algebra 2026/27"),
        ("Španělština 2.B", runs[1]["name"]),
    ]
    spanish = runs[1]
    assert spanish["id"] == course.run
    assert spanish["roster_size"] == 2
    assert spanish["latest_release"] == {
        "id": release_id,
        "title": MATERIAL["title"],
        "released_at": clock.now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    assert runs[0]["latest_release"] is None


def test_the_latest_release_is_the_last_one_not_retracted(teacher, course: Course, clock):
    kept = released(teacher, course)
    clock.now += timedelta(hours=1)
    retracted = released(teacher, course)
    teacher.post(
        f"/api/runs/{course.run}/releases/{retracted}/retraction", json={"reason": "Oops."}
    )

    [run] = my_runs(teacher)

    assert run["latest_release"]["id"] == kept


def test_another_teachers_runs_are_not_listed(teacher, course: Course, sender):
    as_other_teacher(teacher, sender)

    assert my_runs(teacher) == []


def test_a_run_of_a_course_the_teacher_can_no_longer_see_is_not_listed(teacher, sender):
    ids = invite_teachers(teacher, sender, COLLEAGUE)
    course_id = create_course(teacher).json()["id"]
    grant(teacher, course_id, COLLEAGUE, "edit")
    as_teacher(teacher, COLLEAGUE)
    start_run(teacher, course_id, name="Svobodův běh")
    assert [r["name"] for r in my_runs(teacher)] == ["Svobodův běh"]
    back_to_teacher(teacher)
    teacher.delete(f"{access_url(course_id)}/{ids[COLLEAGUE]}")
    as_teacher(teacher, COLLEAGUE)

    assert my_runs(teacher) == []


def test_students_have_no_runs_to_teach(teacher, course: Course):
    as_student(teacher)

    assert teacher.get("/api/runs").status_code == 403


# Recent assistant work


def test_recent_jobs_say_where_their_result_is(teacher, course: Course, models):
    release_id, _ = answered(teacher, course)
    tid = add(teacher, course.id, "Presente").json()[-1]["id"]
    models.script(PROPOSAL)
    teacher.post(f"{map_url(course.id, tid)}/proposal")
    models.script(ASSESSED)
    assessing = teacher.post(f"/api/runs/{course.run}/releases/{release_id}/open-assessment")
    assert assessing.status_code == 202, assessing.json()

    jobs = recent_jobs(teacher)

    assessing, proposing, material = jobs[0], jobs[1], jobs[-1]
    assert assessing["kind"] == "open_assessment"
    assert assessing["place"] == {
        "course_id": course.id,
        "topic_id": None,
        "run_id": course.run,
        "release_id": release_id,
    }
    assert proposing["kind"] == "concept_map"
    assert proposing["place"] == {
        "course_id": course.id,
        "topic_id": tid,
        "run_id": None,
        "release_id": None,
    }
    assert proposing["course_name"] == "Španělština 2.B"
    assert proposing["state"] == "succeeded"
    assert material["kind"] == "classroom_material"
    assert material["place"]["topic_id"] == course.topic[1]
    assert all(job["created_at"].endswith("Z") for job in jobs)


def test_only_the_teachers_own_recent_jobs_are_listed(teacher, course: Course, sender):
    as_other_teacher(teacher, sender)

    assert recent_jobs(teacher) == []


def test_jobs_older_than_a_day_are_not_recent(teacher, course: Course, clock):
    clock.now += timedelta(days=1, minutes=1)

    assert recent_jobs(teacher) == []
