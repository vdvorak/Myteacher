#!/usr/bin/env bash
# Regenerate the lesson JSON Schema from the Pydantic models, then the TypeScript types from it.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"

(cd "$root/backend" && uv run --quiet python -m myteacher.lesson.export) > "$root/schema/lesson.schema.json"
(cd "$root/frontend" && node scripts/generate-types.mjs ../schema/lesson.schema.json src/generated/lesson.ts)
