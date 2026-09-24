"""Lesson document models: the single source of truth for the lesson shape.

JSON Schema and the frontend's TypeScript types are generated from these models
(see `myteacher.lesson.export`). Models ending in `Public` are what reaches the
browser; they never carry an answer key.
"""

from typing import Annotated, Literal, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from myteacher.lesson.markdown import contains_raw_html


def _reject_raw_html(text: str) -> str:
    if contains_raw_html(text):
        raise ValueError("raw HTML is not allowed in Markdown")
    return text


Markdown = Annotated[
    str,
    StringConstraints(min_length=1, max_length=20_000),
    AfterValidator(_reject_raw_html),
    Field(description="Constrained Markdown (CommonMark without raw HTML)."),
]
Identifier = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]*$", max_length=64)]
LanguageTag = Annotated[str, StringConstraints(pattern=r"^[a-z]{2,3}(-[A-Z]{2})?$")]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


FeedbackMode = Annotated[
    Literal["immediate", "at_the_end"],
    Field(
        description=(
            "immediate: each closed answer is assessed at once, with one retry and a hint "
            "after a wrong answer. at_the_end: nothing is assessed until the lesson is submitted."
        )
    ),
]


class ExplanationBlock(_Model):
    type: Literal["explanation"]
    markdown: Markdown


class ChoiceOption(_Model):
    id: Identifier
    text: Annotated[str, StringConstraints(min_length=1, max_length=500)]


class MultipleChoiceExercise(_Model):
    type: Literal["multiple_choice"]
    id: Identifier
    prompt: Markdown
    options: Annotated[list[ChoiceOption], Field(min_length=2, max_length=8)]
    correct_option_id: Identifier
    hint: Markdown | None = None
    solution_explanation: Markdown | None = None

    @model_validator(mode="after")
    def _options_are_consistent(self) -> Self:
        ids = [option.id for option in self.options]
        if len(set(ids)) != len(ids):
            raise ValueError("option ids must be unique")
        if self.correct_option_id not in ids:
            raise ValueError("correct_option_id must name one of the options")
        return self


LessonBlock = Annotated[ExplanationBlock | MultipleChoiceExercise, Field(discriminator="type")]
Exercise = MultipleChoiceExercise


class LessonDocument(_Model):
    """A lesson as stored and authored: canonical, unshuffled, with its answer key."""

    id: Identifier
    title: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    language: LanguageTag
    feedback_mode: FeedbackMode
    blocks: Annotated[list[LessonBlock], Field(min_length=1)]

    @model_validator(mode="after")
    def _exercise_ids_are_unique(self) -> Self:
        ids = [block.id for block in self.blocks if not isinstance(block, ExplanationBlock)]
        if len(set(ids)) != len(ids):
            raise ValueError("exercise ids must be unique within a lesson")
        return self

    def exercises(self) -> list[Exercise]:
        return [block for block in self.blocks if not isinstance(block, ExplanationBlock)]

    def exercise(self, exercise_id: str) -> Exercise | None:
        return next(
            (
                block
                for block in self.blocks
                if not isinstance(block, ExplanationBlock) and block.id == exercise_id
            ),
            None,
        )


class MultipleChoiceExercisePublic(_Model):
    type: Literal["multiple_choice"]
    id: Identifier
    prompt: Markdown
    options: list[ChoiceOption]
    hint: Markdown | None


ExercisePublic = MultipleChoiceExercisePublic

LessonBlockPublic = Annotated[
    ExplanationBlock | MultipleChoiceExercisePublic, Field(discriminator="type")
]


class LessonPublic(_Model):
    """A lesson as the browser receives it: no answer key, no solutions."""

    id: Identifier
    title: str
    language: LanguageTag
    feedback_mode: FeedbackMode
    blocks: list[LessonBlockPublic]


class MultipleChoiceAnswer(_Model):
    type: Literal["multiple_choice"]
    option_id: Identifier


ExerciseAnswer = MultipleChoiceAnswer


class MultipleChoiceSolution(_Model):
    type: Literal["multiple_choice"]
    option_id: Identifier
    explanation: Markdown | None


ExerciseSolution = MultipleChoiceSolution


class AssessmentResult(_Model):
    exercise_id: Identifier
    score: Annotated[float, Field(ge=0, le=1)]
    correct: bool
    solution: Annotated[
        ExerciseSolution | None,
        Field(description="Withheld (null) for a wrong answer the student may still retry."),
    ]


class SecondRoundRequest(_Model):
    failed_exercise_ids: list[Identifier]
    seed: Annotated[str, StringConstraints(min_length=1, max_length=200)]


class SecondRound(_Model):
    """Varied repeats of the failed exercises, in lesson order; empty when nothing failed."""

    exercises: list[ExercisePublic]


def exercise_to_public(exercise: Exercise) -> ExercisePublic:
    return MultipleChoiceExercisePublic(
        type=exercise.type,
        id=exercise.id,
        prompt=exercise.prompt,
        options=exercise.options,
        hint=exercise.hint,
    )


def to_public(lesson: LessonDocument) -> LessonPublic:
    return LessonPublic(
        id=lesson.id,
        title=lesson.title,
        language=lesson.language,
        feedback_mode=lesson.feedback_mode,
        blocks=[
            block if isinstance(block, ExplanationBlock) else exercise_to_public(block)
            for block in lesson.blocks
        ],
    )
