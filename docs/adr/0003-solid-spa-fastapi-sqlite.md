---
status: accepted
date: 2026-09-24
---

# Solid SPA + FastAPI + SQLite in one Docker image

The project starts self-hosted on a small VPS run by the project owner for two teachers, with product potential later. We decided on a SolidJS single-page app served by a FastAPI backend from a single Docker image, with SQLite as the database in phase 1. The backend is the source of truth for the exercise schema (Pydantic → JSON Schema → generated TypeScript types in the build step).

## Considered options

- **SolidStart with SSR**: rejected because a Python backend would mean a second runtime for no phase-1 benefit.
- **Postgres from day one**: deferred. SQLite keeps self-hosting to one container. Multi-tenancy is designed in from the start (every row belongs to an instance), so moving to Postgres is a migration, not a redesign.

## Consequences

- Single-node deployment only until Postgres is introduced.
- Long-running assistant calls (planning, assessment) run as background jobs inside the same process in phase 1; a separate worker is not needed at the expected scale.
