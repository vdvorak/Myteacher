import sqlite3
from importlib import resources

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

from myteacher.app import create_app
from myteacher.db import migrate
from myteacher.secret_box import SecretBox


def test_database_is_created_by_migrations_on_start(settings, tmp_path):
    database = tmp_path / "myteacher.db"
    assert not database.exists()

    with TestClient(create_app(settings)) as client:
        assert client.get("/api/health").json() == {"status": "ok"}

    tables = {row[0] for row in sqlite3.connect(database).execute("select name from sqlite_master")}
    assert {"alembic_version", "instance"} <= tables


def test_starting_twice_on_the_same_database_is_harmless(settings):
    for _ in range(2):
        with TestClient(create_app(settings)) as client:
            assert client.get("/api/health").status_code == 200


def test_built_app_is_served_from_the_same_origin_as_the_api(settings, tmp_path):
    static = tmp_path / "static"
    (static / "assets").mkdir(parents=True)
    (static / "index.html").write_text("<!doctype html><title>Myteacher</title>")
    (static / "assets" / "app.js").write_text("console.log(1)")
    settings = settings.model_copy(update={"static_dir": static})

    with TestClient(create_app(settings)) as client:
        assert "Myteacher" in client.get("/").text
        assert "Myteacher" in client.get("/preview/es-ser-estar").text
        assert client.get("/assets/app.js").text == "console.log(1)"
        assert (
            client.get("/api/lessons/es-ser-estar")
            .headers["content-type"]
            .startswith("application/json")
        )
        assert client.get("/api/nope").status_code == 404


def test_the_link_run_migrations_go_down_and_up_again(tmp_path):
    database = tmp_path / "myteacher.db"
    url = f"sqlite:///{database}"
    box = SecretBox("x" * 44)
    migrate(url, box)
    config = Config()
    config.set_main_option("script_location", str(resources.files("myteacher") / "migrations"))
    config.set_main_option("sqlalchemy.url", url)
    config.attributes["secret_box"] = box

    command.downgrade(config, "0031")
    columns = {row[1] for row in sqlite3.connect(database).execute("pragma table_info(attempt)")}
    assert "participant_id" not in columns
    command.upgrade(config, "head")
    columns = {row[1] for row in sqlite3.connect(database).execute("pragma table_info(attempt)")}
    assert "participant_id" in columns
