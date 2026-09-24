import sqlite3
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from myteacher import cli
from myteacher.accounts import service
from myteacher.app import create_app
from myteacher.persistence import UnscopedQuery, open_session, utc_now
from myteacher.settings import Settings
from tests.helpers import ADMIN_EMAIL, ADMIN_PASSWORD, create_engine_for, sign_in

# Admin bootstrap


def test_admin_from_deploy_configuration_can_sign_in(app_client):
    response = sign_in(app_client)

    assert response.status_code == 200
    assert response.json()["email"] == ADMIN_EMAIL
    assert response.json()["roles"] == ["teacher", "admin"]


def test_email_is_matched_regardless_of_case_and_surrounding_space(app_client):
    assert sign_in(app_client, email="  Admin@Skola.Example ").status_code == 200


def test_restarting_with_the_same_configuration_keeps_one_admin(admin_settings, clock):
    for _ in range(2):
        with TestClient(create_app(admin_settings, clock=clock)) as client:
            assert sign_in(client).status_code == 200

    with TestClient(create_app(admin_settings, clock=clock)) as client:
        sign_in(client)
        created = [
            e for e in client.get("/api/admin/audit-events").json() if e["kind"] == "admin_created"
        ]
    assert len(created) == 1


def test_a_second_admin_is_not_created_once_an_admin_exists(admin_settings, clock):
    with TestClient(create_app(admin_settings, clock=clock)):
        pass
    other = admin_settings.model_copy(
        update={"admin_email": "other@skola.example", "admin_password": "another long password"}
    )

    with TestClient(create_app(other, clock=clock)) as client:
        assert sign_in(client, "other@skola.example", "another long password").status_code == 401
        assert sign_in(client).status_code == 200


def test_incomplete_or_weak_admin_configuration_fails_at_start(settings):
    with pytest.raises(ValueError, match="both"):
        with TestClient(create_app(settings.model_copy(update={"admin_email": ADMIN_EMAIL}))):
            pass
    weak = settings.model_copy(update={"admin_email": ADMIN_EMAIL, "admin_password": "short"})
    with pytest.raises(ValueError, match="at least"):
        with TestClient(create_app(weak)):
            pass


def test_admin_can_be_created_by_a_one_off_command(settings, monkeypatch, capsys):
    monkeypatch.setenv("MYTEACHER_DATABASE_URL", settings.database_url)
    monkeypatch.setenv("MYTEACHER_ADMIN_PASSWORD", ADMIN_PASSWORD)
    monkeypatch.setenv("MYTEACHER_INSTANCE_SECRET", settings.instance_secret)

    assert cli.main(["create-admin", "--email", ADMIN_EMAIL]) == 0
    assert "created" in capsys.readouterr().out
    assert cli.main(["create-admin", "--email", "other@skola.example"]) == 0
    assert "already" in capsys.readouterr().out

    with TestClient(create_app(settings)) as client:
        assert sign_in(client).status_code == 200
        assert sign_in(client, "other@skola.example").status_code == 401


def test_password_is_stored_only_as_a_modern_hash(app_client, settings):
    database = settings.database_url.removeprefix("sqlite:///")
    dump = "\n".join(sqlite3.connect(database).iterdump())

    assert ADMIN_PASSWORD not in dump
    assert "$argon2id$" in dump


# Sign-in and sessions


def test_sign_in_sets_an_http_only_same_site_session_cookie(app_client, admin_settings):
    cookie = sign_in(app_client).headers["set-cookie"]

    assert cookie.startswith("myteacher_session=")
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    assert f"Max-Age={int(admin_settings.session_lifetime.total_seconds())}" in cookie
    assert "Path=/" in cookie


def test_session_cookie_is_secure_by_default():
    assert Settings(
        database_url="sqlite://", static_dir=None, instance_secret="s" * 32
    ).secure_cookies


def test_wrong_password_and_unknown_email_get_the_same_generic_answer(app_client):
    wrong_password = sign_in(app_client, password="not the password")
    unknown_email = sign_in(app_client, email="nobody@skola.example")

    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json() == unknown_email.json() == {"detail": "invalid_credentials"}
    assert "set-cookie" not in wrong_password.headers


def test_who_am_i_returns_the_signed_in_account(app_client):
    signed_in = sign_in(app_client).json()

    me = app_client.get("/api/auth/me")

    assert me.status_code == 200
    assert me.json() == signed_in
    assert set(me.json()) == {"id", "email", "name", "kind", "roles", "language"}


def test_who_am_i_refuses_anonymous_requests(app_client):
    assert app_client.get("/api/auth/me").status_code == 401


def test_a_forged_session_cookie_is_refused(app_client):
    app_client.cookies.set("myteacher_session", "made-up-token")

    assert app_client.get("/api/auth/me").status_code == 401


def test_sign_out_deletes_the_session(app_client):
    sign_in(app_client)
    token = app_client.cookies["myteacher_session"]

    response = app_client.post("/api/auth/sign-out")

    assert response.status_code == 204
    assert app_client.get("/api/auth/me").status_code == 401
    # The old cookie is useless even if it was kept somewhere.
    app_client.cookies.set("myteacher_session", token)
    assert app_client.get("/api/auth/me").status_code == 401


def test_session_expires_after_its_lifetime(app_client, admin_settings, clock):
    sign_in(app_client)

    clock.now += admin_settings.session_lifetime - timedelta(minutes=1)
    assert app_client.get("/api/auth/me").status_code == 200
    clock.now += timedelta(minutes=2)
    assert app_client.get("/api/auth/me").status_code == 401


def test_signing_in_again_replaces_the_previous_session(app_client):
    sign_in(app_client)
    first = app_client.cookies["myteacher_session"]

    sign_in(app_client)

    app_client.cookies.set("myteacher_session", first)
    assert app_client.get("/api/auth/me").status_code == 401


# Authorisation


def test_audit_log_is_for_admins_only(app_client, admin_settings):
    assert app_client.get("/api/admin/audit-events").status_code == 401

    with open_session(create_engine_for(admin_settings)) as db:
        service.create_account(
            db,
            email="teacher@skola.example",
            password="a teacher password",
            kind="teacher",
            now=utc_now(),
        )
        db.commit()
    sign_in(app_client, "teacher@skola.example", "a teacher password")

    assert app_client.get("/api/admin/audit-events").status_code == 403


# Audit log


def test_admin_creation_and_sign_in_are_in_the_audit_log(app_client, clock):
    admin_id = sign_in(app_client).json()["id"]

    events = app_client.get("/api/admin/audit-events").json()

    assert [(e["kind"], e["actor_id"], e["subject_id"]) for e in events] == [
        ("signed_in", admin_id, admin_id),
        ("admin_created", None, admin_id),
    ]
    assert all(e["at"] == "2026-09-24T08:00:00Z" for e in events)


def test_sign_out_is_in_the_audit_log(app_client):
    admin_id = sign_in(app_client).json()["id"]
    app_client.post("/api/auth/sign-out")
    sign_in(app_client)

    kinds = [e["kind"] for e in app_client.get("/api/admin/audit-events").json()]

    assert kinds[:3] == ["signed_in", "signed_out", "signed_in"]
    assert admin_id


# Instance ownership (ADR 0003)


def test_singleton_instance_exists_after_migrations(settings):
    with TestClient(create_app(settings)):
        pass
    database = settings.database_url.removeprefix("sqlite:///")

    assert sqlite3.connect(database).execute("select count(*) from instance").fetchone() == (1,)


def test_every_table_is_owned_by_an_instance(settings):
    with TestClient(create_app(settings)):
        pass
    db = sqlite3.connect(settings.database_url.removeprefix("sqlite:///"))
    tables = [
        row[0]
        for row in db.execute("select name from sqlite_master where type = 'table'")
        if row[0] not in {"instance", "alembic_version"}
    ]

    assert tables
    for table in tables:
        columns = {row[1]: row for row in db.execute(f"pragma table_info({table})")}
        assert "instance_id" in columns, table
        assert columns["instance_id"][3] == 1, f"{table}.instance_id must be not null"


def test_queries_are_scoped_to_the_session_instance(admin_settings):
    engine = create_engine_for(admin_settings)
    with TestClient(create_app(admin_settings)):
        pass

    with open_session(engine) as db:
        assert service.find_account_by_email(db, ADMIN_EMAIL) is not None
    with open_session(engine, instance_id=999) as db:
        assert service.find_account_by_email(db, ADMIN_EMAIL) is None
    with open_session(engine, instance_id=None) as db, pytest.raises(UnscopedQuery):
        service.find_account_by_email(db, ADMIN_EMAIL)


def deactivate(settings: Settings, email: str) -> None:
    with open_session(create_engine_for(settings)) as db:
        service.find_account_by_email(db, email).active = False
        db.commit()


def test_an_inactive_account_is_told_so_and_its_sessions_stop_working(app_client, admin_settings):
    sign_in(app_client)
    deactivate(admin_settings, ADMIN_EMAIL)

    assert app_client.get("/api/auth/me").status_code == 401
    response = sign_in(app_client)
    assert response.status_code == 403
    assert response.json() == {"detail": "account_inactive"}
    assert "set-cookie" not in response.headers
    # A wrong password still gets only the generic answer.
    assert sign_in(app_client, password="not the password").status_code == 401


def test_admin_bootstrap_refuses_an_email_that_belongs_to_another_account(settings):
    with TestClient(create_app(settings)):
        pass
    with open_session(create_engine_for(settings)) as db:
        service.create_account(db, email=ADMIN_EMAIL, kind="student", now=utc_now())
        db.commit()

    with (
        open_session(create_engine_for(settings)) as db,
        pytest.raises(ValueError, match="already"),
    ):
        service.ensure_admin(db, email=ADMIN_EMAIL, password=ADMIN_PASSWORD, now=utc_now())
