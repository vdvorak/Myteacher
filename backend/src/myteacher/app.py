import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import Engine

from myteacher.accounts import service
from myteacher.api import (
    access,
    accounts,
    admin,
    attempts,
    auth,
    classes,
    classroom_materials,
    concept_maps,
    course_archive,
    courses,
    interview,
    jobs,
    lessons,
    open_assessment,
    providers,
    reference_documents,
    results,
    runs,
    sources,
    students,
    topic_interview,
    topics,
)
from myteacher.assistant.providers import ModelFactory, pydantic_ai_model
from myteacher.assistant.service import AssistantContext
from myteacher.courses.pages import PageFetcher
from myteacher.db import migrate
from myteacher.jobs.runner import JobContext, fail_interrupted
from myteacher.mail import Sender, SmtpSender
from myteacher.persistence import Clock, make_engine, open_session, singleton_instance_id, utc_now
from myteacher.secret_box import SecretBox
from myteacher.settings import Settings


def create_app(
    settings: Settings | None = None,
    *,
    clock: Clock = utc_now,
    sender: Sender | None = None,
    model_factory: ModelFactory = pydantic_ai_model,
    page_fetcher: PageFetcher | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        secret_box = SecretBox(settings.instance_secret)
        migrate(settings.database_url, secret_box)
        engine = make_engine(settings.database_url)
        app.state.settings = settings
        app.state.clock = clock
        app.state.sender = sender or SmtpSender()
        app.state.secret_box = secret_box
        app.state.model_factory = model_factory
        app.state.engine = engine
        app.state.instance_id = singleton_instance_id(engine)
        app.state.jobs = JobContext(
            engine=engine,
            instance_id=app.state.instance_id,
            assistant=AssistantContext(
                model_factory=model_factory, secret_box=secret_box, clock=clock
            ),
            pages=page_fetcher or PageFetcher(),
        )
        # One process runs every job (phase 1), so whatever it did not finish was cut off.
        with open_session(engine, app.state.instance_id) as db:
            fail_interrupted(db, clock())
            db.commit()
        bootstrap_admin(engine, settings, clock)
        yield
        engine.dispose()

    app = FastAPI(title="Myteacher", lifespan=lifespan)
    app.add_exception_handler(RequestValidationError, _refused)  # type: ignore[arg-type]

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(lessons.router, prefix="/api")
    app.include_router(auth.router, prefix="/api")
    app.include_router(admin.router, prefix="/api")
    app.include_router(accounts.router, prefix="/api")
    app.include_router(providers.router, prefix="/api")
    app.include_router(students.router, prefix="/api")
    app.include_router(classes.router, prefix="/api")
    app.include_router(runs.router, prefix="/api")
    app.include_router(attempts.router, prefix="/api")
    app.include_router(results.router, prefix="/api")
    app.include_router(open_assessment.router, prefix="/api")
    app.include_router(courses.router, prefix="/api")
    app.include_router(course_archive.router, prefix="/api")
    app.include_router(topics.router, prefix="/api")
    app.include_router(concept_maps.router, prefix="/api")
    app.include_router(concept_maps.course_router, prefix="/api")
    app.include_router(topic_interview.router, prefix="/api")
    app.include_router(reference_documents.router, prefix="/api")
    app.include_router(classroom_materials.router, prefix="/api")
    app.include_router(access.router, prefix="/api")
    app.include_router(sources.router, prefix="/api")
    app.include_router(interview.router, prefix="/api")
    app.include_router(jobs.router, prefix="/api")

    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def unknown_api_route(path: str) -> None:
        raise HTTPException(status_code=404)

    if settings.static_dir is not None:
        _serve_single_page_app(app, settings.static_dir)
    return app


class _AsciiJSONResponse(JSONResponse):
    def render(self, content: Any) -> bytes:
        return json.dumps(content, separators=(",", ":")).encode("ascii")


async def _refused(request: Request, error: RequestValidationError) -> JSONResponse:
    """FastAPI's 422, escaped to ASCII: it echoes the input, and half of a surrogate pair, which
    JSON allows, has no UTF-8."""
    return _AsciiJSONResponse(status_code=422, content={"detail": jsonable_encoder(error.errors())})


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
