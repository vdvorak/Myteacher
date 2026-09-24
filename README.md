# Myteacher

A teaching platform where a teacher designs a course with an AI assistant and every student receives an individual, teacher-controlled sequence of lessons.

- [CONTEXT.md](./CONTEXT.md): the project's vocabulary. Read it before naming anything.
- [docs/PHASE-1.md](./docs/PHASE-1.md): what phase 1 builds and leaves out.
- [docs/adr](./docs/adr): decisions and the reasons behind them.

## Running

```sh
docker build -t myteacher .
openssl rand -base64 48 > instance-secret   # once; keep it, see below
docker run -p 8000:8000 -v myteacher-data:/data -e MYTEACHER_INSTANCE_SECRET="$(cat instance-secret)" myteacher
```

The app and its API are served from one origin on port 8000; the SQLite database in `/data` is created by migrations on start. Open `/preview/es-ser-estar` for the sample lesson.

There is no registration page. Create the first admin either from deploy configuration, which is harmless on every later start because nothing is created once the instance has an admin:

```sh
docker run -p 8000:8000 -v myteacher-data:/data -e MYTEACHER_INSTANCE_SECRET=… \
  -e MYTEACHER_ADMIN_EMAIL=admin@example.org -e MYTEACHER_ADMIN_PASSWORD='at least 12 characters' \
  myteacher
```

or with a one-off command that asks for the password:

```sh
docker run -it --rm -v myteacher-data:/data -e MYTEACHER_INSTANCE_SECRET=… myteacher myteacher create-admin --email admin@example.org
```

| Variable | Default | Meaning |
|---|---|---|
| `MYTEACHER_INSTANCE_SECRET` | required | At least 32 random characters. Encrypts teachers' provider keys and the SMTP password at rest. Keep it with your backups: without it they cannot be read, and a copied database alone reveals none of them. Generate one with `openssl rand -base64 48`. |
| `MYTEACHER_ADMIN_EMAIL`, `MYTEACHER_ADMIN_PASSWORD` | unset | The first admin, created on start if the instance has none. |
| `MYTEACHER_SESSION_HOURS` | `168` | How long a sign-in lasts. |
| `MYTEACHER_PUBLIC_URL` | the request's address | The address people open the app at, used in invitation links. Set it behind a reverse proxy. |
| `MYTEACHER_SECURE_COOKIES` | `true` | Set to `false` only when serving plain HTTP on a host other than localhost. |

## Development

- Backend (`backend/`, uv): `MYTEACHER_INSTANCE_SECRET=<32+ characters> uv run uvicorn myteacher.app:create_app --factory --reload`, `uv run pytest`, `uv run ruff check`.
- Frontend (`frontend/`, pnpm): `pnpm dev` (proxies `/api` to port 8000), `pnpm test`, `pnpm typecheck`.
- Lesson schema: the Pydantic models in `backend/src/myteacher/lesson/schema.py` are the source of truth. After changing them, run `scripts/generate-schema.sh` and commit `schema/` (the JSON Schema and the public form of the fixture lessons, which the renderer tests load) and `frontend/src/generated/`; CI fails when they are stale.
