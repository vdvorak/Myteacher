"""Lesson document models: the single source of truth for the lesson shape.

JSON Schema and the frontend's TypeScript types are generated from these models
(see `myteacher.lesson.export`). Models ending in `Public` are what reaches the
browser; they never carry an answer key.
"""

import json
import re
import unicodedata
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


class PassageBlock(_Model):
    """A text that the exercises after it may reference, such as a reading passage."""

    type: Literal["passage"]
    id: Identifier
    title: Annotated[str, StringConstraints(min_length=1, max_length=200)] | None = None
    markdown: Markdown


class PaperOnlyBlock(_Model):
    """A paper-only exercise of classroom material transcribed from paper, which no exercise type
    represents, such as drawing a graph: printed with space to answer, neither done nor assessed
    in the app."""

    type: Literal["paper_only"]
    id: Identifier
    prompt: Markdown
    answer_lines: Annotated[
        int, Field(ge=0, le=40, description="Lines of space to answer in when printed.")
    ] = 3


class _Exercise(_Model):
    passage_id: Annotated[
        Identifier | None,
        Field(description="The passage block, earlier in the lesson, this exercise is about."),
    ] = None


class _ExercisePublic(_Model):
    passage_id: Identifier | None = None


class ChoiceOption(_Model):
    id: Identifier
    text: Annotated[str, StringConstraints(min_length=1, max_length=500)]


class MultipleChoiceExercise(_Exercise):
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


PlainText = Annotated[str, StringConstraints(min_length=1, max_length=5_000)]
AcceptedAnswers = Annotated[
    list[Annotated[str, StringConstraints(min_length=1, max_length=500)]],
    Field(min_length=1, max_length=20),
]


class ToleranceRules(_Model):
    """How strictly a typed answer is compared with the accepted answers."""

    ignore_case: bool = True
    normalise_whitespace: Annotated[
        bool, Field(description="Collapse runs of whitespace; leading and trailing never count.")
    ] = True
    ignore_diacritics: Annotated[
        bool,
        Field(
            description=(
                "Accents do not count, except marks that make a letter of its own in the "
                "lesson's language: ñ in Spanish, háček and kroužek in Czech."
            )
        ),
    ] = False
    ignore_punctuation: Annotated[
        bool, Field(description="Punctuation, including ¿ and ¡, does not count.")
    ] = False


class ShortAnswerExercise(_Exercise):
    type: Literal["short_answer"]
    id: Identifier
    prompt: Markdown
    accepted_answers: Annotated[
        AcceptedAnswers, Field(description="The first is the canonical answer shown as solution.")
    ]
    tolerance: ToleranceRules = ToleranceRules()
    hint: Markdown | None = None
    show_hint: Annotated[
        bool, Field(description="Show the hint before the first try (used by the second round).")
    ] = False
    solution_explanation: Markdown | None = None

    def public(self) -> "ShortAnswerExercisePublic":
        return ShortAnswerExercisePublic(
            type=self.type,
            id=self.id,
            prompt=self.prompt,
            hint=self.hint,
            show_hint=self.show_hint and self.hint is not None,
        )


def _slug(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text.casefold())
    letters = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", letters).strip("-")


def _id_gives_away(identifier: str, answers: list[str]) -> bool:
    """Whether an id spells out one of the answers: whole, as a part, or (from 3 letters) inside."""
    parts = {part for part in re.split(r"[-0-9]+", identifier) if part}
    for answer in answers:
        slug = _slug(answer)
        if slug and (
            slug == identifier or slug in parts or (len(slug) >= 3 and slug in identifier)
        ):
            return True
    return False


class ClozeText(_Model):
    kind: Literal["text"]
    text: Annotated[str, StringConstraints(min_length=1, max_length=2_000)]


class ClozeCandidate(_Model):
    """A word that may be blanked; `blanked` on the exercise says which are gaps now."""

    kind: Literal["candidate"]
    id: Annotated[
        Identifier, Field(description="Reaches the browser as the gap id: must not be the answer.")
    ]
    answer: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    alternatives: list[Annotated[str, StringConstraints(min_length=1, max_length=200)]] = []


ClozeSegment = Annotated[ClozeText | ClozeCandidate, Field(discriminator="kind")]


class WordBank(_Model):
    distractors: Annotated[
        list[Annotated[str, StringConstraints(min_length=1, max_length=200)]],
        Field(max_length=20),
    ] = []


class ClozeExercise(_Exercise):
    type: Literal["cloze"]
    id: Identifier
    prompt: Markdown
    segments: Annotated[list[ClozeSegment], Field(min_length=1, max_length=200)]
    blanked: Annotated[list[Identifier], Field(min_length=1, max_length=50)]
    word_bank: WordBank | None = None
    tolerance: ToleranceRules = ToleranceRules()
    hint: Markdown | None = None
    solution_explanation: Markdown | None = None

    @model_validator(mode="after")
    def _blanks_are_candidates(self) -> Self:
        ids = [candidate.id for candidate in self.candidates()]
        if len(set(ids)) != len(ids):
            raise ValueError("candidate ids must be unique")
        if len(set(self.blanked)) != len(self.blanked):
            raise ValueError("blanked must not repeat a candidate")
        if not set(self.blanked) <= set(ids):
            raise ValueError("blanked must name candidates of the text")
        for candidate in self.candidates():
            if _id_gives_away(candidate.id, [candidate.answer, *candidate.alternatives]):
                raise ValueError(
                    f"candidate id {candidate.id!r} gives its answer away (gap ids are public)"
                )
        return self

    def candidates(self) -> list[ClozeCandidate]:
        return [segment for segment in self.segments if isinstance(segment, ClozeCandidate)]

    def gaps(self) -> list[ClozeCandidate]:
        """The blanked candidates, in text order."""
        blanked = set(self.blanked)
        return [candidate for candidate in self.candidates() if candidate.id in blanked]

    def public(self) -> "ClozeExercisePublic":
        blanked = set(self.blanked)
        segments: list[ClozeText | ClozeGapPublic] = [
            ClozeText(kind="text", text=segment.text)
            if isinstance(segment, ClozeText)
            else ClozeGapPublic(kind="gap", id=segment.id)
            if segment.id in blanked
            else ClozeText(kind="text", text=segment.answer)
            for segment in self.segments
        ]
        bank = (
            # Sorted, so that the bank's order says nothing about the gaps' order.
            sorted([gap.answer for gap in self.gaps()] + self.word_bank.distractors)
            if self.word_bank is not None
            else None
        )
        return ClozeExercisePublic(
            type=self.type,
            id=self.id,
            prompt=self.prompt,
            segments=segments,
            word_bank=bank,
            hint=self.hint,
        )


ItemText = Annotated[str, StringConstraints(min_length=1, max_length=300)]


def _public_ids(texts: list[str], prefix: str) -> list[str]:
    """Ids by alphabetical rank of the texts, so that they carry no trace of the answer."""
    ranked = sorted(range(len(texts)), key=lambda i: (texts[i].casefold(), texts[i], i))
    ids = [""] * len(texts)
    for rank, index in enumerate(ranked):
        ids[index] = f"{prefix}{rank + 1}"
    return ids


class MatchItem(_Model):
    id: Identifier
    text: str


class MatchingPair(_Model):
    id: Identifier
    left: ItemText
    right: ItemText


class MatchingExercise(_Exercise):
    type: Literal["matching"]
    id: Identifier
    prompt: Markdown
    pairs: Annotated[list[MatchingPair], Field(min_length=2, max_length=10)]
    partial_credit: Annotated[
        bool, Field(description="Score the share of right pairs instead of all or nothing.")
    ] = False
    hint: Markdown | None = None
    solution_explanation: Markdown | None = None

    @model_validator(mode="after")
    def _items_are_unique(self) -> Self:
        for name, values in [
            ("pair ids", [pair.id for pair in self.pairs]),
            ("left items", [pair.left.casefold() for pair in self.pairs]),
            ("right items", [pair.right.casefold() for pair in self.pairs]),
        ]:
            if len(set(values)) != len(values):
                raise ValueError(f"{name} must be unique")
        return self

    def right_ids(self) -> dict[str, str]:
        """The public id of each pair's right item, by pair id."""
        ids = _public_ids([pair.right for pair in self.pairs], "r")
        return {pair.id: right for pair, right in zip(self.pairs, ids, strict=True)}

    def public(self) -> "MatchingExercisePublic":
        rights = self.right_ids()
        return MatchingExercisePublic(
            type=self.type,
            id=self.id,
            prompt=self.prompt,
            left=[MatchItem(id=pair.id, text=pair.left) for pair in self.pairs],
            right=sorted(
                (MatchItem(id=rights[pair.id], text=pair.right) for pair in self.pairs),
                key=lambda item: int(item.id[1:]),
            ),
            hint=self.hint,
        )


class OrderToken(_Model):
    id: Identifier
    text: ItemText


class TokenOrderingExercise(_Exercise):
    type: Literal["token_ordering"]
    id: Identifier
    prompt: Markdown
    tokens: Annotated[list[OrderToken], Field(min_length=2, max_length=30)]
    accepted_orders: Annotated[
        list[list[Identifier]],
        Field(min_length=1, max_length=10, description="Each lists every token id once."),
    ]
    partial_credit: Annotated[
        bool, Field(description="Score the share of tokens in place instead of all or nothing.")
    ] = False
    hint: Markdown | None = None
    solution_explanation: Markdown | None = None

    @model_validator(mode="after")
    def _orders_use_every_token_once(self) -> Self:
        ids = [token.id for token in self.tokens]
        if len(set(ids)) != len(ids):
            raise ValueError("token ids must be unique")
        if any(sorted(order) != sorted(ids) for order in self.accepted_orders):
            raise ValueError("every accepted order must list every token id exactly once")
        return self

    def public_ids(self) -> dict[str, str]:
        ids = _public_ids([token.text for token in self.tokens], "t")
        return {token.id: public for token, public in zip(self.tokens, ids, strict=True)}

    def accepted_texts(self) -> list[list[str]]:
        text = {token.id: token.text for token in self.tokens}
        return [[text[token_id] for token_id in order] for order in self.accepted_orders]

    def public(self) -> "TokenOrderingExercisePublic":
        ids = self.public_ids()
        return TokenOrderingExercisePublic(
            type=self.type,
            id=self.id,
            prompt=self.prompt,
            tokens=sorted(
                (MatchItem(id=ids[token.id], text=token.text) for token in self.tokens),
                key=lambda item: int(item.id[1:]),
            ),
            hint=self.hint,
        )


Granularity = Literal["letter", "syllable", "word"]


class SelectionToken(_Model):
    text: str
    space_after: Annotated[bool, Field(description="Whether whitespace follows in the text.")]


def _lay_out(text: str, tokens: list[str]) -> list[SelectionToken]:
    """Place tokens along the text, which they must spell out apart from whitespace."""
    laid: list[SelectionToken] = []
    position = 0
    for token in tokens:
        while position < len(text) and text[position].isspace():
            position += 1
        if not token or not text.startswith(token, position):
            raise ValueError("tokens must spell out the text in order, apart from whitespace")
        position += len(token)
        laid.append(
            SelectionToken(
                text=token, space_after=position < len(text) and text[position].isspace()
            )
        )
    if text[position:].strip():
        raise ValueError("tokens must cover the whole text")
    return laid


class SelectionItem(_Model):
    """One text of the item set, with the tokens the student should select."""

    id: Identifier
    text: Annotated[str, StringConstraints(min_length=1, max_length=1_000)]
    tokens: Annotated[
        list[Annotated[str, StringConstraints(min_length=1, max_length=100)]] | None,
        Field(description="Explicit boundaries; required for syllables, derived otherwise."),
    ] = None
    expected: Annotated[
        list[Annotated[int, Field(ge=0)]],
        Field(min_length=1, description="Indices of the tokens to select."),
    ]

    def token_texts(self, granularity: str) -> list[str]:
        if self.tokens is not None:
            return self.tokens
        if granularity == "word":
            return self.text.split()
        return [char for char in unicodedata.normalize("NFC", self.text) if not char.isspace()]

    def laid_out(self, granularity: str) -> list[SelectionToken]:
        text = self.text if self.tokens is not None else unicodedata.normalize("NFC", self.text)
        return _lay_out(text, self.token_texts(granularity))


class TokenSelectionExercise(_Exercise):
    type: Literal["token_selection"]
    id: Identifier
    prompt: Markdown
    granularity: Granularity
    items: Annotated[
        list[SelectionItem],
        Field(
            min_length=1, max_length=20, description="The item set; the second round asks another."
        ),
    ]
    active_item: Annotated[
        Identifier | None, Field(description="The item asked now; the first when not set.")
    ] = None
    max_selections: Annotated[int, Field(ge=1)] | None = None
    partial_credit: Annotated[
        bool, Field(description="Score the overlap of the selected and expected sets.")
    ] = False
    hint: Markdown | None = None
    solution_explanation: Markdown | None = None

    @model_validator(mode="after")
    def _items_are_consistent(self) -> Self:
        ids = [item.id for item in self.items]
        if len(set(ids)) != len(ids):
            raise ValueError("item ids must be unique")
        if self.active_item is not None and self.active_item not in ids:
            raise ValueError("active_item must name one of the items")
        for item in self.items:
            if self.granularity == "syllable" and item.tokens is None:
                raise ValueError(f"item {item.id!r}: syllables need explicit token boundaries")
            count = len(item.laid_out(self.granularity))
            if len(set(item.expected)) != len(item.expected) or max(item.expected) >= count:
                raise ValueError(f"item {item.id!r}: expected must name distinct tokens")
            if self.max_selections is not None and len(item.expected) > self.max_selections:
                raise ValueError(f"item {item.id!r}: max_selections leaves no room for expected")
        return self

    def item(self, item_id: str | None = None) -> SelectionItem | None:
        wanted = item_id or self.active_item or self.items[0].id
        return next((item for item in self.items if item.id == wanted), None)

    def public(self) -> "TokenSelectionExercisePublic":
        item = self.item()
        assert item is not None
        return TokenSelectionExercisePublic(
            type=self.type,
            id=self.id,
            prompt=self.prompt,
            granularity=self.granularity,
            item_id=item.id,
            tokens=item.laid_out(self.granularity),
            max_selections=self.max_selections,
            hint=self.hint,
        )


class RubricCriterion(_Model):
    id: Identifier
    description: PlainText
    points: Annotated[int, Field(ge=1, le=10)] = 1


class Rubric(_Model):
    """The criteria an open answer is assessed against, approved by the teacher."""

    criteria: Annotated[list[RubricCriterion], Field(min_length=1, max_length=10)]

    @model_validator(mode="after")
    def _criterion_ids_are_unique(self) -> Self:
        ids = [criterion.id for criterion in self.criteria]
        if len(set(ids)) != len(ids):
            raise ValueError("rubric criterion ids must be unique")
        return self


MaxCharacters = Annotated[int, Field(ge=1, le=5_000)]


class _OpenExercise(_Exercise):
    rubric: Rubric
    min_characters: Annotated[int, Field(ge=0, le=5_000)] = 0
    max_characters: MaxCharacters = 1_000
    hint: Markdown | None = None

    @model_validator(mode="after")
    def _limits_are_consistent(self) -> Self:
        if self.min_characters > self.max_characters:
            raise ValueError("min_characters must not exceed max_characters")
        return self


class FreeTextExercise(_OpenExercise):
    type: Literal["free_text"]
    id: Identifier
    prompt: Markdown

    def public(self) -> "FreeTextExercisePublic":
        return FreeTextExercisePublic(
            type=self.type,
            id=self.id,
            prompt=self.prompt,
            min_characters=self.min_characters,
            max_characters=self.max_characters,
            hint=self.hint,
        )


class TranslationExercise(_OpenExercise):
    type: Literal["translation"]
    id: Identifier
    prompt: Markdown | None = None
    source_text: PlainText
    source_language: LanguageTag
    target_language: LanguageTag
    model_answer: Annotated[
        PlainText | None, Field(description="A reference translation for the teacher.")
    ] = None

    @model_validator(mode="after")
    def _translates_between_two_languages(self) -> Self:
        if self.source_language == self.target_language:
            raise ValueError("a translation needs different source and target languages")
        return self

    def public(self) -> "TranslationExercisePublic":
        return TranslationExercisePublic(
            type=self.type,
            id=self.id,
            prompt=self.prompt,
            source_text=self.source_text,
            source_language=self.source_language,
            target_language=self.target_language,
            min_characters=self.min_characters,
            max_characters=self.max_characters,
            hint=self.hint,
        )


OpenExercise = FreeTextExercise | TranslationExercise


# Exercise types below are in the schema so that adding a renderer later is not a schema
# change. Phase 1 has no renderer and no assessor for them (see `assessment.py`).


class TextSpan(_Model):
    """Characters `start` (inclusive) to `end` (exclusive) of a text, counted in code points."""

    start: Annotated[int, Field(ge=0)]
    end: Annotated[int, Field(gt=0)]

    @model_validator(mode="after")
    def _is_not_empty(self) -> Self:
        if self.end <= self.start:
            raise ValueError("a span must end after it starts")
        return self


class SpanHighlightExercise(_Exercise):
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


class TableFillExercise(_Exercise):
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


class NumericExercise(_Exercise):
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


class ListeningExercise(_Exercise):
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


class CustomExercise(_Exercise):
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
    | ShortAnswerExercise
    | ClozeExercise
    | MatchingExercise
    | TokenOrderingExercise
    | TokenSelectionExercise
    | FreeTextExercise
    | TranslationExercise
    | SpanHighlightExercise
    | TableFillExercise
    | NumericExercise
    | ListeningExercise
    | CustomExercise
)
# The blocks that are not exercises: nothing is answered or assessed in them.
NotExercise = ExplanationBlock | PassageBlock | PaperOnlyBlock
LessonBlock = Annotated[NotExercise | Exercise, Field(discriminator="type")]


class LessonDocument(_Model):
    """A lesson as stored and authored: canonical, unshuffled, with its answer key."""

    id: Identifier
    title: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    language: LanguageTag
    feedback_mode: FeedbackMode
    blocks: Annotated[list[LessonBlock], Field(min_length=1)]

    @model_validator(mode="after")
    def _ids_are_unique_and_references_resolve(self) -> Self:
        ids = [block.id for block in self.blocks if not isinstance(block, ExplanationBlock)]
        if len(set(ids)) != len(ids):
            raise ValueError("exercise and passage ids must be unique within a lesson")
        passages_so_far: set[str] = set()
        for block in self.blocks:
            if isinstance(block, PassageBlock):
                passages_so_far.add(block.id)
            elif (
                not isinstance(block, ExplanationBlock | PaperOnlyBlock)
                and block.passage_id is not None
            ):
                if block.passage_id not in passages_so_far:
                    raise ValueError(
                        f"exercise {block.id!r} references passage {block.passage_id!r}, "
                        "which is not a passage block earlier in the lesson"
                    )
        return self

    def exercises(self) -> list[Exercise]:
        return [block for block in self.blocks if not isinstance(block, NotExercise)]

    def exercise(self, exercise_id: str) -> Exercise | None:
        return next((block for block in self.exercises() if block.id == exercise_id), None)


# What reaches the browser: every exercise without its answer key.


class MultipleChoiceExercisePublic(_ExercisePublic):
    type: Literal["multiple_choice"]
    id: Identifier
    prompt: Markdown
    options: list[ChoiceOption]
    hint: Markdown | None


class ShortAnswerExercisePublic(_ExercisePublic):
    type: Literal["short_answer"]
    id: Identifier
    prompt: Markdown
    hint: Markdown | None
    show_hint: bool


class ClozeGapPublic(_Model):
    kind: Literal["gap"]
    id: Identifier


ClozeSegmentPublic = Annotated[ClozeText | ClozeGapPublic, Field(discriminator="kind")]


class ClozeExercisePublic(_ExercisePublic):
    type: Literal["cloze"]
    id: Identifier
    prompt: Markdown
    segments: list[ClozeSegmentPublic]
    word_bank: Annotated[
        list[str] | None,
        Field(description="Words to place into the gaps, or null when the student types."),
    ]
    hint: Markdown | None


class MatchingExercisePublic(_ExercisePublic):
    type: Literal["matching"]
    id: Identifier
    prompt: Markdown
    left: list[MatchItem]
    right: Annotated[list[MatchItem], Field(description="In alphabetical order, not paired.")]
    hint: Markdown | None


class TokenOrderingExercisePublic(_ExercisePublic):
    type: Literal["token_ordering"]
    id: Identifier
    prompt: Markdown
    tokens: Annotated[list[MatchItem], Field(description="In alphabetical order.")]
    hint: Markdown | None


class TokenSelectionExercisePublic(_ExercisePublic):
    type: Literal["token_selection"]
    id: Identifier
    prompt: Markdown
    granularity: Granularity
    item_id: Identifier
    tokens: list[SelectionToken]
    max_selections: int | None
    hint: Markdown | None


class FreeTextExercisePublic(_ExercisePublic):
    type: Literal["free_text"]
    id: Identifier
    prompt: Markdown
    min_characters: int
    max_characters: int
    hint: Markdown | None


class TranslationExercisePublic(_ExercisePublic):
    type: Literal["translation"]
    id: Identifier
    prompt: Markdown | None
    source_text: str
    source_language: LanguageTag
    target_language: LanguageTag
    min_characters: int
    max_characters: int
    hint: Markdown | None


class SpanHighlightExercisePublic(_ExercisePublic):
    type: Literal["span_highlight"]
    id: Identifier
    prompt: Markdown
    text: PlainText
    hint: Markdown | None


class BlankCellPublic(_Model):
    kind: Literal["blank"]
    id: Identifier


TableCellPublic = Annotated[GivenCell | BlankCellPublic, Field(discriminator="kind")]


class TableFillExercisePublic(_ExercisePublic):
    type: Literal["table_fill"]
    id: Identifier
    prompt: Markdown
    columns: list[str]
    rows: list[list[TableCellPublic]]
    hint: Markdown | None


class NumericExercisePublic(_ExercisePublic):
    type: Literal["numeric"]
    id: Identifier
    prompt: Markdown
    unit: str | None
    hint: Markdown | None


class ListeningExercisePublic(_ExercisePublic):
    type: Literal["listening"]
    id: Identifier
    prompt: Markdown
    audio: AttachmentReference
    hint: Markdown | None


class CustomExercisePublic(_ExercisePublic):
    type: Literal["custom"]
    id: Identifier
    prompt: Markdown | None
    html: str


ExercisePublic = (
    MultipleChoiceExercisePublic
    | ShortAnswerExercisePublic
    | ClozeExercisePublic
    | MatchingExercisePublic
    | TokenOrderingExercisePublic
    | TokenSelectionExercisePublic
    | FreeTextExercisePublic
    | TranslationExercisePublic
    | SpanHighlightExercisePublic
    | TableFillExercisePublic
    | NumericExercisePublic
    | ListeningExercisePublic
    | CustomExercisePublic
)
LessonBlockPublic = Annotated[NotExercise | ExercisePublic, Field(discriminator="type")]


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


class ShortAnswerAnswer(_Model):
    type: Literal["short_answer"]
    text: Annotated[str, StringConstraints(max_length=500)]


class ClozeAnswer(_Model):
    type: Literal["cloze"]
    gaps: Annotated[
        dict[Identifier, Annotated[str, StringConstraints(max_length=200)]],
        Field(min_length=1, max_length=50, description="The typed or placed word per gap id."),
    ]


class MatchingAnswer(_Model):
    type: Literal["matching"]
    pairs: Annotated[
        dict[Identifier, Identifier],
        Field(max_length=10, description="The right item id chosen for each left item id."),
    ]


class TokenOrderingAnswer(_Model):
    type: Literal["token_ordering"]
    order: Annotated[list[Identifier], Field(max_length=30)]


class TokenSelectionAnswer(_Model):
    type: Literal["token_selection"]
    item_id: Identifier
    selected: Annotated[list[int], Field(max_length=200, description="Selected token indices.")]


class FreeTextAnswer(_Model):
    type: Literal["free_text"]
    text: Annotated[str, StringConstraints(max_length=5_000)]


class TranslationAnswer(_Model):
    type: Literal["translation"]
    text: Annotated[str, StringConstraints(max_length=5_000)]


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
    | ShortAnswerAnswer
    | ClozeAnswer
    | MatchingAnswer
    | TokenOrderingAnswer
    | TokenSelectionAnswer
    | FreeTextAnswer
    | TranslationAnswer
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


class ShortAnswerSolution(_Model):
    type: Literal["short_answer"]
    answer: str
    explanation: Markdown | None


class ClozeGapSolution(_Model):
    id: Identifier
    answer: str


class ClozeSolution(_Model):
    type: Literal["cloze"]
    gaps: list[ClozeGapSolution]
    explanation: Markdown | None


class MatchedPair(_Model):
    left_id: Identifier
    right_id: Identifier


class MatchingSolution(_Model):
    type: Literal["matching"]
    pairs: list[MatchedPair]
    explanation: Markdown | None


class TokenOrderingSolution(_Model):
    type: Literal["token_ordering"]
    tokens: Annotated[list[str], Field(description="The token texts in the first accepted order.")]
    explanation: Markdown | None


class TokenSelectionSolution(_Model):
    type: Literal["token_selection"]
    item_id: Identifier
    selected: list[int]
    explanation: Markdown | None


ExerciseSolution = Annotated[
    TokenSelectionSolution
    | MultipleChoiceSolution
    | ShortAnswerSolution
    | ClozeSolution
    | MatchingSolution
    | TokenOrderingSolution,
    Field(discriminator="type"),
]


class ItemCorrectness(_Model):
    """Whether one part of an exercise was right: a cloze gap, a matched left item, or a token
    position (identified by the id of the token the student put there)."""

    id: Identifier
    correct: bool


class AssessmentResult(_Model):
    status: Literal["assessed"]
    exercise_id: Identifier
    score: Annotated[float, Field(ge=0, le=1)]
    correct: bool
    items: Annotated[
        list[ItemCorrectness],
        Field(description="Per-part correctness for exercises with parts; kept when withheld."),
    ] = []
    solution: Annotated[
        ExerciseSolution | None,
        Field(description="Withheld (null) for a wrong answer the student may still retry."),
    ]


class AssessmentUnavailable(_Model):
    """The answer fits the exercise, but its type has no assessor in this phase."""

    status: Literal["unavailable"]
    exercise_id: Identifier
    reason: Literal["no_assessor_in_this_phase"]


class AssessmentPending(_Model):
    """An open answer: assessed later against its rubric (by the assistant, then the teacher)."""

    status: Literal["pending"]
    exercise_id: Identifier
    reason: Literal["not_deterministically_assessable"]


AssessmentOutcome = Annotated[
    AssessmentResult | AssessmentPending | AssessmentUnavailable, Field(discriminator="status")
]


class AnswerKeyEntry(_Model):
    exercise_id: Identifier
    solution: Annotated[
        ExerciseSolution | None,
        Field(description="Null for open types and for types without an assessor in this phase."),
    ]
    rubric: Annotated[Rubric | None, Field(description="The rubric of an open exercise.")] = None
    model_answer: Annotated[str | None, Field(description="A translation's reference.")] = None


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
    return exercise.public().model_copy(update={"passage_id": exercise.passage_id})


def to_public(lesson: LessonDocument) -> LessonPublic:
    return LessonPublic(
        id=lesson.id,
        title=lesson.title,
        language=lesson.language,
        feedback_mode=lesson.feedback_mode,
        blocks=[
            block if isinstance(block, NotExercise) else exercise_to_public(block)
            for block in lesson.blocks
        ],
    )
