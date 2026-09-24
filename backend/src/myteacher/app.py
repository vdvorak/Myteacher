from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from myteacher.api import lessons
from myteacher.db import migrate
from myteacher.settings import Settings


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        migrate(settings.database_url)
        yield

    app = FastAPI(title="Myteacher", lifespan=lifespan)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(lessons.router, prefix="/api")

    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def unknown_api_route(path: str) -> None:
        raise HTTPException(status_code=404)

    if settings.static_dir is not None:
        _serve_single_page_app(app, settings.static_dir)
    return app


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
