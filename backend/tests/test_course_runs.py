import pytest

from tests.helpers import (
    OTHER_STUDENT,
    TEACHER,
    as_student,
    back_to_teacher,
    create_student,
    sign_in,
)
from tests.test_course_access import COLLEAGUE, THIRD, as_teacher, grant, invite_teachers
from tests.test_courses import create_course

RUN = "Španělština 2.B 2026/27"


def start_run(client, course_id, name=RUN):
    return client.post(f"/api/courses/{course_id}/runs", json={"name": name})


def runs_of(client, course_id):
    return client.get(f"/api/courses/{course_id}/runs")


def enrol_class(client, run_id, class_id):
    return client.put(f"/api/runs/{run_id}/classes/{class_id}")


def enrol_student(client, run_id, student_id):
    return client.put(f"/api/runs/{run_id}/students/{student_id}")


def create_class(client, name="2.B 2026/27"):
    return client.post("/api/classes", json={"name": name}).json()


def add_member(client, class_id, student_id):
    assert client.put(f"/api/classes/{class_id}/members/{student_id}").status_code == 200


def roster(client, run_id) -> list[str]:
    return [s["name"] for s in client.get(f"/api/runs/{run_id}").json()["roster"]]


@pytest.fixture
def colleagues(teacher, sender) -> dict[str, int]:
    ids = invite_teachers(teacher, sender, COLLEAGUE, THIRD)
    ids[TEACHER] = teacher.get("/api/auth/me").json()["id"]
    return ids


@pytest.fixture
def course(teacher) -> dict:
    return create_course(teacher).json()


@pytest.fixture
def run(teacher, course) -> dict:
    return start_run(teacher, course["id"]).json()


# Starting a run


def test_the_owner_starts_a_named_run_of_a_course(teacher, course, clock):
    me = teacher.get("/api/auth/me").json()

    started = start_run(teacher, course["id"], "  Španělština 2.B 2026/27 ")

    assert started.status_code == 201
    body = started.json()
    assert body == {
        "id": body["id"],
        "name": RUN,
        "course": {"id": course["id"], "name": course["name"]},
        "teacher_id": me["id"],
        "created_at": "2026-09-24T08:00:00Z",
        "classes": [],
        "students": [],
        "roster": [],
    }
    assert teacher.get(f"/api/runs/{body['id']}").json() == body


def test_a_run_needs_a_name(teacher, course):
    assert start_run(teacher, course["id"], "   ").status_code == 422
    assert start_run(teacher, course["id"], "x" * 201).status_code == 422


def test_an_editor_starts_a_run_but_a_viewer_or_anyone_else_cannot(teacher, colleagues, course):
    grant(teacher, course["id"], COLLEAGUE, "edit")
    grant(teacher, course["id"], THIRD, "fork")

    as_teacher(teacher, COLLEAGUE)
    assert start_run(teacher, course["id"]).status_code == 201
    as_teacher(teacher, THIRD)
    assert start_run(teacher, course["id"]).json() == {"detail": "forbidden"}
    back_to_teacher(teacher)
    teacher.delete(f"/api/courses/{course['id']}/access/{colleagues[THIRD]}")
    as_teacher(teacher, THIRD)
    assert start_run(teacher, course["id"]).status_code == 404


def test_a_student_cannot_start_a_run(teacher, sender, course):
    as_student(teacher, sender)

    assert start_run(teacher, course["id"]).status_code == 403


# Runs of a course, seen by their teacher only


def test_the_course_lists_the_runs_its_teacher_started(teacher, colleagues, course):
    grant(teacher, course["id"], COLLEAGUE, "edit")
    mine = start_run(teacher, course["id"], "2.B").json()
    earlier = start_run(teacher, course["id"], "2.A").json()
    as_teacher(teacher, COLLEAGUE)
    theirs = start_run(teacher, course["id"], "3.C").json()

    assert runs_of(teacher, course["id"]).json() == [
        {"id": theirs["id"], "name": "3.C", "roster_size": 0}
    ]
    back_to_teacher(teacher)
    assert runs_of(teacher, course["id"]).json() == [
        {"id": earlier["id"], "name": "2.A", "roster_size": 0},
        {"id": mine["id"], "name": "2.B", "roster_size": 0},
    ]


def test_only_the_run_teacher_sees_and_changes_the_run(teacher, colleagues, course, run):
    grant(teacher, course["id"], COLLEAGUE, "edit")
    student = create_student(teacher).json()
    klass = create_class(teacher)

    as_teacher(teacher, COLLEAGUE)
    base = f"/api/runs/{run['id']}"
    for response in (
        teacher.get(base),
        teacher.patch(base, json={"name": "Mine now"}),
        enrol_class(teacher, run["id"], klass["id"]),
        enrol_student(teacher, run["id"], student["id"]),
        teacher.delete(f"{base}/students/{student['id']}"),
    ):
        assert response.status_code == 404
    back_to_teacher(teacher)
    assert teacher.get(base).json()["name"] == RUN
    assert teacher.get(base).json()["students"] == []


def test_the_run_teacher_renames_the_run(teacher, run):
    renamed = teacher.patch(f"/api/runs/{run['id']}", json={"name": "2.B 2026/27 odpoledne"})

    assert renamed.status_code == 200
    assert renamed.json()["name"] == "2.B 2026/27 odpoledne"
    assert teacher.patch(f"/api/runs/{run['id']}", json={"name": " "}).status_code == 422


def test_an_unknown_run_is_not_found(teacher):
    assert teacher.get("/api/runs/999").status_code == 404


# Enrolment


def test_classes_and_students_are_enrolled_and_removed(teacher, run):
    klass = create_class(teacher)
    other = create_class(teacher, "2.A 2026/27")
    jana = create_student(teacher, name="Jana Veselá").json()
    petr = create_student(teacher, OTHER_STUDENT, name="Petr Malý").json()
    add_member(teacher, klass["id"], jana["id"])

    enrol_class(teacher, run["id"], klass["id"])
    enrol_class(teacher, run["id"], other["id"])
    enrolled = enrol_student(teacher, run["id"], petr["id"])

    assert enrolled.status_code == 200
    body = enrolled.json()
    assert body["classes"] == [
        {"id": other["id"], "name": "2.A 2026/27", "member_count": 0},
        {"id": klass["id"], "name": "2.B 2026/27", "member_count": 1},
    ]
    assert body["students"] == [
        {"id": petr["id"], "name": "Petr Malý", "email": OTHER_STUDENT, "state": "invited"}
    ]
    assert body["roster"] == [
        {
            "id": jana["id"],
            "name": "Jana Veselá",
            "email": jana["email"],
            "direct": False,
            "classes": ["2.B 2026/27"],
        },
        {
            "id": petr["id"],
            "name": "Petr Malý",
            "email": OTHER_STUDENT,
            "direct": True,
            "classes": [],
        },
    ]

    teacher.delete(f"/api/runs/{run['id']}/classes/{klass['id']}")
    removed = teacher.delete(f"/api/runs/{run['id']}/students/{petr['id']}")
    assert removed.status_code == 200
    assert [c["name"] for c in removed.json()["classes"]] == ["2.A 2026/27"]
    assert removed.json()["students"] == []
    assert removed.json()["roster"] == []


def test_enrolling_again_changes_nothing(teacher, run):
    klass = create_class(teacher)
    jana = create_student(teacher).json()

    for _ in range(2):
        enrol_class(teacher, run["id"], klass["id"])
        again = enrol_student(teacher, run["id"], jana["id"])

    assert len(again.json()["classes"]) == 1
    assert len(again.json()["students"]) == 1


def test_a_student_in_an_enrolled_class_and_enrolled_directly_is_on_the_roster_once(teacher, run):
    klass = create_class(teacher)
    other = create_class(teacher, "Seminář")
    jana = create_student(teacher).json()
    add_member(teacher, klass["id"], jana["id"])
    add_member(teacher, other["id"], jana["id"])
    enrol_class(teacher, run["id"], klass["id"])
    enrol_class(teacher, run["id"], other["id"])

    body = enrol_student(teacher, run["id"], jana["id"]).json()

    assert [(s["name"], s["direct"], s["classes"]) for s in body["roster"]] == [
        ("Jana Veselá", True, ["2.B 2026/27", "Seminář"])
    ]


def test_the_roster_follows_live_class_membership(teacher, run):
    klass = create_class(teacher)
    jana = create_student(teacher, name="Jana Veselá").json()
    petr = create_student(teacher, OTHER_STUDENT, name="Petr Malý").json()
    add_member(teacher, klass["id"], jana["id"])
    enrol_class(teacher, run["id"], klass["id"])

    add_member(teacher, klass["id"], petr["id"])
    assert roster(teacher, run["id"]) == ["Jana Veselá", "Petr Malý"]

    teacher.delete(f"/api/classes/{klass['id']}/members/{jana['id']}")
    assert roster(teacher, run["id"]) == ["Petr Malý"]


def test_deactivated_students_and_minors_without_consent_are_not_on_the_roster(teacher, run):
    klass = create_class(teacher)
    jana = create_student(teacher, name="Jana Veselá").json()
    petr = create_student(teacher, OTHER_STUDENT, name="Petr Malý").json()
    eva = create_student(teacher, "eva@skola.example", name="Eva Malá", minor=True).json()
    for student in (jana, petr, eva):
        add_member(teacher, klass["id"], student["id"])
    enrol_class(teacher, run["id"], klass["id"])
    enrol_student(teacher, run["id"], eva["id"])

    teacher.patch(f"/api/students/{petr['id']}", json={"active": False})

    body = teacher.get(f"/api/runs/{run['id']}").json()
    assert [s["name"] for s in body["roster"]] == ["Jana Veselá"]
    # The enrolment stays, so a student who is reactivated or gets consent is back.
    assert [(s["name"], s["state"]) for s in body["students"]] == [("Eva Malá", "awaiting_consent")]
    teacher.patch(f"/api/students/{petr['id']}", json={"active": True})
    assert roster(teacher, run["id"]) == ["Jana Veselá", "Petr Malý"]


def test_the_run_list_counts_the_roster(teacher, course, run):
    klass = create_class(teacher)
    jana = create_student(teacher).json()
    petr = create_student(teacher, OTHER_STUDENT, name="Petr Malý").json()
    add_member(teacher, klass["id"], jana["id"])
    enrol_class(teacher, run["id"], klass["id"])
    enrol_student(teacher, run["id"], jana["id"])
    enrol_student(teacher, run["id"], petr["id"])

    assert runs_of(teacher, course["id"]).json()[0]["roster_size"] == 2


def test_only_students_and_existing_classes_are_enrolled(teacher, run):
    me = teacher.get("/api/auth/me").json()

    assert enrol_student(teacher, run["id"], me["id"]).status_code == 404
    assert enrol_student(teacher, run["id"], 999).status_code == 404
    assert enrol_class(teacher, run["id"], 999).status_code == 404


# A run points at its course


def test_a_run_holds_no_copy_of_the_course(teacher, course, run):
    teacher.patch(f"/api/courses/{course['id']}", json={"name": "Španělština pro pokročilé"})

    assert teacher.get(f"/api/runs/{run['id']}").json()["course"] == {
        "id": course["id"],
        "name": "Španělština pro pokročilé",
    }


def test_erasure_takes_the_student_out_of_runs_for_good(teacher, run):
    student = create_student(teacher).json()
    enrol_student(teacher, run["id"], student["id"])
    teacher.cookies.clear()
    sign_in(teacher)
    teacher.post(
        f"/api/admin/students/{student['id']}/erasure", json={"confirmation": "Jana Veselá"}
    )
    back_to_teacher(teacher)

    assert teacher.get(f"/api/runs/{run['id']}").json()["students"] == []
    refused = enrol_student(teacher, run["id"], student["id"])
    assert refused.status_code == 410
    assert refused.json() == {"detail": "student_erased"}


def test_a_run_of_a_course_its_teacher_no_longer_sees_is_gone_for_them(teacher, colleagues, course):
    grant(teacher, course["id"], COLLEAGUE, "edit")
    as_teacher(teacher, COLLEAGUE)
    theirs = start_run(teacher, course["id"]).json()

    back_to_teacher(teacher)
    grant(teacher, course["id"], COLLEAGUE, "view")
    as_teacher(teacher, COLLEAGUE)
    # With a view right they still find and teach it from the course page.
    assert [r["id"] for r in runs_of(teacher, course["id"]).json()] == [theirs["id"]]
    assert teacher.get(f"/api/runs/{theirs['id']}").status_code == 200

    back_to_teacher(teacher)
    teacher.delete(f"/api/courses/{course['id']}/access/{colleagues[COLLEAGUE]}")
    as_teacher(teacher, COLLEAGUE)
    assert teacher.get(f"/api/runs/{theirs['id']}").status_code == 404
