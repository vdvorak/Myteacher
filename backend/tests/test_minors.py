from datetime import timedelta

from tests.helpers import (
    STUDENT,
    STUDENT_PASSWORD,
    accept,
    as_student,
    back_to_teacher,
    create_student,
    link_token,
    sign_in,
    students,
)


def create_minor(client):
    return create_student(client, minor=True)


def record_consent(client, student_id, **body):
    return client.post(f"/api/students/{student_id}/consent", json=body)


def activate(client, student_id):
    return client.patch(f"/api/students/{student_id}", json={"active": True})


# A minor created without consent


def test_a_minor_is_created_awaiting_consent_and_is_not_invited(teacher, sender):
    sent = len(sender.sent)

    response = create_minor(teacher)

    assert response.status_code == 201
    body = response.json()
    assert body["minor"] is True
    assert body["consent"] is None
    assert body["state"] == "awaiting_consent"
    assert body["invitation_sent"] is False
    assert body["error"] is None
    assert len(sender.sent) == sent
    assert students(teacher)[STUDENT]["state"] == "awaiting_consent"


def test_a_student_who_is_not_a_minor_is_created_as_before(teacher):
    body = create_student(teacher).json()

    assert body["minor"] is False
    assert body["state"] == "invited"
    assert body["invitation_sent"] is True


def test_activating_a_minor_is_refused_until_consent_is_recorded(teacher):
    minor = create_minor(teacher).json()

    refused = activate(teacher, minor["id"])

    assert refused.status_code == 409
    assert refused.json() == {"detail": "consent_missing"}
    assert teacher.get(f"/api/students/{minor['id']}").json()["state"] == "awaiting_consent"


def test_a_minor_awaiting_consent_cannot_be_invited(teacher, sender):
    minor = create_minor(teacher).json()
    sent = len(sender.sent)

    refused = teacher.post(f"/api/students/{minor['id']}/invitation")

    assert refused.status_code == 409
    assert refused.json() == {"detail": "consent_missing"}
    assert len(sender.sent) == sent


def test_after_consent_the_minor_is_activated_invited_and_signs_in(teacher, sender):
    minor = create_minor(teacher).json()

    consent = record_consent(teacher, minor["id"], note="Signed form from the mother, 2026-09-20.")
    activated = activate(teacher, minor["id"])
    teacher.post(f"/api/students/{minor['id']}/invitation")

    assert consent.status_code == 200
    assert consent.json()["state"] == "inactive"  # recording consent does not activate
    assert activated.status_code == 200
    assert activated.json()["state"] == "invited"
    token = link_token(sender.sent[-1].message.text)
    teacher.cookies.clear()
    assert accept(teacher, token, STUDENT_PASSWORD).status_code == 200
    teacher.cookies.clear()
    assert sign_in(teacher, STUDENT, STUDENT_PASSWORD).status_code == 200


def test_consent_stores_the_attesting_teacher_the_time_and_the_note(teacher, clock):
    teacher_id = teacher.get("/api/auth/me").json()["id"]
    minor = create_minor(teacher).json()
    clock.now += timedelta(hours=2)

    record_consent(teacher, minor["id"], note="  Paper form in the class folder.  ")

    assert teacher.get(f"/api/students/{minor['id']}").json()["consent"] == {
        "attested_by_id": teacher_id,
        "attested_by_email": "novak@skola.example",
        "recorded_at": "2026-09-24T10:00:00Z",
        "note": "Paper form in the class folder.",
    }


def test_the_consent_note_is_optional(teacher):
    minor = create_minor(teacher).json()

    for body in ({}, {"note": None}, {"note": "   "}):
        assert record_consent(teacher, minor["id"], **body).json()["consent"]["note"] is None


def test_the_consent_note_has_a_limit(teacher):
    minor = create_minor(teacher).json()

    assert record_consent(teacher, minor["id"], note="x" * 1001).status_code == 422
    assert record_consent(teacher, minor["id"], note="x" * 1000).status_code == 200


def test_consent_is_recorded_only_for_a_minor(teacher):
    student = create_student(teacher).json()

    refused = record_consent(teacher, student["id"])

    assert refused.status_code == 409
    assert refused.json() == {"detail": "not_a_minor"}


# Marking a student as a minor later


def test_marking_an_active_student_as_a_minor_deactivates_them_until_consent(teacher, sender):
    student = as_student(teacher, sender)
    student_cookie = teacher.cookies["myteacher_session"]
    back_to_teacher(teacher)

    marked = teacher.patch(f"/api/students/{student['id']}", json={"minor": True})

    assert marked.status_code == 200
    assert marked.json()["minor"] is True
    assert marked.json()["state"] == "awaiting_consent"
    teacher.cookies.set("myteacher_session", student_cookie)
    assert teacher.get("/api/auth/me").status_code == 401
    teacher.cookies.clear()
    refused = sign_in(teacher, STUDENT, STUDENT_PASSWORD)
    assert refused.status_code == 403
    assert refused.json() == {"detail": "account_inactive"}

    back_to_teacher(teacher)
    record_consent(teacher, student["id"])
    assert activate(teacher, student["id"]).json()["state"] == "active"
    teacher.cookies.clear()
    assert sign_in(teacher, STUDENT, STUDENT_PASSWORD).status_code == 200


def test_an_invited_student_marked_as_a_minor_cannot_accept_until_consent(teacher, sender):
    student = create_student(teacher).json()
    token = link_token(sender.sent[-1].message.text)

    teacher.patch(f"/api/students/{student['id']}", json={"minor": True})

    teacher.cookies.clear()
    assert accept(teacher, token, STUDENT_PASSWORD).json() == {"detail": "account_inactive"}


def test_marking_a_minor_with_consent_keeps_them_active(teacher, sender):
    student = as_student(teacher, sender)
    back_to_teacher(teacher)
    url = f"/api/students/{student['id']}"
    teacher.patch(url, json={"minor": True})
    record_consent(teacher, student["id"])
    activate(teacher, student["id"])

    teacher.patch(url, json={"minor": False})
    again = teacher.patch(url, json={"minor": True})

    assert again.json()["state"] == "active"


def test_marking_and_activating_in_one_request_without_consent_changes_nothing(teacher, sender):
    student = as_student(teacher, sender)
    back_to_teacher(teacher)

    refused = teacher.patch(f"/api/students/{student['id']}", json={"minor": True, "active": True})

    assert refused.status_code == 409
    assert refused.json() == {"detail": "consent_missing"}
    after = teacher.get(f"/api/students/{student['id']}").json()
    assert after["minor"] is False
    assert after["state"] == "active"


def test_unmarking_a_minor_lets_them_be_activated(teacher):
    minor = create_minor(teacher).json()
    url = f"/api/students/{minor['id']}"

    teacher.patch(url, json={"minor": False})

    assert activate(teacher, minor["id"]).json()["state"] == "invited"


def test_an_inactive_minor_without_consent_shows_as_awaiting_consent_not_inactive(teacher, sender):
    student = as_student(teacher, sender)
    back_to_teacher(teacher)
    url = f"/api/students/{student['id']}"
    teacher.patch(url, json={"active": False})

    assert teacher.patch(url, json={"minor": True}).json()["state"] == "awaiting_consent"


# Access and audit


def test_only_teachers_record_consent(teacher, sender):
    minor = create_minor(teacher).json()
    as_student(teacher, sender, "petr@skola.example")

    assert record_consent(teacher, minor["id"]).status_code == 403


def test_consent_for_an_unknown_student_is_not_found(teacher):
    assert record_consent(teacher, 999).status_code == 404


def test_minor_flag_changes_and_consent_are_in_the_audit_log(teacher, sender):
    teacher_id = teacher.get("/api/auth/me").json()["id"]
    student = as_student(teacher, sender)
    sid = student["id"]
    back_to_teacher(teacher)
    teacher.patch(f"/api/students/{sid}", json={"minor": True})
    record_consent(teacher, sid)
    activate(teacher, sid)
    teacher.patch(f"/api/students/{sid}", json={"minor": False})
    teacher.cookies.clear()
    sign_in(teacher)

    kinds = [
        (e["kind"], e["actor_id"])
        for e in teacher.get("/api/admin/audit-events").json()
        if e["subject_id"] == sid
    ][::-1]

    assert kinds[-5:] == [
        ("minor_marked", teacher_id),
        ("account_deactivated", teacher_id),
        ("consent_recorded", teacher_id),
        ("account_activated", teacher_id),
        ("minor_unmarked", teacher_id),
    ]


def test_marking_a_minor_at_creation_is_in_the_audit_log(teacher):
    minor = create_minor(teacher).json()
    teacher.cookies.clear()
    sign_in(teacher)

    kinds = [
        e["kind"]
        for e in teacher.get("/api/admin/audit-events").json()
        if e["subject_id"] == minor["id"]
    ][::-1]

    assert kinds == ["account_created", "minor_marked"]
