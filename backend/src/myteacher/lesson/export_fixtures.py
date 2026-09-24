"""Write the public form of every fixture lesson, as the browser receives it, to a directory.

The frontend's renderer tests load these files, so the preview is tested against the real
fixtures; CI regenerates them with the schema and fails when they are stale.

    uv run python -m myteacher.lesson.export_fixtures ../schema/fixtures
"""

import json
import sys
from pathlib import Path

from myteacher.lesson.fixtures import fixture_lessons
from myteacher.lesson.schema import to_public


def export_public_fixtures(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for stale in directory.glob("*.public.json"):
        stale.unlink()
    for lesson_id, lesson in sorted(fixture_lessons().items()):
        public = to_public(lesson).model_dump(mode="json")
        text = json.dumps(public, indent=2, ensure_ascii=False) + "\n"
        (directory / f"{lesson_id}.public.json").write_text(text, encoding="utf-8")


if __name__ == "__main__":
    export_public_fixtures(Path(sys.argv[1]))
