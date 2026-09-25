import pytest
import sqlalchemy as sa

from myteacher import erasure
from myteacher.persistence import open_session
from tests.helpers import (
    ADMIN_EMAIL,
    STUDENT,
    STUDENT_PASSWORD,
    accept,
    as_student,
    create_engine_for,
    create_student,
    invited_student,
    link_token,
    sign_in,
)

NAME = "Jana Veselá"


def erase(client, student_id, confirmation=NAME):
    return client.post(
        f"/api/admin/students/{student_id}/erasure", json={"confirmation": confirmation}
    )


def as_admin(client) -> dict:
    client.cookies.clear()
    return sign_in(client).json()


@pytest.fixture
def full_student(teacher, sender):
    """An active minor with consent, in a class, with a session and an open reset link."""
    student = as_student(teacher, sender)
    admin = as_admin(teacher)
    sid = student["id"]
    teacher.patch(f"/api/students/{sid}", json={"minor": True})
    teacher.post(f"/api/students/{sid}/consent", json={"note": "Signed by the father."})
    teacher.patch(f"/api/students/{sid}", json={"active": True})
    klass = teacher.post("/api/classes", json={"name": "2.B"}).json()
    teacher.put(f"/api/classes/{klass['id']}/members/{sid}")
    teacher.post("/api/auth/password-reset/request", json={"email": STUDENT})
    reset_token = link_token(sender.sent[-1].message.text)
    # Marking the minor ended their sessions; open a fresh one.
    teacher.cookies.clear()
    sign_in(teacher, STUDENT, STUDENT_PASSWORD)
    student_cookie = teacher.cookies["myteacher_session"]
    as_admin(teacher)
    return {
        "id": sid,
        "admin_id": admin["id"],
        "class_id": klass["id"],
        "cookie": student_cookie,
        "reset_token": reset_token,
    }


# A full erasure


def test_erasure_leaves_placeholders_and_the_student_cannot_sign_in(teacher, full_student):
    response = erase(teacher, full_student["id"])

    assert response.status_code == 204
    page = teacher.get(f"/api/students/{full_student['id']}").json()
    assert page["state"] == "erased"
    assert page["name"] != NAME and "Jana" not in page["name"]
    assert page["email"] != STUDENT and "jana" not in page["email"]
    assert page["consent"] is None
    assert page["classes"] == []
    assert page["language"] is None
    teacher.cookies.clear()
    assert sign_in(teacher, STUDENT, STUDENT_PASSWORD).status_code == 401
    assert sign_in(teacher, page["email"], STUDENT_PASSWORD).status_code == 401


def test_erasure_ends_sessions_and_voids_open_links(teacher, full_student):
    erase(teacher, full_student["id"])

    teacher.cookies.clear()
    teacher.cookies.set("myteacher_session", full_student["cookie"])
    assert teacher.get("/api/auth/me").status_code == 401
    teacher.cookies.clear()
    check = teacher.post(
        "/api/auth/password-reset/check", json={"token": full_student["reset_token"]}
    )
    assert check.json()["state"] == "unknown"


def test_erasure_removes_the_student_from_classes_and_lists(teacher, full_student):
    erase(teacher, full_student["id"])

    klass = teacher.get(f"/api/classes/{full_student['class_id']}").json()
    assert klass["members"] == []
    assert full_student["id"] not in [s["id"] for s in teacher.get("/api/students").json()]


def test_every_registered_row_of_the_student_is_removed_or_anonymised(
    teacher, full_student, admin_settings
):
    erase(teacher, full_student["id"])

    with open_session(create_engine_for(admin_settings)) as db:
        for rule in erasure.rules():
            table = sa.table(rule.table, sa.column(rule.student_column))
            rows = db.execute(
                sa.select(sa.func.count())
                .select_from(table)
                .where(table.c[rule.student_column] == full_student["id"])
            ).scalar_one()
            if rule.anonymise is None:
                assert rows == 0, rule.table
            else:
                assert rows == 1, rule.table


def test_an_invited_students_invitation_stops_working(teacher, sender):
    student, token = invited_student(teacher, sender)
    as_admin(teacher)

    erase(teacher, student["id"])

    teacher.cookies.clear()
    assert accept(teacher, token, STUDENT_PASSWORD).json() == {"detail": "invitation_unknown"}


def test_the_email_is_free_again_after_erasure(teacher):
    student = create_student(teacher).json()
    as_admin(teacher)
    erase(teacher, student["id"])

    assert create_student(teacher).status_code == 201


def test_an_erased_student_can_no_longer_be_changed(teacher):
    student = create_student(teacher).json()
    as_admin(teacher)
    erase(teacher, student["id"])
    sid = student["id"]

    for response in (
        teacher.patch(f"/api/students/{sid}", json={"active": True}),
        teacher.post(f"/api/students/{sid}/invitation"),
        teacher.delete(f"/api/students/{sid}/invitation"),
        teacher.post(f"/api/students/{sid}/consent", json={}),
        erase(teacher, sid, confirmation="anything"),
    ):
        assert response.status_code == 410
        assert response.json() == {"detail": "student_erased"}


# Audit


def test_the_audit_log_keeps_who_erased_whom_and_when_without_personal_data(
    teacher, full_student, clock
):
    erase(teacher, full_student["id"])

    events = teacher.get("/api/admin/audit-events").json()
    erased = [e for e in events if e["kind"] == "student_erased"]
    assert erased == [
        {
            "kind": "student_erased",
            "actor_id": full_student["admin_id"],
            "subject_id": full_student["id"],
            "course_id": None,
            "detail": None,
            "at": "2026-09-24T08:00:00Z",
        }
    ]
    body = teacher.get("/api/admin/audit-events").text
    assert NAME not in body and STUDENT not in body


# Confirmation and access


def test_the_students_name_must_be_typed_as_confirmation(teacher, full_student):
    for wrong in ("", "Jana", "jana veselá", "Petr Malý"):
        refused = erase(teacher, full_student["id"], confirmation=wrong)
        assert refused.status_code == 409
        assert refused.json() == {"detail": "confirmation_mismatch"}
    assert teacher.get(f"/api/students/{full_student['id']}").json()["name"] == NAME

    assert erase(teacher, full_student["id"], confirmation=f"  {NAME} ").status_code == 204


def test_only_admins_erase(teacher):
    student = create_student(teacher).json()

    assert erase(teacher, student["id"]).status_code == 403
    assert teacher.get(f"/api/students/{student['id']}").json()["name"] == NAME


def test_only_students_are_erased(teacher):
    admin = as_admin(teacher)

    assert erase(teacher, admin["id"], confirmation=ADMIN_EMAIL).status_code == 404
    assert erase(teacher, 999).status_code == 404


# Registration


def test_a_registered_table_that_is_missing_fails_loudly_and_erases_nothing(
    teacher, full_student, monkeypatch
):
    missing = erasure.Rule(table="concept_state", student_column="student_id")
    monkeypatch.setattr(erasure, "_rules", [*erasure.rules(), missing])

    with pytest.raises(erasure.ErasureMisconfigured, match="concept_state"):
        erase(teacher, full_student["id"])

    page = teacher.get(f"/api/students/{full_student['id']}").json()
    assert page["name"] == NAME
    assert page["classes"] != []


def test_a_registered_column_that_is_missing_fails_loudly(teacher, full_student, monkeypatch):
    wrong = erasure.Rule(table="invitation", student_column="student_id")
    monkeypatch.setattr(erasure, "_rules", [*erasure.rules(), wrong])

    with pytest.raises(erasure.ErasureMisconfigured, match="invitation.student_id"):
        erase(teacher, full_student["id"])


def test_this_slice_registers_its_student_data():
    tables = {rule.table for rule in erasure.rules()}

    assert {
        "account",
        "auth_session",
        "invitation",
        "password_reset",
        "guardian_consent",
        "class_membership",
        "run_student",
    } <= tables


def test_an_erased_student_cannot_be_put_back_into_a_class(teacher):
    student = create_student(teacher).json()
    klass = teacher.post("/api/classes", json={"name": "2.B"}).json()
    as_admin(teacher)
    erase(teacher, student["id"])

    for response in (
        teacher.put(f"/api/classes/{klass['id']}/members/{student['id']}"),
        teacher.delete(f"/api/classes/{klass['id']}/members/{student['id']}"),
    ):
        assert response.status_code == 410
        assert response.json() == {"detail": "student_erased"}
    assert teacher.get(f"/api/classes/{klass['id']}").json()["members"] == []
