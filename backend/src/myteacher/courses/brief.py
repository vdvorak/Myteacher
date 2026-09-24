"""The course brief: the structured description every generation for the course is based on."""

from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from myteacher.lesson.catalog import CatalogType
from myteacher.lesson.schema import FeedbackMode


def _blank_is_none(text: str | None) -> str | None:
    if text is None:
        return None
    return text.strip() or None


def _unique(types: list[str]) -> list[str]:
    return list(dict.fromkeys(types))


BriefText = Annotated[str | None, Field(max_length=5000), AfterValidator(_blank_is_none)]
ExerciseTypes = Annotated[list[CatalogType], AfterValidator(_unique)]


class CourseBrief(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Who the students are: age, year, background.
    audience: BriefText = None
    level: BriefText = None
    goals: BriefText = None
    timeframe: BriefText = None
    # Chosen from the component catalog; a type is never both.
    preferred_exercise_types: ExerciseTypes = []
    forbidden_exercise_types: ExerciseTypes = []
    tone: BriefText = None
    # Defaults a lesson inherits in later slices.
    feedback_mode: FeedbackMode = "immediate"
    # With immediate feedback: one retry with a hint after a wrong answer.
    retry_with_hint: bool = True
    # Exercises answered wrongly return at the end of the lesson.
    second_round: bool = True
    notes: BriefText = None

    def overlapping_types(self) -> set[str]:
        return set(self.preferred_exercise_types) & set(self.forbidden_exercise_types)
