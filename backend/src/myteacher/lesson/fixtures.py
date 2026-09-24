"""Fixture lessons shipped with the app, served to the preview page until lessons are stored."""

from functools import cache
from importlib import resources

from myteacher.lesson.schema import LessonDocument


@cache
def fixture_lessons() -> dict[str, LessonDocument]:
    directory = resources.files("myteacher.fixtures") / "lessons"
    lessons = (
        LessonDocument.model_validate_json(path.read_text(encoding="utf-8"))
        for path in directory.iterdir()
        if path.name.endswith(".json")
    )
    return {lesson.id: lesson for lesson in lessons}
