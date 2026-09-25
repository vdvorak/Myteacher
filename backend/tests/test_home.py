"""The teacher's home (#103): the getting-started checklist until their first release, what needs
their attention, the courses still being prepared, and for an admin what the instance lacks."""

# ruff: noqa: F811
from datetime import timedelta

from pydantic_ai.exceptions import ModelHTTPError

from tests.helpers import back_to_teacher, configure_smtp, create_student, sign_in
from tests.test_attempts import (  # noqa: F401 - `course` is a fixture
    MATERIAL,
    Course,
    as_student,
    course,
    released,
    started,
)
from tests.test_classroom_materials import generate, generated, materials_url
from tests.test_course_access import COLLEAGUE, access_url, as_teacher, grant, invite_teachers
from tests.test_course_runs import add_member, create_class, start_run
from tests.test_courses import as_other_teacher, create_course
from tests.test_interview import add_key
from tests.test_my_work import my_runs
from tests.test_open_assessment import answered
from tests.test_reference_documents import approve_map, cited
from tests.test_reference_documents import generated as generated_document
from tests.test_releases import release
from tests.test_sources import paste
from tests.test_topics import add


def home(client) -> dict:
    response = client.get("/api/home")
    assert response.status_code == 200, response.json()
    return response.json()


def steps(checklist: dict) -> dict[str, bool]:
    return {k: v for k, v in checklist.items() if not k.endswith("_id")}


# Getting started


def test_a_new_teacher_starts_with_nothing_done(teacher):
    found = home(teacher)

    assert found["checklist"] == {
        "assistant": False,
        "course": False,
        "sources": False,
        "concept_map": False,
        "material": False,
        "students": False,
        "run": False,
        "course_id": None,
        "topic_id": None,
        "run_id": None,
    }
    assert found["attention"] == []
    assert found["courses"] == []
    assert found["instance"] is None


def test_each_step_is_done_by_what_the_teacher_made(teacher, sender, models):
    add_key(teacher)
    assert steps(home(teacher)["checklist"])["assistant"] is True
    course_id = create_course(teacher).json()["id"]
    assert home(teacher)["checklist"]["course_id"] == course_id
    assert steps(home(teacher)["checklist"])["course"] is False

    teacher.patch(f"/api/courses/{course_id}", json={"brief_confirmed": True})
    teacher.patch(f"/api/courses/{course_id}", json={"sources_skipped": True})
    topic_id = add(teacher, course_id, "Presente").json()[0]["id"]
    approve_map(teacher, course_id, topic_id)
    generated(teacher, (course_id, topic_id), models, output=MATERIAL)
    klass = create_class(teacher)
    student = create_student(teacher).json()
    add_member(teacher, klass["id"], student["id"])
    run_id = start_run(teacher, course_id).json()["id"]

    checklist = home(teacher)["checklist"]
    assert steps(checklist) == {
        "assistant": True,
        "course": True,
        "sources": True,
        "concept_map": True,
        "material": True,
        "students": True,
        "run": True,
    }
    assert (checklist["course_id"], checklist["topic_id"], checklist["run_id"]) == (
        course_id,
        topic_id,
        run_id,
    )


def test_the_checklist_leads_to_the_latest_course_and_its_approved_topic(teacher):
    first = create_course(teacher, name="Starý kurz").json()["id"]
    latest = create_course(teacher, name="Nový kurz").json()["id"]
    add(teacher, latest, "Bez mapy")
    approved = add(teacher, latest, "S mapou").json()[-1]["id"]
    approve_map(teacher, latest, approved)
    add(teacher, first, "Jinde")

    checklist = home(teacher)["checklist"]

    assert (checklist["course_id"], checklist["topic_id"]) == (latest, approved)


def test_a_generation_that_failed_is_no_material_yet(teacher, models):
    add_key(teacher)
    course_id = create_course(teacher).json()["id"]
    topic_id = add(teacher, course_id, "Presente").json()[0]["id"]
    approve_map(teacher, course_id, topic_id)
    models.script(ModelHTTPError(429, "claude", {"error": "rate limited"}))
    started = generate(teacher, (course_id, topic_id))
    assert started.status_code == 202, started.json()

    found = home(teacher)

    assert found["checklist"]["material"] is False
    assert found["courses"][0]["topics_ready"] == 0


def test_a_shared_course_the_teacher_may_edit_ticks_their_steps(teacher, sender):
    invite_teachers(teacher, sender, COLLEAGUE)
    course_id = create_course(teacher).json()["id"]
    teacher.patch(f"/api/courses/{course_id}", json={"brief_confirmed": True})
    grant(teacher, course_id, COLLEAGUE, "edit")
    as_teacher(teacher, COLLEAGUE)

    checklist = home(teacher)["checklist"]

    assert (checklist["course"], checklist["course_id"]) == (True, course_id)


def test_the_checklist_stays_gone_after_losing_the_course_released_into(teacher, sender, models):
    ids = invite_teachers(teacher, sender, COLLEAGUE)
    course_id = create_course(teacher).json()["id"]
    topic_id = add(teacher, course_id, "Presente").json()[0]["id"]
    approve_map(teacher, course_id, topic_id)
    grant(teacher, course_id, COLLEAGUE, "edit")
    as_teacher(teacher, COLLEAGUE)
    add_key(teacher)
    material = generated(teacher, (course_id, topic_id), models, output=MATERIAL)
    run_id = start_run(teacher, course_id).json()["id"]
    assert release(teacher, run_id, material["id"]).status_code == 201
    back_to_teacher(teacher)
    teacher.delete(f"{access_url(course_id)}/{ids[COLLEAGUE]}")
    as_teacher(teacher, COLLEAGUE)

    assert home(teacher)["checklist"] is None


def test_the_checklist_is_gone_after_the_first_release(teacher, course: Course):
    assert home(teacher)["checklist"] is not None

    released(teacher, course)

    assert home(teacher)["checklist"] is None


def test_another_teachers_work_does_not_tick_the_steps(teacher, course: Course, sender):
    released(teacher, course)
    as_other_teacher(teacher, sender)

    checklist = home(teacher)["checklist"]

    assert checklist["course"] is False
    assert checklist["course_id"] is None
    assert checklist["run"] is False


# What needs attention


def test_open_answers_waiting_for_assessment_need_attention(teacher, course: Course):
    release_id, _ = answered(teacher, course)

    [item] = [i for i in home(teacher)["attention"] if i["kind"] == "open_answers"]

    assert item == {
        "kind": "open_answers",
        "count": 1,
        "course_id": course.id,
        "course_name": "Španělština 2.B",
        "topic_id": None,
        "run_id": course.run,
        "release_id": release_id,
        "title": MATERIAL["title"],
        "due_at": None,
        "submitted": None,
        "total": None,
        "tab": None,
    }


def test_generated_work_not_reviewed_yet_needs_attention_until_kept(teacher, course: Course):
    [item] = [i for i in home(teacher)["attention"] if i["kind"] == "drafts"]
    assert (item["course_id"], item["topic_id"], item["count"]) == (*course.topic, 1)
    assert item["title"] == "Pretérito indefinido"
    assert item["tab"] == "materials"

    teacher.post(
        f"{materials_url(*course.topic)}/{course.material}/reactions", json={"kind": "kept"}
    )

    assert [i for i in home(teacher)["attention"] if i["kind"] == "drafts"] == []


def test_a_release_due_in_the_next_days_needs_attention_with_how_many_submitted(
    teacher, course: Course, clock
):
    soon = released(teacher, course, due_at=(clock.now + timedelta(days=2)).isoformat())
    released(teacher, course, due_at=(clock.now + timedelta(days=10)).isoformat())
    as_student(teacher)
    started(teacher, soon)
    back_to_teacher(teacher)

    [item] = [i for i in home(teacher)["attention"] if i["kind"] == "due_soon"]

    assert item["release_id"] == soon
    assert item["run_id"] == course.run
    assert (item["submitted"], item["total"]) == (0, 2)
    assert item["due_at"] == (clock.now + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ")


def test_a_release_past_its_due_date_or_retracted_is_not_due_soon(teacher, course: Course, clock):
    released(teacher, course, due_at=(clock.now + timedelta(hours=1)).isoformat())
    retracted = released(teacher, course, due_at=(clock.now + timedelta(days=1)).isoformat())
    teacher.post(
        f"/api/runs/{course.run}/releases/{retracted}/retraction", json={"reason": "Oops."}
    )
    clock.now += timedelta(hours=2)

    assert [i for i in home(teacher)["attention"] if i["kind"] == "due_soon"] == []


def create_minor(client) -> dict:
    return create_student(client, email="minor@example.org", name="Eva Malá", minor=True).json()


def test_students_of_the_teachers_runs_awaiting_consent_need_attention(teacher, course: Course):
    minor = create_minor(teacher)
    add_member(teacher, course.klass, minor["id"])

    [item] = [i for i in home(teacher)["attention"] if i["kind"] == "awaiting_consent"]

    assert item["count"] == 1


def test_a_minor_outside_the_teachers_runs_is_not_their_concern(teacher, course: Course):
    create_minor(teacher)

    assert [i for i in home(teacher)["attention"] if i["kind"] == "awaiting_consent"] == []


def test_another_teachers_attention_items_are_not_shown(teacher, course: Course, sender):
    answered(teacher, course)
    as_other_teacher(teacher, sender)

    assert home(teacher)["attention"] == []


def test_document_drafts_lead_to_the_documents_apart_from_material_drafts(
    teacher, course: Course, models
):
    source = paste(teacher, course.id).json()["source"]["id"]
    generated_document(teacher, course.topic, models, cited(source))

    drafts = [i for i in home(teacher)["attention"] if i["kind"] == "drafts"]

    assert [(i["tab"], i["count"]) for i in drafts] == [("documents", 1), ("materials", 1)]


def test_a_release_to_chosen_students_counts_only_them(teacher, course: Course, clock):
    due = (clock.now + timedelta(days=1)).isoformat()
    release(
        teacher,
        course.run,
        course.material,
        audience="chosen",
        student_ids=[course.jana],
        due_at=due,
    )

    [item] = [i for i in home(teacher)["attention"] if i["kind"] == "due_soon"]

    assert (item["submitted"], item["total"]) == (0, 1)


# Courses being prepared and my runs


def test_courses_still_being_prepared_say_how_far_they_got(teacher, course: Course):
    fresh = create_course(teacher, name="Algebra").json()["id"]

    found = home(teacher)["courses"]

    assert found == [
        {
            "id": fresh,
            "name": "Algebra",
            "brief": False,
            "sources": False,
            "topics": 0,
            "topics_ready": 0,
        },
        {
            "id": course.id,
            "name": "Španělština 2.B",
            "brief": False,
            "sources": False,
            "topics": 1,
            "topics_ready": 1,
        },
    ]


def test_a_course_with_every_step_done_is_no_longer_being_prepared(teacher, course: Course):
    teacher.patch(f"/api/courses/{course.id}", json={"brief_confirmed": True})
    teacher.patch(f"/api/courses/{course.id}", json={"sources_skipped": True})

    assert home(teacher)["courses"] == []


def test_the_latest_release_of_each_run_says_how_many_submitted(teacher, course: Course):
    answered(teacher, course)

    [run] = my_runs(teacher)

    assert (run["latest_release"]["submitted"], run["latest_release"]["total"]) == (1, 2)


# The instance


def test_an_admin_sees_what_the_instance_lacks_until_email_works_and_a_teacher_is_invited(
    app_client, sender
):
    sign_in(app_client)
    assert home(app_client)["instance"] == {"smtp": False, "teacher_invited": False}
    configure_smtp(app_client)
    assert home(app_client)["instance"] == {"smtp": True, "teacher_invited": False}

    app_client.post("/api/admin/teachers", json={"email": "t@example.org", "language": "cs"})

    assert home(app_client)["instance"] is None


def test_a_deactivated_teacher_is_no_teacher_invited(app_client, sender):
    sign_in(app_client)
    configure_smtp(app_client)
    invited = app_client.post(
        "/api/admin/teachers", json={"email": "t@example.org", "language": "cs"}
    ).json()

    app_client.patch(f"/api/admin/teachers/{invited['id']}", json={"active": False})

    assert home(app_client)["instance"] == {"smtp": True, "teacher_invited": False}


def test_students_have_no_home_to_prepare(teacher, course: Course):
    as_student(teacher)

    assert teacher.get("/api/home").status_code == 403
