import pytest

from myteacher.accounts import service
from myteacher.persistence import open_session, utc_now
from tests.helpers import create_engine_for, sign_in

TEACHER = "teacher@skola.example"
TEACHER_PASSWORD = "a teacher password"


@pytest.fixture
def teacher_id(app_client, admin_settings) -> int:
    with open_session(create_engine_for(admin_settings)) as db:
        teacher = service.create_account(
            db, email=TEACHER, password=TEACHER_PASSWORD, kind="teacher", now=utc_now()
        )
        db.commit()
        return teacher.id


def settings_url(account_id: int) -> str:
    return f"/api/accounts/{account_id}/settings"


def test_a_new_teacher_has_no_language_and_the_instance_default_digest_time(app_client):
    me = sign_in(app_client).json()

    settings = app_client.get(settings_url(me["id"])).json()

    assert settings == {"language": None, "digest_time": "07:00", "digest_time_is_default": True}
    assert me["language"] is None


def test_the_language_is_stored_and_returned_at_sign_in_on_any_device(app_client, admin_settings):
    me = sign_in(app_client).json()

    response = app_client.patch(settings_url(me["id"]), json={"language": "cs"})

    assert response.status_code == 200
    assert response.json()["language"] == "cs"
    app_client.cookies.clear()
    assert sign_in(app_client).json()["language"] == "cs"
    assert app_client.get("/api/auth/me").json()["language"] == "cs"


def test_the_digest_time_is_stored_until_reset_to_the_default(app_client):
    me = sign_in(app_client).json()

    set_time = app_client.patch(settings_url(me["id"]), json={"digest_time": "18:30"}).json()
    reset = app_client.patch(settings_url(me["id"]), json={"digest_time": None}).json()

    assert set_time["digest_time"] == "18:30"
    assert set_time["digest_time_is_default"] is False
    assert reset == {"language": None, "digest_time": "07:00", "digest_time_is_default": True}


def test_changing_one_setting_keeps_the_other(app_client):
    me = sign_in(app_client).json()
    app_client.patch(settings_url(me["id"]), json={"digest_time": "18:30"})

    settings = app_client.patch(settings_url(me["id"]), json={"language": "en"}).json()

    assert settings["digest_time"] == "18:30"
    assert settings["language"] == "en"


@pytest.mark.parametrize(
    "change",
    [
        {"digest_time": "24:00"},
        {"digest_time": "7:30"},
        {"digest_time": "07:60"},
        {"digest_time": "noon"},
        {"language": "de"},
        {"language": None},
        {"theme": "dark"},
    ],
)
def test_invalid_settings_are_rejected(app_client, change):
    me = sign_in(app_client).json()

    assert app_client.patch(settings_url(me["id"]), json=change).status_code == 422
    assert app_client.get(settings_url(me["id"])).json()["digest_time_is_default"] is True


def test_only_the_teacher_themselves_can_read_or_change_their_settings(app_client, teacher_id):
    sign_in(app_client)  # the admin

    assert app_client.get(settings_url(teacher_id)).status_code == 403
    assert app_client.patch(settings_url(teacher_id), json={"language": "cs"}).status_code == 403

    app_client.cookies.clear()
    sign_in(app_client, TEACHER, TEACHER_PASSWORD)
    assert app_client.patch(settings_url(teacher_id), json={"language": "cs"}).status_code == 200


def test_settings_need_a_signed_in_account(app_client, teacher_id):
    assert app_client.get(settings_url(teacher_id)).status_code == 401
