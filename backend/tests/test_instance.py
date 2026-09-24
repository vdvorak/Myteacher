import sqlite3

from fastapi.testclient import TestClient

from myteacher.app import create_app


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
