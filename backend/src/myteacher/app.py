from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import Engine

from myteacher.accounts import service
from myteacher.api import admin, auth, lessons
from myteacher.db import migrate
from myteacher.persistence import Clock, make_engine, open_session, singleton_instance_id, utc_now
from myteacher.settings import Settings


def create_app(settings: Settings | None = None, *, clock: Clock = utc_now) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        migrate(settings.database_url)
        engine = make_engine(settings.database_url)
        app.state.settings = settings
        app.state.clock = clock
        app.state.engine = engine
        app.state.instance_id = singleton_instance_id(engine)
        bootstrap_admin(engine, settings, clock)
        yield
        engine.dispose()

    app = FastAPI(title="Myteacher", lifespan=lifespan)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(lessons.router, prefix="/api")
    app.include_router(auth.router, prefix="/api")
    app.include_router(admin.router, prefix="/api")

    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def unknown_api_route(path: str) -> None:
        raise HTTPException(status_code=404)

    if settings.static_dir is not None:
        _serve_single_page_app(app, settings.static_dir)
    return app


def bootstrap_admin(engine: Engine, settings: Settings, clock: Clock) -> None:
    """Create the first admin from deploy configuration; harmless on every later start."""
    if settings.admin_email is None and settings.admin_password is None:
        return
    if settings.admin_email is None or settings.admin_password is None:
        raise ValueError("set both MYTEACHER_ADMIN_EMAIL and MYTEACHER_ADMIN_PASSWORD, or neither")
    with open_session(engine) as db:
        service.ensure_admin(
            db, email=settings.admin_email, password=settings.admin_password, now=clock()
        )
        db.commit()


def _serve_single_page_app(app: FastAPI, static_dir: Path) -> None:
    """Serve the built frontend from the API's origin; unknown paths fall back to index.html."""
    app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")
    index = static_dir / "index.html"

    @app.get("/{path:path}", include_in_schema=False)
    def single_page_app(path: str) -> FileResponse:
        candidate = (static_dir / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(static_dir.resolve()):
            return FileResponse(candidate)
        return FileResponse(index)
