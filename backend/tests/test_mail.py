import pytest

from tests.helpers import sign_in

SMTP = {
    "host": "smtp.skola.example",
    "port": 587,
    "security": "starttls",
    "username": "myteacher",
    "password": "smtp secret",
    "sender": "myteacher@skola.example",
}


@pytest.fixture
def admin(app_client):
    sign_in(app_client)
    return app_client


def save(client, **changes):
    return client.put("/api/admin/smtp", json={**SMTP, **changes})


def send_test(client, to="teacher@skola.example", language="en"):
    return client.post("/api/admin/smtp/test", json={"to": to, "language": language})


# Settings


def test_a_fresh_instance_has_no_smtp_settings(admin):
    settings = admin.get("/api/admin/smtp").json()

    assert settings["configured"] is False
    assert settings["password_set"] is False


def test_saved_settings_are_read_back_without_the_password(admin):
    assert save(admin).status_code == 200

    response = admin.get("/api/admin/smtp")

    assert response.json() == {
        "configured": True,
        "host": "smtp.skola.example",
        "port": 587,
        "security": "starttls",
        "username": "myteacher",
        "sender": "myteacher@skola.example",
        "password_set": True,
    }
    assert "smtp secret" not in response.text


def test_saving_without_a_password_keeps_the_stored_one(admin, sender):
    save(admin)
    changes = {k: v for k, v in SMTP.items() if k != "password"}

    admin.put("/api/admin/smtp", json={**changes, "host": "mail.skola.example"})
    send_test(admin)

    assert admin.get("/api/admin/smtp").json()["password_set"] is True
    config = sender.sent[-1].config
    assert (config.host, config.password) == ("mail.skola.example", "smtp secret")


def test_an_empty_password_clears_the_stored_one(admin):
    save(admin)

    save(admin, password="", username="")

    assert admin.get("/api/admin/smtp").json()["password_set"] is False


@pytest.mark.parametrize(
    "changes",
    [{"host": " "}, {"port": 0}, {"port": 70000}, {"sender": "not an email"}, {"security": "x"}],
)
def test_invalid_settings_are_rejected(admin, changes):
    assert save(admin, **changes).status_code == 422
    assert admin.get("/api/admin/smtp").json()["configured"] is False


def test_changing_smtp_settings_is_in_the_audit_log(admin):
    save(admin)

    assert admin.get("/api/admin/audit-events").json()[0]["kind"] == "smtp_settings_changed"


def test_only_admins_see_or_change_smtp_settings(app_client):
    assert app_client.get("/api/admin/smtp").status_code == 401
    assert save(app_client).status_code == 401
    assert send_test(app_client).status_code == 401


# Test email


def test_test_email_is_sent_with_the_stored_settings(admin, sender):
    save(admin)

    response = send_test(admin)

    assert response.json() == {"delivered": True, "error": None}
    [sent] = sender.sent
    assert sent.message.to == "teacher@skola.example"
    assert "Myteacher" in sent.message.subject
    assert sent.config.host == "smtp.skola.example"
    assert sent.config.sender == "myteacher@skola.example"


def test_test_email_is_written_in_the_language_asked_for(admin, sender):
    save(admin)

    send_test(admin, language="cs")
    send_test(admin, language="en")

    czech, english = (sent.message for sent in sender.sent)
    assert "zkušební" in czech.subject.lower()
    assert "test" in english.subject.lower()
    assert czech.text != english.text


def test_test_email_reports_the_smtp_error_in_plain_words(admin, sender):
    save(admin)
    sender.fail_with = "The SMTP server rejected the username or password."

    response = send_test(admin)

    assert response.json() == {
        "delivered": False,
        "error": "The SMTP server rejected the username or password.",
    }


def test_test_email_says_when_smtp_is_not_configured(admin, sender):
    response = send_test(admin)

    assert response.json()["delivered"] is False
    assert "not configured" in response.json()["error"]
    assert sender.sent == []


def test_test_email_needs_a_valid_address(admin):
    save(admin)

    assert send_test(admin, to="nobody").status_code == 422
    assert send_test(admin, language="de").status_code == 422
