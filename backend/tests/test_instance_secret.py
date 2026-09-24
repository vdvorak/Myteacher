import sqlite3

import pytest
from fastapi.testclient import TestClient

from myteacher.app import create_app
from myteacher.settings import Settings
from tests.helpers import SMTP, configure_smtp, sign_in


def test_the_instance_secret_is_required(monkeypatch, tmp_path):
    monkeypatch.setenv("MYTEACHER_DATABASE_URL", f"sqlite:///{tmp_path / 'db.sqlite'}")
    monkeypatch.delenv("MYTEACHER_INSTANCE_SECRET", raising=False)

    with pytest.raises(ValueError, match="MYTEACHER_INSTANCE_SECRET"):
        Settings.from_env()


def test_a_short_instance_secret_is_refused():
    with pytest.raises(ValueError, match="at least 32"):
        Settings(database_url="sqlite://", static_dir=None, instance_secret="too short")


def test_the_smtp_password_is_encrypted_at_rest(app_client, settings):
    sign_in(app_client)
    configure_smtp(app_client)

    dump = "\n".join(sqlite3.connect(settings.database_url.removeprefix("sqlite:///")).iterdump())

    assert SMTP["password"] not in dump


def test_stored_secrets_need_the_same_instance_secret(admin_settings, sender, models):
    with TestClient(create_app(admin_settings, sender=sender, model_factory=models)) as client:
        sign_in(client)
        configure_smtp(client)
    other = admin_settings.model_copy(
        update={"instance_secret": "a different secret, also long enough"}
    )

    with TestClient(create_app(other, sender=sender, model_factory=models)) as client:
        sign_in(client)
        response = client.post(
            "/api/admin/smtp/test", json={"to": "x@skola.example", "language": "en"}
        )

    assert response.json()["delivered"] is False
    assert "instance secret" in response.json()["error"]
