import json
from importlib import resources

import pytest
from fastapi.testclient import TestClient

from myteacher.app import create_app
from myteacher.mail import RecordingSender
from myteacher.settings import Settings
from tests.helpers import ADMIN_EMAIL, ADMIN_PASSWORD, INSTANCE_SECRET, FakeClock, ScriptedModels


@pytest.fixture
def settings(tmp_path):
    return Settings(
        database_url=f"sqlite:///{tmp_path / 'myteacher.db'}",
        static_dir=None,
        secure_cookies=False,
        instance_secret=INSTANCE_SECRET,
    )


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as client:
        yield client


@pytest.fixture
def spanish_lesson() -> dict:
    """The full fixture lesson document, answer key included, as a teacher tool would hold it."""
    path = resources.files("myteacher.fixtures") / "lessons" / "es-ser-estar.json"
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture
def admin_settings(settings) -> Settings:
    return settings.model_copy(
        update={"admin_email": ADMIN_EMAIL, "admin_password": ADMIN_PASSWORD}
    )


@pytest.fixture
def clock():
    return FakeClock()


@pytest.fixture
def sender() -> RecordingSender:
    return RecordingSender()


@pytest.fixture
def models() -> ScriptedModels:
    return ScriptedModels()


@pytest.fixture
def app_client(admin_settings, clock, sender, models):
    app = create_app(admin_settings, clock=clock, sender=sender, model_factory=models)
    with TestClient(app) as client:
        yield client
