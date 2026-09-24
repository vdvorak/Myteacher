# One image: the built single-page app served by the FastAPI backend from one origin (ADR 0003).

FROM node:24-slim AS frontend
RUN corepack enable
WORKDIR /app/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock backend/.python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/ ./
RUN uv sync --frozen --no-dev
COPY --from=frontend /app/frontend/dist /app/static

ENV PATH=/app/backend/.venv/bin:$PATH \
    MYTEACHER_STATIC_DIR=/app/static \
    MYTEACHER_DATABASE_URL=sqlite:////data/myteacher.db
VOLUME /data
EXPOSE 8000
CMD ["uvicorn", "myteacher.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
