from datetime import timedelta

import pytest

from tests.helpers import ADMIN_EMAIL, configure_smtp, link_token, sign_in

TEACHER = "novak@skola.example"
TEACHER_PASSWORD = "the teacher's password"
STUDENT = "jana@skola.example"
STUDENT_PASSWORD = "the student's password"
OTHER_STUDENT = "petr@skola.example"


def accept(client, token, password):
    return client.post("/api/auth/invitations/accept", json={"token": token, "password": password})


def create_student(client, email=STUDENT, name="Jana Veselá", language="cs"):
    return client.post("/api/students", json={"name": name, "email": email, "language": language})


def students(client) -> dict[str, dict]:
    return {s["email"]: s for s in client.get("/api/students").json()}


@pytest.fixture
def teacher(app_client, sender):
    """A client signed in as a teacher who is not an admin."""
    sign_in(app_client)
    configure_smtp(app_client)
    app_client.post("/api/admin/teachers", json={"email": TEACHER, "language": "cs"})
    token = link_token(sender.sent[-1].message.text)
    app_client.cookies.clear()
    assert accept(app_client, token, TEACHER_PASSWORD).status_code == 200
    return app_client


def invited_student(teacher, sender, email=STUDENT, **fields) -> tuple[dict, str]:
    student = create_student(teacher, email, **fields).json()
    return student, link_token(sender.sent[-1].message.text)


def as_student(teacher, sender, email=STUDENT) -> dict:
    """Create a student, accept their invitation and leave the client signed in as them."""
    student, token = invited_student(teacher, sender, email)
    teacher.cookies.clear()
    assert accept(teacher, token, STUDENT_PASSWORD).status_code == 200
    return student


def back_to_teacher(client) -> None:
    client.cookies.clear()
    sign_in(client, TEACHER, TEACHER_PASSWORD)


# Round trip


def test_creating_a_student_sends_an_invitation_in_the_students_language(teacher, sender):
    response = create_student(teacher, language="cs")

    assert response.status_code == 201
    body = response.json()
    assert body | {"name": "Jana Veselá", "email": STUDENT, "state": "invited"} == body
    assert body["invitation_sent"] is True
    mail = sender.sent[-1].message
    assert mail.to == STUDENT
    assert "student" in mail.subject.lower()
    assert "pozvánka" in mail.subject.lower()
    assert "http://testserver/invitation#" in mail.text
    create_student(teacher, OTHER_STUDENT, language="en")
    assert "invitation" in sender.sent[-1].message.subject.lower()


def test_a_student_accepts_signs_in_and_sees_only_their_own_account(teacher, sender):
    student, token = invited_student(teacher, sender)
    teacher.cookies.clear()

    check = teacher.post("/api/auth/invitations/check", json={"token": token}).json()
    accepted = accept(teacher, token, STUDENT_PASSWORD)

    assert check == {"state": "valid", "email": STUDENT}
    assert accepted.status_code == 200
    me = teacher.get("/api/auth/me").json()
    assert me | {"id": student["id"], "kind": "student", "roles": ["student"]} == me
    assert me["name"] == "Jana Veselá"
    assert me["language"] == "cs"
    teacher.cookies.clear()
    assert sign_in(teacher, STUDENT, STUDENT_PASSWORD).status_code == 200


def test_the_student_list_and_page_show_state_and_basics(teacher, sender):
    as_student(teacher, sender)
    back_to_teacher(teacher)
    create_student(teacher, OTHER_STUDENT, name="Petr Malý", language="en")

    listed = students(teacher)
    page = teacher.get(f"/api/students/{listed[OTHER_STUDENT]['id']}").json()

    assert listed[STUDENT]["state"] == "active"
    assert listed[OTHER_STUDENT]["state"] == "invited"
    assert page == {
        "id": listed[OTHER_STUDENT]["id"],
        "name": "Petr Malý",
        "email": OTHER_STUDENT,
        "language": "en",
        "state": "invited",
    }
    assert ADMIN_EMAIL not in listed and TEACHER not in listed


def test_the_student_list_is_sorted_by_name(teacher):
    create_student(teacher, OTHER_STUDENT, name="Petr Malý")
    create_student(teacher, STUDENT, name="Jana Veselá")

    assert [s["name"] for s in teacher.get("/api/students").json()] == ["Jana Veselá", "Petr Malý"]


def test_any_teacher_sees_and_edits_every_student(teacher, sender):
    student = create_student(teacher).json()
    teacher.cookies.clear()
    sign_in(teacher)  # the admin, a different teacher from the one who created the student

    changed = teacher.patch(
        f"/api/students/{student['id']}",
        json={"name": "Jana Nová", "email": "jana.nova@skola.example", "language": "en"},
    )

    assert changed.status_code == 200
    assert changed.json() | {"name": "Jana Nová", "email": "jana.nova@skola.example"} == (
        changed.json()
    )
    assert changed.json()["language"] == "en"
    assert "jana.nova@skola.example" in students(teacher)


def test_basics_are_validated(teacher):
    student = create_student(teacher).json()
    url = f"/api/students/{student['id']}"

    assert create_student(teacher, OTHER_STUDENT, name="   ").status_code == 422
    assert create_student(teacher, "petr").status_code == 422
    assert create_student(teacher, OTHER_STUDENT, language="de").status_code == 422
    assert teacher.patch(url, json={"name": ""}).status_code == 422
    assert teacher.patch(url, json={"email": "jana"}).status_code == 422
    assert teacher.patch(url, json={"name": None}).status_code == 422
    assert teacher.patch(url, json={"is_admin": True}).status_code == 422


def test_an_email_belongs_to_one_account_only(teacher):
    create_student(teacher)
    other = create_student(teacher, OTHER_STUDENT).json()

    assert create_student(teacher, " Jana@Skola.Example").status_code == 409
    assert create_student(teacher, TEACHER).json() == {"detail": "email_taken"}
    renamed = teacher.patch(f"/api/students/{other['id']}", json={"email": STUDENT})
    assert renamed.status_code == 409
    assert renamed.json() == {"detail": "email_taken"}
    # Keeping one's own email is not a clash.
    same = teacher.patch(f"/api/students/{other['id']}", json={"email": OTHER_STUDENT.upper()})
    assert same.status_code == 200


def test_a_student_whose_email_failed_is_still_created(teacher, sender):
    sender.fail_with = "Could not connect to smtp.skola.example:587."

    response = create_student(teacher)

    assert response.status_code == 201
    assert response.json()["invitation_sent"] is False
    assert response.json()["error"] == "Could not connect to smtp.skola.example:587."
    assert students(teacher)[STUDENT]["state"] == "invited"


# Invitations


def test_resending_issues_a_new_link_and_voids_the_old_one(teacher, sender):
    student, first = invited_student(teacher, sender)

    resent = teacher.post(f"/api/students/{student['id']}/invitation")

    assert resent.json() == {"invitation_sent": True, "error": None}
    second = link_token(sender.sent[-1].message.text)
    teacher.cookies.clear()
    assert accept(teacher, first, STUDENT_PASSWORD).json() == {"detail": "invitation_revoked"}
    assert accept(teacher, second, STUDENT_PASSWORD).status_code == 200


def test_revoking_voids_the_link(teacher, sender):
    student, token = invited_student(teacher, sender)

    revoked = teacher.delete(f"/api/students/{student['id']}/invitation")

    assert revoked.status_code == 204
    teacher.cookies.clear()
    assert teacher.post("/api/auth/invitations/check", json={"token": token}).json() == {
        "state": "revoked",
        "email": None,
    }
    assert accept(teacher, token, STUDENT_PASSWORD).status_code == 410


def test_a_revoked_invitation_can_be_resent(teacher, sender):
    student, _ = invited_student(teacher, sender)
    teacher.delete(f"/api/students/{student['id']}/invitation")

    teacher.post(f"/api/students/{student['id']}/invitation")

    token = link_token(sender.sent[-1].message.text)
    teacher.cookies.clear()
    assert accept(teacher, token, STUDENT_PASSWORD).status_code == 200


def test_the_invitation_of_a_student_who_accepted_is_neither_resent_nor_revoked(teacher, sender):
    student = as_student(teacher, sender)
    back_to_teacher(teacher)

    for response in (
        teacher.post(f"/api/students/{student['id']}/invitation"),
        teacher.delete(f"/api/students/{student['id']}/invitation"),
    ):
        assert response.status_code == 409
        assert response.json() == {"detail": "already_accepted"}


def test_an_expired_student_invitation_is_refused(teacher, sender, clock):
    _, token = invited_student(teacher, sender)
    teacher.cookies.clear()
    clock.now += timedelta(days=7, minutes=1)

    assert accept(teacher, token, STUDENT_PASSWORD).json() == {"detail": "invitation_expired"}


# Deactivation


def test_a_deactivated_student_cannot_sign_in_and_is_told_so(teacher, sender):
    student = as_student(teacher, sender)
    student_cookie = teacher.cookies["myteacher_session"]
    back_to_teacher(teacher)

    response = teacher.patch(f"/api/students/{student['id']}", json={"active": False})

    assert response.status_code == 200
    assert response.json()["state"] == "inactive"
    teacher.cookies.clear()
    refused = sign_in(teacher, STUDENT, STUDENT_PASSWORD)
    assert refused.status_code == 403
    assert refused.json() == {"detail": "account_inactive"}
    teacher.cookies.set("myteacher_session", student_cookie)
    assert teacher.get("/api/auth/me").status_code == 401


def test_a_reactivated_student_keeps_their_account(teacher, sender):
    student = as_student(teacher, sender)
    back_to_teacher(teacher)
    url = f"/api/students/{student['id']}"
    teacher.patch(url, json={"active": False})

    assert teacher.patch(url, json={"active": True}).json()["state"] == "active"
    teacher.cookies.clear()
    assert sign_in(teacher, STUDENT, STUDENT_PASSWORD).status_code == 200


def test_a_deactivated_invited_student_cannot_accept(teacher, sender):
    student, token = invited_student(teacher, sender)
    teacher.patch(f"/api/students/{student['id']}", json={"active": False})
    teacher.cookies.clear()

    assert accept(teacher, token, STUDENT_PASSWORD).json() == {"detail": "account_inactive"}


# Access boundaries


def test_students_are_managed_by_teachers_only(teacher, sender):
    other = create_student(teacher, OTHER_STUDENT).json()
    as_student(teacher, sender)

    assert teacher.get("/api/students").status_code == 403
    assert teacher.get(f"/api/students/{other['id']}").status_code == 403
    assert create_student(teacher, "x@skola.example").status_code == 403
    assert teacher.patch(f"/api/students/{other['id']}", json={"name": "X"}).status_code == 403
    assert teacher.post(f"/api/students/{other['id']}/invitation").status_code == 403
    assert teacher.delete(f"/api/students/{other['id']}/invitation").status_code == 403


def test_a_student_cannot_read_or_change_another_students_account(teacher, sender):
    other = create_student(teacher, OTHER_STUDENT).json()
    as_student(teacher, sender)
    url = f"/api/accounts/{other['id']}/settings"

    assert teacher.get(url).status_code == 403
    assert teacher.patch(url, json={"language": "en"}).status_code == 403


def test_a_student_cannot_reach_teacher_pages(teacher, sender):
    student = as_student(teacher, sender)

    assert teacher.get("/api/admin/teachers").status_code == 403
    assert teacher.get("/api/admin/audit-events").status_code == 403
    assert teacher.get(f"/api/accounts/{student['id']}/provider-credentials").status_code == 403


def test_teacher_endpoints_do_not_treat_a_student_as_a_teacher(teacher, sender):
    student = create_student(teacher).json()
    teacher.cookies.clear()
    sign_in(teacher)

    assert teacher.patch(
        f"/api/admin/teachers/{student['id']}", json={"active": False}
    ).status_code == (404)
    assert teacher.get(f"/api/students/{teacher.get('/api/auth/me').json()['id']}").status_code == (
        404
    )


def test_unknown_students_are_not_found(teacher):
    assert teacher.get("/api/students/999").status_code == 404
    assert teacher.patch("/api/students/999", json={"active": False}).status_code == 404
    assert teacher.post("/api/students/999/invitation").status_code == 404
    assert teacher.delete("/api/students/999/invitation").status_code == 404


# The student's own account


def test_a_student_changes_their_interface_language(teacher, sender):
    student = as_student(teacher, sender)
    url = f"/api/accounts/{student['id']}/settings"

    changed = teacher.patch(url, json={"language": "en"})

    assert changed.status_code == 200
    assert changed.json()["language"] == "en"
    assert teacher.get("/api/auth/me").json()["language"] == "en"


def test_a_student_has_no_digest_time(teacher, sender):
    student = as_student(teacher, sender)
    url = f"/api/accounts/{student['id']}/settings"

    assert teacher.get(url).json() == {
        "language": "cs",
        "digest_time": None,
        "digest_time_is_default": False,
    }
    refused = teacher.patch(url, json={"digest_time": "18:30"})
    assert refused.status_code == 403
    assert teacher.patch(url, json={"digest_time": None}).status_code == 403


def test_a_student_resets_their_password(teacher, sender):
    as_student(teacher, sender)
    teacher.cookies.clear()

    teacher.post("/api/auth/password-reset/request", json={"email": STUDENT})
    mail = sender.sent[-1].message
    completed = teacher.post(
        "/api/auth/password-reset/complete",
        json={"token": link_token(mail.text), "password": "a brand new password"},
    )

    assert mail.to == STUDENT
    assert "obnova hesla" in mail.subject.lower()
    assert completed.status_code == 200
    teacher.cookies.clear()
    assert sign_in(teacher, STUDENT, "a brand new password").status_code == 200


# Audit log


def test_student_events_are_in_the_audit_log(teacher, sender):
    teacher_id = teacher.get("/api/auth/me").json()["id"]
    student, _ = invited_student(teacher, sender)
    sid = student["id"]
    teacher.delete(f"/api/students/{sid}/invitation")
    teacher.post(f"/api/students/{sid}/invitation")
    token = link_token(sender.sent[-1].message.text)
    teacher.cookies.clear()
    accept(teacher, token, STUDENT_PASSWORD)
    back_to_teacher(teacher)
    teacher.patch(f"/api/students/{sid}", json={"name": "Jana Nová"})
    teacher.patch(f"/api/students/{sid}", json={"active": False})
    teacher.patch(f"/api/students/{sid}", json={"active": True})
    teacher.cookies.clear()
    sign_in(teacher)

    events = [
        (e["kind"], e["actor_id"], e["subject_id"])
        for e in teacher.get("/api/admin/audit-events").json()
        if e["subject_id"] == sid
    ]

    assert events[::-1] == [
        ("account_created", teacher_id, sid),
        ("invitation_sent", teacher_id, sid),
        ("invitation_revoked", teacher_id, sid),
        ("invitation_sent", teacher_id, sid),
        ("invitation_accepted", sid, sid),
        ("signed_in", sid, sid),
        ("account_changed", teacher_id, sid),
        ("account_deactivated", teacher_id, sid),
        ("account_activated", teacher_id, sid),
    ]


def test_correcting_an_invited_students_email_voids_the_link_sent_to_the_old_one(teacher, sender):
    student, token = invited_student(teacher, sender)

    teacher.patch(f"/api/students/{student['id']}", json={"email": OTHER_STUDENT})

    teacher.cookies.clear()
    assert accept(teacher, token, STUDENT_PASSWORD).json() == {"detail": "invitation_revoked"}


def test_renaming_an_invited_student_keeps_their_link(teacher, sender):
    student, token = invited_student(teacher, sender)

    teacher.patch(f"/api/students/{student['id']}", json={"name": "Jana Nová"})

    teacher.cookies.clear()
    assert accept(teacher, token, STUDENT_PASSWORD).status_code == 200


def test_no_invitation_is_sent_to_a_deactivated_student(teacher, sender):
    student, _ = invited_student(teacher, sender)
    teacher.patch(f"/api/students/{student['id']}", json={"active": False})
    sent = len(sender.sent)

    response = teacher.post(f"/api/students/{student['id']}/invitation")

    assert response.status_code == 409
    assert response.json() == {"detail": "account_inactive"}
    assert len(sender.sent) == sent
