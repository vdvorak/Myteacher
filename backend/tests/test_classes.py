from tests.helpers import (
    OTHER_STUDENT,
    as_student,
    back_to_teacher,
    create_student,
    sign_in,
)


def create_class(client, name="2.B 2026/27"):
    return client.post("/api/classes", json={"name": name})


def add(client, class_id, student_id):
    return client.put(f"/api/classes/{class_id}/members/{student_id}")


def remove(client, class_id, student_id):
    return client.delete(f"/api/classes/{class_id}/members/{student_id}")


def member_names(response) -> list[str]:
    return [m["name"] for m in response.json()["members"]]


def test_a_class_is_created_and_renamed(teacher):
    created = create_class(teacher)

    assert created.status_code == 201
    assert created.json() == {"id": created.json()["id"], "name": "2.B 2026/27", "members": []}
    renamed = teacher.patch(f"/api/classes/{created.json()['id']}", json={"name": "3.B 2027/28"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "3.B 2027/28"
    assert teacher.get("/api/classes").json() == [
        {"id": created.json()["id"], "name": "3.B 2027/28", "member_count": 0}
    ]


def test_classes_are_listed_by_name_with_their_member_counts(teacher):
    b = create_class(teacher, "2.B").json()
    create_class(teacher, "2.A")
    student = create_student(teacher).json()
    add(teacher, b["id"], student["id"])

    assert [(c["name"], c["member_count"]) for c in teacher.get("/api/classes").json()] == [
        ("2.A", 0),
        ("2.B", 1),
    ]


def test_a_class_name_is_required_and_unique(teacher):
    first = create_class(teacher).json()
    other = create_class(teacher, "2.A").json()

    assert create_class(teacher, "   ").status_code == 422
    assert create_class(teacher, "x" * 101).status_code == 422
    assert create_class(teacher, " 2.B 2026/27 ").json() == {"detail": "name_taken"}
    renamed = teacher.patch(f"/api/classes/{other['id']}", json={"name": "2.B 2026/27"})
    assert renamed.status_code == 409
    assert renamed.json() == {"detail": "name_taken"}
    kept = teacher.patch(f"/api/classes/{first['id']}", json={"name": "2.B 2026/27"})
    assert kept.status_code == 200


def test_students_are_added_and_removed_at_any_time(teacher):
    klass = create_class(teacher).json()
    jana = create_student(teacher, name="Jana Veselá").json()
    petr = create_student(teacher, OTHER_STUDENT, name="Petr Malý").json()

    add(teacher, klass["id"], petr["id"])
    added = add(teacher, klass["id"], jana["id"])
    assert added.status_code == 200
    assert member_names(added) == ["Jana Veselá", "Petr Malý"]

    removed = remove(teacher, klass["id"], petr["id"])
    assert removed.status_code == 200
    assert member_names(removed) == ["Jana Veselá"]
    assert member_names(teacher.get(f"/api/classes/{klass['id']}")) == ["Jana Veselá"]


def test_adding_and_removing_are_idempotent(teacher):
    klass = create_class(teacher).json()
    student = create_student(teacher).json()

    add(teacher, klass["id"], student["id"])
    assert member_names(add(teacher, klass["id"], student["id"])) == ["Jana Veselá"]
    remove(teacher, klass["id"], student["id"])
    assert remove(teacher, klass["id"], student["id"]).json()["members"] == []


def test_membership_changes_show_on_the_student_page_at_once(teacher):
    a = create_class(teacher, "2.A").json()
    b = create_class(teacher, "2.B").json()
    student = create_student(teacher).json()
    page = f"/api/students/{student['id']}"

    add(teacher, b["id"], student["id"])
    add(teacher, a["id"], student["id"])
    assert teacher.get(page).json()["classes"] == [
        {"id": a["id"], "name": "2.A"},
        {"id": b["id"], "name": "2.B"},
    ]

    remove(teacher, a["id"], student["id"])
    teacher.patch(f"/api/classes/{b['id']}", json={"name": "3.B"})
    assert teacher.get(page).json()["classes"] == [{"id": b["id"], "name": "3.B"}]
    listed = {s["id"]: s for s in teacher.get("/api/students").json()}
    assert listed[student["id"]]["classes"] == [{"id": b["id"], "name": "3.B"}]


def test_a_deactivated_student_stays_in_the_class_marked_inactive(teacher, sender):
    klass = create_class(teacher).json()
    student = as_student(teacher, sender)
    back_to_teacher(teacher)
    add(teacher, klass["id"], student["id"])

    teacher.patch(f"/api/students/{student['id']}", json={"active": False})

    members = teacher.get(f"/api/classes/{klass['id']}").json()["members"]
    assert members == [
        {"id": student["id"], "name": "Jana Veselá", "email": student["email"], "state": "inactive"}
    ]
    assert teacher.get("/api/classes").json()[0]["member_count"] == 1


def test_a_minor_awaiting_consent_shows_so_in_the_class(teacher):
    klass = create_class(teacher).json()
    minor = create_student(teacher, minor=True).json()

    added = add(teacher, klass["id"], minor["id"])

    assert added.json()["members"][0]["state"] == "awaiting_consent"


def test_any_teacher_maintains_any_class(teacher):
    klass = create_class(teacher).json()
    student = create_student(teacher).json()
    teacher.cookies.clear()
    sign_in(teacher)  # the admin, not the teacher who created the class

    assert teacher.patch(f"/api/classes/{klass['id']}", json={"name": "2.C"}).status_code == 200
    assert member_names(add(teacher, klass["id"], student["id"])) == ["Jana Veselá"]
    assert remove(teacher, klass["id"], student["id"]).status_code == 200


def test_only_students_can_be_members(teacher):
    klass = create_class(teacher).json()
    me = teacher.get("/api/auth/me").json()

    assert add(teacher, klass["id"], me["id"]).status_code == 404
    assert add(teacher, klass["id"], 999).status_code == 404
    assert remove(teacher, klass["id"], 999).status_code == 404


def test_unknown_classes_are_not_found(teacher):
    student = create_student(teacher).json()

    assert teacher.get("/api/classes/999").status_code == 404
    assert teacher.patch("/api/classes/999", json={"name": "x"}).status_code == 404
    assert add(teacher, 999, student["id"]).status_code == 404
    assert remove(teacher, 999, student["id"]).status_code == 404


def test_students_cannot_see_or_maintain_classes(teacher, sender):
    klass = create_class(teacher).json()
    student = as_student(teacher, sender)

    assert teacher.get("/api/classes").status_code == 403
    assert teacher.get(f"/api/classes/{klass['id']}").status_code == 403
    assert create_class(teacher, "x").status_code == 403
    assert teacher.patch(f"/api/classes/{klass['id']}", json={"name": "x"}).status_code == 403
    assert add(teacher, klass["id"], student["id"]).status_code == 403
    assert remove(teacher, klass["id"], student["id"]).status_code == 403


def test_a_rename_needs_a_name(teacher):
    klass = create_class(teacher).json()

    assert teacher.patch(f"/api/classes/{klass['id']}", json={}).status_code == 422
    assert teacher.patch(f"/api/classes/{klass['id']}", json={"name": ""}).status_code == 422


def test_a_name_taken_by_a_concurrent_request_is_still_refused(teacher, monkeypatch):
    from myteacher.classes import service

    create_class(teacher)
    other = create_class(teacher, "2.A").json()
    # Another request created the name after this one checked it.
    monkeypatch.setattr(service, "_ensure_name_free", lambda *args, **kwargs: None)

    assert create_class(teacher).json() == {"detail": "name_taken"}
    renamed = teacher.patch(f"/api/classes/{other['id']}", json={"name": "2.B 2026/27"})
    assert renamed.json() == {"detail": "name_taken"}
    assert teacher.get(f"/api/classes/{other['id']}").json()["name"] == "2.A"


def test_a_member_added_by_a_concurrent_request_is_not_an_error(teacher, monkeypatch):
    from myteacher.classes import service

    klass = create_class(teacher).json()
    student = create_student(teacher).json()
    add(teacher, klass["id"], student["id"])
    # Another request added the student after this one looked.
    monkeypatch.setattr(service, "_is_member", lambda *args: False)

    again = add(teacher, klass["id"], student["id"])

    assert again.status_code == 200
    assert member_names(again) == ["Jana Veselá"]
