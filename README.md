# Myteacher

A teaching platform where a teacher designs a course with an AI assistant and every student receives an individual, teacher-controlled sequence of lessons.

- [CONTEXT.md](./CONTEXT.md): the project's vocabulary. Read it before naming anything.
- [docs/PHASE-1.md](./docs/PHASE-1.md): what phase 1 builds and leaves out.
- [docs/adr](./docs/adr): decisions and the reasons behind them.
- [docs/INSTALL.md](./docs/INSTALL.md): installing, configuring, backing up and upgrading an instance.

## Running

Installing an instance, including the instance secret that must be generated once and kept safe, is described in [docs/INSTALL.md](./docs/INSTALL.md). To try it locally:

```sh
docker build -t myteacher .
openssl rand -base64 48 > instance-secret   # once; keep it, see docs/INSTALL.md
docker run -p 8000:8000 -v myteacher-data:/data -e MYTEACHER_INSTANCE_SECRET="$(cat instance-secret)" \
  -e MYTEACHER_ADMIN_EMAIL=admin@example.org -e MYTEACHER_ADMIN_PASSWORD='at least 12 characters' myteacher
```

Open `http://localhost:8000` and sign in; `/preview/es-ser-estar` shows the sample lesson.

## Development

- Backend (`backend/`, uv): `MYTEACHER_INSTANCE_SECRET=<32+ characters> uv run uvicorn myteacher.app:create_app --factory --reload`, `uv run pytest`, `uv run ruff check`.
- Frontend (`frontend/`, pnpm): `pnpm dev` (proxies `/api` to port 8000), `pnpm test`, `pnpm typecheck`.
- Lesson schema: the Pydantic models in `backend/src/myteacher/lesson/schema.py` are the source of truth. After changing them, run `scripts/generate-schema.sh` and commit `schema/` (the JSON Schema and the public form of the fixture lessons, which the renderer tests load) and `frontend/src/generated/`; CI fails when they are stale.
