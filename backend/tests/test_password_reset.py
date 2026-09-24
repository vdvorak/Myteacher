from datetime import timedelta

import pytest

from tests.helpers import ADMIN_EMAIL, ADMIN_PASSWORD, configure_smtp, link_token, sign_in

NEW_PASSWORD = "a brand new password"


@pytest.fixture
def client(app_client):
    sign_in(app_client)
    configure_smtp(app_client)
    app_client.cookies.clear()
    return app_client


def request_reset(client, email=ADMIN_EMAIL):
    return client.post("/api/auth/password-reset/request", json={"email": email})


def complete(client, token, password=NEW_PASSWORD):
    return client.post(
        "/api/auth/password-reset/complete", json={"token": token, "password": password}
    )


def reset_token(client, sender, email=ADMIN_EMAIL) -> str:
    request_reset(client, email)
    return link_token(sender.sent[-1].message.text)


def test_a_reset_link_is_emailed_in_the_accounts_language(client, sender):
    sign_in(client)
    me = client.get("/api/auth/me").json()
    client.patch(f"/api/accounts/{me['id']}/settings", json={"language": "cs"})
    client.cookies.clear()

    response = request_reset(client)

    assert response.status_code == 202
    mail = sender.sent[-1].message
    assert mail.to == ADMIN_EMAIL
    assert "obnova hesla" in mail.subject.lower()
    assert "http://testserver/reset-password#" in mail.text


def test_the_answer_is_the_same_whether_or_not_the_email_has_an_account(client, sender):
    known = request_reset(client)
    sent = len(sender.sent)
    unknown = request_reset(client, "nobody@skola.example")

    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()
    assert len(sender.sent) == sent


def test_completing_a_reset_sets_the_password_and_signs_in(client, sender):
    token = reset_token(client, sender)

    response = complete(client, token)

    assert response.status_code == 200
    assert client.get("/api/auth/me").json()["email"] == ADMIN_EMAIL
    client.cookies.clear()
    assert sign_in(client, password=ADMIN_PASSWORD).status_code == 401
    assert sign_in(client, password=NEW_PASSWORD).status_code == 200


def test_completing_a_reset_ends_the_accounts_other_sessions(client, sender):
    sign_in(client)
    other_device = client.cookies["myteacher_session"]
    client.cookies.clear()

    complete(client, reset_token(client, sender))
    this_device = client.cookies["myteacher_session"]

    client.cookies.set("myteacher_session", other_device)
    assert client.get("/api/auth/me").status_code == 401
    client.cookies.set("myteacher_session", this_device)
    assert client.get("/api/auth/me").status_code == 200


def test_a_reset_link_works_only_once(client, sender):
    token = reset_token(client, sender)
    complete(client, token)
    client.cookies.clear()

    again = complete(client, token, password="yet another password")

    assert again.status_code == 410
    assert again.json() == {"detail": "reset_used"}
    assert sign_in(client, password="yet another password").status_code == 401


def test_a_reset_link_expires_after_an_hour(client, sender, clock):
    token = reset_token(client, sender)
    clock.now += timedelta(hours=1, minutes=1)

    response = complete(client, token)

    assert response.status_code == 410
    assert response.json() == {"detail": "reset_expired"}
    check = client.post("/api/auth/password-reset/check", json={"token": token})
    assert check.json() == {"state": "expired"}


def test_asking_again_keeps_earlier_links_working_until_one_is_used(client, sender):
    first = reset_token(client, sender)
    second = reset_token(client, sender)

    assert complete(client, second).status_code == 200
    client.cookies.clear()
    assert complete(client, first).status_code == 410


def test_a_reset_voids_an_invitation_that_was_never_accepted(client, sender):
    sign_in(client)
    client.post("/api/admin/teachers", json={"email": "novak@skola.example", "language": "en"})
    invitation = link_token(sender.sent[-1].message.text)
    client.cookies.clear()

    complete(client, reset_token(client, sender, "novak@skola.example"))
    client.cookies.clear()
    late = client.post(
        "/api/auth/invitations/accept", json={"token": invitation, "password": "x" * 12}
    )

    assert late.status_code == 410
    assert sign_in(client, "novak@skola.example", NEW_PASSWORD).status_code == 200


def test_an_unknown_reset_link_is_refused(client):
    response = complete(client, "made-up-token")

    assert response.status_code == 404
    assert response.json() == {"detail": "reset_unknown"}
    check = client.post("/api/auth/password-reset/check", json={"token": "made-up-token"})
    assert check.json() == {"state": "unknown"}


def test_the_new_password_must_be_long_enough(client, sender):
    token = reset_token(client, sender)

    assert complete(client, token, password="short").status_code == 422
    assert complete(client, token).status_code == 200


def test_a_deactivated_account_cannot_reset_its_way_back_in(client, sender):
    sign_in(client)
    teacher = client.post(
        "/api/admin/teachers", json={"email": "novak@skola.example", "language": "en"}
    ).json()
    invitation = link_token(sender.sent[-1].message.text)
    client.cookies.clear()
    client.post("/api/auth/invitations/accept", json={"token": invitation, "password": "x" * 12})
    client.cookies.clear()
    token = reset_token(client, sender, "novak@skola.example")
    sign_in(client)
    client.patch(f"/api/admin/teachers/{teacher['id']}", json={"active": False})
    client.cookies.clear()
    sent = len(sender.sent)

    assert complete(client, token).status_code == 403
    assert request_reset(client, "novak@skola.example").status_code == 202
    assert len(sender.sent) == sent


def test_a_failing_mail_server_does_not_change_the_answer(client, sender):
    sender.fail_with = "Could not connect to smtp.skola.example:587."

    assert request_reset(client).status_code == 202


def test_the_reset_is_in_the_audit_log(client, sender):
    complete(client, reset_token(client, sender))

    kinds = [e["kind"] for e in client.get("/api/admin/audit-events").json()]

    assert kinds[:3] == ["signed_in", "password_reset", "password_reset_requested"]
