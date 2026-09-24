import json
from importlib import resources

import pytest
from fastapi.testclient import TestClient

from myteacher.app import create_app
from myteacher.settings import Settings


@pytest.fixture
def settings(tmp_path):
    return Settings(
        database_url=f"sqlite:///{tmp_path / 'myteacher.db'}", static_dir=None, secure_cookies=False
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
