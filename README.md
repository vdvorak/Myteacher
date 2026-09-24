# Myteacher

A teaching platform where a teacher designs a course with an AI assistant and every student receives an individual, teacher-controlled sequence of lessons.

- [CONTEXT.md](./CONTEXT.md): the project's vocabulary. Read it before naming anything.
- [docs/PHASE-1.md](./docs/PHASE-1.md): what phase 1 builds and leaves out.
- [docs/adr](./docs/adr): decisions and the reasons behind them.

## Running

```sh
docker build -t myteacher .
docker run -p 8000:8000 -v myteacher-data:/data myteacher
```

The app and its API are served from one origin on port 8000; the SQLite database in `/data` is created by migrations on start. Open `/preview/es-ser-estar` for the sample lesson.

## Development

- Backend (`backend/`, uv): `uv run uvicorn myteacher.app:create_app --factory --reload`, `uv run pytest`, `uv run ruff check`.
- Frontend (`frontend/`, pnpm): `pnpm dev` (proxies `/api` to port 8000), `pnpm test`, `pnpm typecheck`.
- Lesson schema: the Pydantic models in `backend/src/myteacher/lesson/schema.py` are the source of truth. After changing them, run `scripts/generate-schema.sh` and commit `schema/` and `frontend/src/generated/`; CI fails when they are stale.
