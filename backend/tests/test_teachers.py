from datetime import timedelta

import pytest

from tests.helpers import ADMIN_EMAIL, configure_smtp, link_token, sign_in

TEACHER = "novak@skola.example"
PASSWORD = "the teacher's password"


@pytest.fixture
def admin(app_client):
    sign_in(app_client)
    configure_smtp(app_client)
    return app_client


def create_teacher(client, email=TEACHER, language="cs"):
    return client.post("/api/admin/teachers", json={"email": email, "language": language})


def accept(client, token, password=PASSWORD):
    return client.post("/api/auth/invitations/accept", json={"token": token, "password": password})


def invite_and_accept(admin, sender, email=TEACHER) -> dict:
    teacher = create_teacher(admin, email).json()
    token = link_token(sender.sent[-1].message.text)
    admin.cookies.clear()
    assert accept(admin, token).status_code == 200
    admin.cookies.clear()
    sign_in(admin)
    return teacher


def teachers(client) -> dict[str, dict]:
    return {t["email"]: t for t in client.get("/api/admin/teachers").json()}


# Invitation round trip


def test_creating_a_teacher_sends_an_invitation_in_the_teachers_language(admin, sender):
    response = create_teacher(admin, language="cs")

    assert response.status_code == 201
    assert response.json()["invitation_sent"] is True
    mail = sender.sent[-1].message
    assert mail.to == TEACHER
    assert "pozvánka" in mail.subject.lower()
    assert "http://testserver/invitation#" in mail.text
    create_teacher(admin, "smith@skola.example", language="en")
    assert "invitation" in sender.sent[-1].message.subject.lower()


def test_accepting_the_invitation_sets_the_password_and_signs_the_teacher_in(admin, sender):
    create_teacher(admin)
    token = link_token(sender.sent[-1].message.text)
    admin.cookies.clear()

    check = admin.post("/api/auth/invitations/check", json={"token": token})
    response = accept(admin, token)

    assert check.json() == {"state": "valid", "email": TEACHER}
    assert response.status_code == 200
    me = admin.get("/api/auth/me").json()
    assert me["email"] == TEACHER
    assert me["roles"] == ["teacher"]
    assert me["language"] == "cs"
    admin.cookies.clear()
    assert sign_in(admin, TEACHER, PASSWORD).status_code == 200


def test_an_invitation_link_works_only_once(admin, sender):
    create_teacher(admin)
    token = link_token(sender.sent[-1].message.text)
    admin.cookies.clear()
    accept(admin, token)
    admin.cookies.clear()

    again = accept(admin, token, password="a different password")

    assert again.status_code == 410
    assert again.json() == {"detail": "invitation_used"}
    assert admin.post("/api/auth/invitations/check", json={"token": token}).json() == {
        "state": "used",
        "email": None,
    }
    assert sign_in(admin, TEACHER, "a different password").status_code == 401


def test_an_invitation_link_expires(admin, sender, clock):
    create_teacher(admin)
    token = link_token(sender.sent[-1].message.text)
    admin.cookies.clear()

    clock.now += timedelta(days=7, minutes=1)

    response = accept(admin, token)
    assert response.status_code == 410
    assert response.json() == {"detail": "invitation_expired"}
    assert admin.post("/api/auth/invitations/check", json={"token": token}).json()["state"] == (
        "expired"
    )


def test_an_unknown_invitation_link_is_refused(app_client):
    response = accept(app_client, "made-up-token")

    assert response.status_code == 404
    assert response.json() == {"detail": "invitation_unknown"}
    assert app_client.post("/api/auth/invitations/check", json={"token": "x"}).json() == {
        "state": "unknown",
        "email": None,
    }


def test_the_new_password_must_be_long_enough(admin, sender):
    create_teacher(admin)
    token = link_token(sender.sent[-1].message.text)

    assert accept(admin, token, password="short").status_code == 422
    assert accept(admin, token).status_code == 200


def test_an_invited_teacher_cannot_sign_in_before_accepting(admin, sender):
    create_teacher(admin)
    admin.cookies.clear()

    assert sign_in(admin, TEACHER, "").status_code == 401


def test_resending_an_invitation_voids_the_previous_link(admin, sender):
    teacher = create_teacher(admin).json()
    first = link_token(sender.sent[-1].message.text)

    assert admin.post(f"/api/admin/teachers/{teacher['id']}/invitation").json() == {
        "invitation_sent": True,
        "error": None,
    }
    second = link_token(sender.sent[-1].message.text)
    admin.cookies.clear()

    assert accept(admin, first).status_code == 410
    assert accept(admin, second).status_code == 200


def test_a_failed_resend_leaves_the_previous_link_working(admin, sender):
    teacher = create_teacher(admin).json()
    first = link_token(sender.sent[-1].message.text)
    sender.fail_with = "Could not connect to smtp.skola.example:587."

    result = admin.post(f"/api/admin/teachers/{teacher['id']}/invitation").json()

    assert result["invitation_sent"] is False
    admin.cookies.clear()
    assert accept(admin, first).status_code == 200


def test_an_admin_who_has_not_accepted_does_not_count_as_another_admin(admin):
    invited = create_teacher(admin).json()
    admin.patch(f"/api/admin/teachers/{invited['id']}", json={"is_admin": True})
    admin_id = admin.get("/api/auth/me").json()["id"]

    response = admin.patch(f"/api/admin/teachers/{admin_id}", json={"is_admin": False})

    assert response.status_code == 409


def test_an_invitation_is_used_up_even_by_a_concurrent_acceptance(admin, sender, monkeypatch):
    from myteacher.accounts import invitations

    create_teacher(admin)
    token = link_token(sender.sent[-1].message.text)
    admin.cookies.clear()
    assert accept(admin, token).status_code == 200
    admin.cookies.clear()
    # A concurrent request that read the invitation as valid before the first one wrote.
    real_inspect = invitations.inspect
    monkeypatch.setattr(
        invitations, "inspect", lambda db, t, now: ("valid", real_inspect(db, t, now=now)[1])
    )

    assert accept(admin, token, password="the second password").status_code == 410
    assert sign_in(admin, TEACHER, PASSWORD).status_code == 200


def test_a_teacher_whose_email_failed_is_still_created_and_can_be_reinvited(admin, sender):
    sender.fail_with = "Could not connect to smtp.skola.example:587."

    response = create_teacher(admin)

    assert response.status_code == 201
    assert response.json()["invitation_sent"] is False
    assert response.json()["error"] == "Could not connect to smtp.skola.example:587."
    assert teachers(admin)[TEACHER]["state"] == "invited"


def test_an_email_can_belong_to_one_account_only(admin):
    create_teacher(admin)

    assert create_teacher(admin, email=" Novak@Skola.Example").status_code == 409
    assert create_teacher(admin, email=ADMIN_EMAIL).status_code == 409


def test_a_teacher_needs_a_valid_email_and_language(admin):
    assert create_teacher(admin, email="novak").status_code == 422
    assert create_teacher(admin, language="de").status_code == 422


# Managing teachers


def test_the_teachers_list_shows_each_teachers_state(admin, sender):
    invite_and_accept(admin, sender)
    create_teacher(admin, "smith@skola.example", language="en")

    listed = teachers(admin)

    assert listed[ADMIN_EMAIL]["state"] == "active"
    assert listed[ADMIN_EMAIL]["is_admin"] is True
    assert listed[TEACHER]["state"] == "active"
    assert listed["smith@skola.example"]["state"] == "invited"
    assert listed["smith@skola.example"]["language"] == "en"


def test_a_deactivated_teacher_cannot_sign_in_and_is_told_so(admin, sender):
    teacher = invite_and_accept(admin, sender)

    response = admin.patch(f"/api/admin/teachers/{teacher['id']}", json={"active": False})

    assert response.status_code == 200
    assert response.json()["state"] == "inactive"
    admin.cookies.clear()
    refused = sign_in(admin, TEACHER, PASSWORD)
    assert refused.status_code == 403
    assert refused.json() == {"detail": "account_inactive"}


def test_deactivation_ends_the_teachers_sessions(admin, sender, app_client):
    teacher = invite_and_accept(admin, sender)
    admin_cookie = admin.cookies["myteacher_session"]
    admin.cookies.clear()
    sign_in(admin, TEACHER, PASSWORD)
    teacher_cookie = admin.cookies["myteacher_session"]

    admin.cookies.set("myteacher_session", admin_cookie)
    admin.patch(f"/api/admin/teachers/{teacher['id']}", json={"active": False})
    admin.patch(f"/api/admin/teachers/{teacher['id']}", json={"active": True})

    admin.cookies.set("myteacher_session", teacher_cookie)
    assert admin.get("/api/auth/me").status_code == 401


def test_a_deactivated_teacher_cannot_accept_an_invitation(admin, sender):
    teacher = create_teacher(admin).json()
    token = link_token(sender.sent[-1].message.text)
    admin.patch(f"/api/admin/teachers/{teacher['id']}", json={"active": False})
    admin.cookies.clear()

    response = accept(admin, token)

    assert response.status_code == 403
    assert response.json() == {"detail": "account_inactive"}


def test_a_reactivated_teacher_can_sign_in_again(admin, sender):
    teacher = invite_and_accept(admin, sender)
    admin.patch(f"/api/admin/teachers/{teacher['id']}", json={"active": False})
    admin.patch(f"/api/admin/teachers/{teacher['id']}", json={"active": True})
    admin.cookies.clear()

    assert sign_in(admin, TEACHER, PASSWORD).status_code == 200


def test_the_admin_role_can_be_granted_and_revoked(admin, sender):
    teacher = invite_and_accept(admin, sender)
    url = f"/api/admin/teachers/{teacher['id']}"

    assert admin.patch(url, json={"is_admin": True}).json()["is_admin"] is True
    admin.cookies.clear()
    sign_in(admin, TEACHER, PASSWORD)
    assert admin.get("/api/admin/teachers").status_code == 200

    admin.cookies.clear()
    sign_in(admin)
    assert admin.patch(url, json={"is_admin": False}).json()["is_admin"] is False
    admin.cookies.clear()
    sign_in(admin, TEACHER, PASSWORD)
    assert admin.get("/api/admin/teachers").status_code == 403


def test_the_last_active_admin_cannot_be_removed_or_deactivated(admin):
    admin_id = admin.get("/api/auth/me").json()["id"]
    url = f"/api/admin/teachers/{admin_id}"

    for change in ({"is_admin": False}, {"active": False}):
        response = admin.patch(url, json=change)
        assert response.status_code == 409
        assert response.json() == {"detail": "last_active_admin"}
    assert (
        teachers(admin)[ADMIN_EMAIL] | {"state": "active", "is_admin": True}
        == teachers(admin)[ADMIN_EMAIL]
    )


def test_an_admin_can_step_down_once_another_active_admin_exists(admin, sender):
    teacher = invite_and_accept(admin, sender)
    admin.patch(f"/api/admin/teachers/{teacher['id']}", json={"is_admin": True})
    admin_id = admin.get("/api/auth/me").json()["id"]

    assert (
        admin.patch(f"/api/admin/teachers/{admin_id}", json={"is_admin": False}).status_code == 200
    )


def test_an_inactive_admin_does_not_count_as_another_admin(admin, sender):
    teacher = invite_and_accept(admin, sender)
    url = f"/api/admin/teachers/{teacher['id']}"
    admin.patch(url, json={"is_admin": True})
    admin.patch(url, json={"active": False})
    admin_id = admin.get("/api/auth/me").json()["id"]

    assert admin.patch(f"/api/admin/teachers/{admin_id}", json={"active": False}).status_code == 409


def test_unknown_teachers_are_not_found(admin):
    assert admin.patch("/api/admin/teachers/999", json={"active": False}).status_code == 404
    assert admin.post("/api/admin/teachers/999/invitation").status_code == 404


def test_resending_to_a_teacher_who_already_accepted_is_refused(admin, sender):
    teacher = invite_and_accept(admin, sender)

    response = admin.post(f"/api/admin/teachers/{teacher['id']}/invitation")

    assert response.status_code == 409
    assert response.json() == {"detail": "already_accepted"}


def test_only_admins_manage_teachers(admin, sender):
    teacher = invite_and_accept(admin, sender)
    admin.cookies.clear()
    sign_in(admin, TEACHER, PASSWORD)

    assert admin.get("/api/admin/teachers").status_code == 403
    assert create_teacher(admin, "x@skola.example").status_code == 403
    assert (
        admin.patch(f"/api/admin/teachers/{teacher['id']}", json={"is_admin": True}).status_code
        == 403
    )
    assert admin.post(f"/api/admin/teachers/{teacher['id']}/invitation").status_code == 403


# Audit log


def test_account_events_are_in_the_audit_log(admin, sender):
    admin_id = admin.get("/api/auth/me").json()["id"]
    teacher = invite_and_accept(admin, sender)
    url = f"/api/admin/teachers/{teacher['id']}"
    admin.patch(url, json={"is_admin": True})
    admin.patch(url, json={"is_admin": False})
    admin.patch(url, json={"active": False})
    admin.patch(url, json={"active": True})

    events = [
        (e["kind"], e["actor_id"], e["subject_id"])
        for e in admin.get("/api/admin/audit-events").json()
        if e["subject_id"] == teacher["id"]
    ]

    tid = teacher["id"]
    assert events[::-1] == [
        ("account_created", admin_id, tid),
        ("invitation_sent", admin_id, tid),
        ("invitation_accepted", tid, tid),
        ("signed_in", tid, tid),
        ("admin_granted", admin_id, tid),
        ("admin_revoked", admin_id, tid),
        ("account_deactivated", admin_id, tid),
        ("account_activated", admin_id, tid),
    ]


def test_no_invitation_is_sent_to_a_deactivated_teacher(admin, sender):
    teacher = create_teacher(admin).json()
    admin.patch(f"/api/admin/teachers/{teacher['id']}", json={"active": False})
    sent = len(sender.sent)

    response = admin.post(f"/api/admin/teachers/{teacher['id']}/invitation")

    assert response.status_code == 409
    assert response.json() == {"detail": "account_inactive"}
    assert len(sender.sent) == sent
