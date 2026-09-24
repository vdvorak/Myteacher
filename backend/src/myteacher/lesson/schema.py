"""Lesson document models: the single source of truth for the lesson shape.

JSON Schema and the frontend's TypeScript types are generated from these models
(see `myteacher.lesson.export`). Models ending in `Public` are what reaches the
browser; they never carry an answer key.
"""

import json
from typing import Annotated, Literal, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
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

    def public(self) -> "MultipleChoiceExercisePublic":
        return MultipleChoiceExercisePublic(
            type=self.type, id=self.id, prompt=self.prompt, options=self.options, hint=self.hint
        )


# Exercise types below are in the schema so that adding a renderer later is not a schema
# change. Phase 1 has no renderer and no assessor for them (see `assessment.py`).


PlainText = Annotated[str, StringConstraints(min_length=1, max_length=5_000)]
AcceptedAnswers = Annotated[
    list[Annotated[str, StringConstraints(min_length=1, max_length=500)]],
    Field(min_length=1, max_length=20),
]


class TextSpan(_Model):
    """Characters `start` (inclusive) to `end` (exclusive) of a text, counted in code points."""

    start: Annotated[int, Field(ge=0)]
    end: Annotated[int, Field(gt=0)]

    @model_validator(mode="after")
    def _is_not_empty(self) -> Self:
        if self.end <= self.start:
            raise ValueError("a span must end after it starts")
        return self


class SpanHighlightExercise(_Model):
    type: Literal["span_highlight"]
    id: Identifier
    prompt: Markdown
    text: PlainText
    correct_spans: Annotated[list[TextSpan], Field(min_length=1, max_length=100)]
    hint: Markdown | None = None

    @model_validator(mode="after")
    def _spans_fit_the_text(self) -> Self:
        spans = sorted(self.correct_spans, key=lambda span: span.start)
        if spans[-1].end > len(self.text):
            raise ValueError("correct_spans must lie inside the text")
        if any(left.end > right.start for left, right in zip(spans, spans[1:], strict=False)):
            raise ValueError("correct_spans must not overlap")
        return self

    def public(self) -> "SpanHighlightExercisePublic":
        return SpanHighlightExercisePublic(
            type=self.type, id=self.id, prompt=self.prompt, text=self.text, hint=self.hint
        )


class GivenCell(_Model):
    kind: Literal["given"]
    text: Annotated[str, StringConstraints(max_length=500)]


class BlankCell(_Model):
    kind: Literal["blank"]
    id: Identifier
    accepted_answers: AcceptedAnswers


TableCell = Annotated[GivenCell | BlankCell, Field(discriminator="kind")]


class TableFillExercise(_Model):
    type: Literal["table_fill"]
    id: Identifier
    prompt: Markdown
    columns: Annotated[
        list[Annotated[str, StringConstraints(max_length=200)]],
        Field(min_length=1, max_length=8),
    ]
    rows: Annotated[list[list[TableCell]], Field(min_length=1, max_length=50)]
    hint: Markdown | None = None

    @model_validator(mode="after")
    def _table_is_rectangular_with_unique_blanks(self) -> Self:
        if any(len(row) != len(self.columns) for row in self.rows):
            raise ValueError("every row must have one cell per column")
        blanks = [cell.id for row in self.rows for cell in row if isinstance(cell, BlankCell)]
        if not blanks:
            raise ValueError("a table fill needs at least one blank")
        if len(set(blanks)) != len(blanks):
            raise ValueError("blank ids must be unique within the table")
        return self

    def public(self) -> "TableFillExercisePublic":
        return TableFillExercisePublic(
            type=self.type,
            id=self.id,
            prompt=self.prompt,
            columns=self.columns,
            rows=[
                [
                    cell
                    if isinstance(cell, GivenCell)
                    else BlankCellPublic(kind="blank", id=cell.id)
                    for cell in row
                ]
                for row in self.rows
            ],
            hint=self.hint,
        )


class NumericExercise(_Model):
    type: Literal["numeric"]
    id: Identifier
    prompt: Markdown
    correct_value: Annotated[float, Field(allow_inf_nan=False)]
    tolerance: Annotated[
        float,
        Field(
            ge=0,
            allow_inf_nan=False,
            description="Largest accepted absolute difference from the value.",
        ),
    ] = 0
    unit: Annotated[str, StringConstraints(min_length=1, max_length=40)] | None = None
    hint: Markdown | None = None

    def public(self) -> "NumericExercisePublic":
        return NumericExercisePublic(
            type=self.type, id=self.id, prompt=self.prompt, unit=self.unit, hint=self.hint
        )


class AttachmentReference(_Model):
    """A file stored with the course (attachment storage arrives in slice 3)."""

    attachment_id: Identifier


class ListeningExercise(_Model):
    type: Literal["listening"]
    id: Identifier
    prompt: Markdown
    audio: AttachmentReference
    transcript: PlainText | None = None
    accepted_answers: AcceptedAnswers
    hint: Markdown | None = None

    def public(self) -> "ListeningExercisePublic":
        return ListeningExercisePublic(
            type=self.type, id=self.id, prompt=self.prompt, audio=self.audio, hint=self.hint
        )


CustomAssessmentMode = Annotated[
    Literal["self_assessed_advisory", "teacher_assessed"],
    Field(
        description=(
            "self_assessed_advisory: the frame reports a self-assessment the teacher confirms. "
            "teacher_assessed: the teacher assesses the answer."
        )
    ),
]


class CustomExercise(_Model):
    """Assistant-written HTML run in a sandbox with a fixed result contract (ADR 0006)."""

    type: Literal["custom"]
    id: Identifier
    prompt: Markdown | None = None
    html: Annotated[str, StringConstraints(min_length=1, max_length=200_000)]
    specification: PlainText
    example: PlainText
    assessment_mode: CustomAssessmentMode

    def public(self) -> "CustomExercisePublic":
        return CustomExercisePublic(type=self.type, id=self.id, prompt=self.prompt, html=self.html)


Exercise = (
    MultipleChoiceExercise
    | SpanHighlightExercise
    | TableFillExercise
    | NumericExercise
    | ListeningExercise
    | CustomExercise
)
LessonBlock = Annotated[ExplanationBlock | Exercise, Field(discriminator="type")]


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


# What reaches the browser: every exercise without its answer key.


class MultipleChoiceExercisePublic(_Model):
    type: Literal["multiple_choice"]
    id: Identifier
    prompt: Markdown
    options: list[ChoiceOption]
    hint: Markdown | None


class SpanHighlightExercisePublic(_Model):
    type: Literal["span_highlight"]
    id: Identifier
    prompt: Markdown
    text: PlainText
    hint: Markdown | None


class BlankCellPublic(_Model):
    kind: Literal["blank"]
    id: Identifier


TableCellPublic = Annotated[GivenCell | BlankCellPublic, Field(discriminator="kind")]


class TableFillExercisePublic(_Model):
    type: Literal["table_fill"]
    id: Identifier
    prompt: Markdown
    columns: list[str]
    rows: list[list[TableCellPublic]]
    hint: Markdown | None


class NumericExercisePublic(_Model):
    type: Literal["numeric"]
    id: Identifier
    prompt: Markdown
    unit: str | None
    hint: Markdown | None


class ListeningExercisePublic(_Model):
    type: Literal["listening"]
    id: Identifier
    prompt: Markdown
    audio: AttachmentReference
    hint: Markdown | None


class CustomExercisePublic(_Model):
    type: Literal["custom"]
    id: Identifier
    prompt: Markdown | None
    html: str


ExercisePublic = (
    MultipleChoiceExercisePublic
    | SpanHighlightExercisePublic
    | TableFillExercisePublic
    | NumericExercisePublic
    | ListeningExercisePublic
    | CustomExercisePublic
)
LessonBlockPublic = Annotated[ExplanationBlock | ExercisePublic, Field(discriminator="type")]


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


class SpanHighlightAnswer(_Model):
    type: Literal["span_highlight"]
    spans: Annotated[list[TextSpan], Field(max_length=100)]


class TableFillAnswer(_Model):
    type: Literal["table_fill"]
    cells: Annotated[
        dict[Identifier, Annotated[str, StringConstraints(max_length=500)]],
        Field(max_length=400, description="Answers keyed by blank id."),
    ]


class NumericAnswer(_Model):
    type: Literal["numeric"]
    value: Annotated[float, Field(allow_inf_nan=False)]


class ListeningAnswer(_Model):
    type: Literal["listening"]
    text: Annotated[str, StringConstraints(max_length=2_000)]


def _limit_custom_answer_size(value: JsonValue) -> JsonValue:
    if len(json.dumps(value, ensure_ascii=False)) > 20_000:
        raise ValueError("a custom exercise answer must stay under 20000 characters of JSON")
    return value


class CustomAnswer(_Model):
    """Opaque JSON from a custom exercise frame, validated only for size."""

    type: Literal["custom"]
    value: Annotated[JsonValue, AfterValidator(_limit_custom_answer_size)]


ExerciseAnswer = Annotated[
    MultipleChoiceAnswer
    | SpanHighlightAnswer
    | TableFillAnswer
    | NumericAnswer
    | ListeningAnswer
    | CustomAnswer,
    Field(discriminator="type"),
]


class MultipleChoiceSolution(_Model):
    type: Literal["multiple_choice"]
    option_id: Identifier
    explanation: Markdown | None


ExerciseSolution = MultipleChoiceSolution


class AssessmentResult(_Model):
    status: Literal["assessed"]
    exercise_id: Identifier
    score: Annotated[float, Field(ge=0, le=1)]
    correct: bool
    solution: Annotated[
        ExerciseSolution | None,
        Field(description="Withheld (null) for a wrong answer the student may still retry."),
    ]


class AssessmentUnavailable(_Model):
    """The answer fits the exercise, but its type has no assessor in this phase."""

    status: Literal["unavailable"]
    exercise_id: Identifier
    reason: Literal["no_assessor_in_this_phase"]


AssessmentOutcome = Annotated[
    AssessmentResult | AssessmentUnavailable, Field(discriminator="status")
]


class AnswerKeyEntry(_Model):
    exercise_id: Identifier
    solution: Annotated[
        ExerciseSolution | None,
        Field(description="Null for a type without an assessor in this phase."),
    ]


class AnswerKey(_Model):
    """The canonical solution of every exercise in lesson order, for a printed answer key."""

    lesson_id: Identifier
    entries: list[AnswerKeyEntry]


class SecondRoundRequest(_Model):
    failed_exercise_ids: list[Identifier]
    seed: Annotated[str, StringConstraints(min_length=1, max_length=200)]


class SecondRound(_Model):
    """Varied repeats of the failed exercises, in lesson order; empty when nothing failed."""

    exercises: list[ExercisePublic]


def exercise_to_public(exercise: Exercise) -> ExercisePublic:
    return exercise.public()


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
