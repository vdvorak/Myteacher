"""Deterministic assessment of closed exercise types: a pure function of definition and answer."""

from myteacher.lesson.schema import (
    AnswerKey,
    AnswerKeyEntry,
    AssessmentOutcome,
    AssessmentPending,
    AssessmentResult,
    AssessmentUnavailable,
    ClozeAnswer,
    ClozeExercise,
    ClozeGapSolution,
    ClozeSolution,
    Exercise,
    ExerciseAnswer,
    ExerciseSolution,
    FreeTextAnswer,
    FreeTextExercise,
    ItemCorrectness,
    LessonDocument,
    MatchedPair,
    MatchingAnswer,
    MatchingExercise,
    MatchingSolution,
    MultipleChoiceAnswer,
    MultipleChoiceExercise,
    MultipleChoiceSolution,
    OpenExercise,
    SelectionItem,
    ShortAnswerAnswer,
    ShortAnswerExercise,
    ShortAnswerSolution,
    TokenOrderingAnswer,
    TokenOrderingExercise,
    TokenOrderingSolution,
    TokenSelectionAnswer,
    TokenSelectionExercise,
    TokenSelectionSolution,
    TranslationAnswer,
    TranslationExercise,
)
from myteacher.lesson.tolerance import matches


class AnswerMismatch(ValueError):
    """The answer does not fit the exercise it was given for."""


def assess(exercise: Exercise, answer: ExerciseAnswer, *, reveal: bool = True) -> AssessmentOutcome:
    """Score an answer. With `reveal=False` the solution of a wrong answer is withheld,
    so that a student who may still retry does not receive it."""
    if answer.type != exercise.type:
        raise AnswerMismatch(f"a {answer.type} answer cannot assess a {exercise.type} exercise")
    match exercise, answer:
        case (FreeTextExercise(), FreeTextAnswer()) | (TranslationExercise(), TranslationAnswer()):
            if len(answer.text) > exercise.max_characters:
                raise AnswerMismatch(
                    f"the answer is longer than {exercise.max_characters} characters"
                )
            if not answer.text.strip() or len(answer.text) < exercise.min_characters:
                raise AnswerMismatch(
                    f"the answer needs at least {max(exercise.min_characters, 1)} characters"
                )
            return AssessmentPending(
                status="pending", exercise_id=exercise.id, reason="not_deterministically_assessable"
            )
        case MultipleChoiceExercise(), MultipleChoiceAnswer():
            result = _assess_multiple_choice(exercise, answer)
        case ShortAnswerExercise(), ShortAnswerAnswer():
            result = _assess_short_answer(exercise, answer)
        case ClozeExercise(), ClozeAnswer():
            result = _assess_cloze(exercise, answer)
        case MatchingExercise(), MatchingAnswer():
            result = _assess_matching(exercise, answer)
        case TokenOrderingExercise(), TokenOrderingAnswer():
            result = _assess_token_ordering(exercise, answer)
        case TokenSelectionExercise(), TokenSelectionAnswer():
            result = _assess_token_selection(exercise, answer)
        case _:
            return AssessmentUnavailable(
                status="unavailable", exercise_id=exercise.id, reason="no_assessor_in_this_phase"
            )
    if not result.correct and not reveal:
        return result.model_copy(update={"solution": None})
    return result


def _assess_multiple_choice(
    exercise: MultipleChoiceExercise, answer: MultipleChoiceAnswer
) -> AssessmentResult:
    if answer.option_id not in {option.id for option in exercise.options}:
        raise AnswerMismatch(f"option {answer.option_id!r} is not an option of this exercise")
    correct = answer.option_id == exercise.correct_option_id
    return AssessmentResult(
        status="assessed",
        exercise_id=exercise.id,
        score=1.0 if correct else 0.0,
        correct=correct,
        solution=solution_of(exercise),
    )


def _assess_short_answer(
    exercise: ShortAnswerExercise, answer: ShortAnswerAnswer
) -> AssessmentResult:
    correct = matches(answer.text, exercise.accepted_answers, exercise.tolerance)
    return AssessmentResult(
        status="assessed",
        exercise_id=exercise.id,
        score=1.0 if correct else 0.0,
        correct=correct,
        solution=solution_of(exercise),
    )


def _assess_cloze(exercise: ClozeExercise, answer: ClozeAnswer) -> AssessmentResult:
    # Stateless for now: the answer names the gaps it fills, which may be a second-round
    # variant's gaps (always as many as the exercise blanks). Attempts (slice 4) will pin the
    # variant server-side, so that only its exact gaps are accepted.
    candidates = {candidate.id: candidate for candidate in exercise.candidates()}
    unknown = sorted(set(answer.gaps) - set(candidates))
    if unknown:
        raise AnswerMismatch(f"not gaps of this exercise: {', '.join(unknown)}")
    if len(answer.gaps) != len(exercise.blanked):
        raise AnswerMismatch(
            f"a cloze answer must fill all {len(exercise.blanked)} gaps, not {len(answer.gaps)}"
        )
    gaps = [candidate for candidate in exercise.candidates() if candidate.id in answer.gaps]
    items = [
        ItemCorrectness(
            id=gap.id,
            correct=matches(
                answer.gaps[gap.id], [gap.answer, *gap.alternatives], exercise.tolerance
            ),
        )
        for gap in gaps
    ]
    right = sum(item.correct for item in items)
    return AssessmentResult(
        status="assessed",
        exercise_id=exercise.id,
        score=right / len(items),
        correct=right == len(items),
        items=items,
        solution=ClozeSolution(
            type="cloze",
            gaps=[ClozeGapSolution(id=gap.id, answer=gap.answer) for gap in gaps],
            explanation=exercise.solution_explanation,
        ),
    )


def _scored(
    exercise: MatchingExercise | TokenOrderingExercise, items: list[ItemCorrectness]
) -> tuple[float, bool]:
    right = sum(item.correct for item in items)
    correct = right == len(items)
    if exercise.partial_credit:
        return right / len(items), correct
    return (1.0 if correct else 0.0), correct


def _assess_matching(exercise: MatchingExercise, answer: MatchingAnswer) -> AssessmentResult:
    rights = exercise.right_ids()
    if set(answer.pairs) != set(rights):
        raise AnswerMismatch("a matching answer must pair every left item")
    if sorted(answer.pairs.values()) != sorted(rights.values()):
        raise AnswerMismatch("a matching answer must use every right item exactly once")
    items = [
        ItemCorrectness(id=pair.id, correct=answer.pairs[pair.id] == rights[pair.id])
        for pair in exercise.pairs
    ]
    score, correct = _scored(exercise, items)
    return AssessmentResult(
        status="assessed",
        exercise_id=exercise.id,
        score=score,
        correct=correct,
        items=items,
        solution=solution_of(exercise),
    )


def _assess_token_ordering(
    exercise: TokenOrderingExercise, answer: TokenOrderingAnswer
) -> AssessmentResult:
    ids = exercise.public_ids()
    texts = {ids[token.id]: token.text for token in exercise.tokens}
    if sorted(answer.order) != sorted(texts):
        raise AnswerMismatch("an order must use every token exactly once")
    given = [texts[token_id] for token_id in answer.order]
    # Tokens with the same text are interchangeable, so orders are compared as texts; the
    # closest accepted order decides which positions count as right.
    closest = max(
        exercise.accepted_texts(),
        key=lambda order: sum(a == b for a, b in zip(given, order, strict=True)),
    )
    items = [
        ItemCorrectness(id=token_id, correct=text == expected)
        for token_id, text, expected in zip(answer.order, given, closest, strict=True)
    ]
    score, correct = _scored(exercise, items)
    return AssessmentResult(
        status="assessed",
        exercise_id=exercise.id,
        score=score,
        correct=correct,
        items=items,
        solution=solution_of(exercise),
    )


def _assess_token_selection(
    exercise: TokenSelectionExercise, answer: TokenSelectionAnswer
) -> AssessmentResult:
    # Stateless for now: the answer names its item, which may be a second-round item.
    item = exercise.item(answer.item_id)
    if item is None:
        raise AnswerMismatch(f"{answer.item_id!r} is not an item of this exercise")
    count = len(item.laid_out(exercise.granularity))
    selected = set(answer.selected)
    if len(selected) != len(answer.selected) or any(not 0 <= i < count for i in selected):
        raise AnswerMismatch("a selection must name distinct tokens of the item")
    if exercise.max_selections is not None and len(selected) > exercise.max_selections:
        raise AnswerMismatch(f"at most {exercise.max_selections} tokens may be selected")
    expected = set(item.expected)
    correct = selected == expected
    if correct:
        score = 1.0
    elif exercise.partial_credit:
        # Overlap of the sets, so selecting everything does not pay.
        score = len(selected & expected) / len(selected | expected)
    else:
        score = 0.0
    return AssessmentResult(
        status="assessed",
        exercise_id=exercise.id,
        score=score,
        correct=correct,
        # Only selected tokens are judged, so a withheld solution reveals no missed token.
        items=[ItemCorrectness(id=str(i), correct=i in expected) for i in sorted(selected)],
        solution=_selection_solution(exercise, item),
    )


def _selection_solution(
    exercise: TokenSelectionExercise, item: SelectionItem
) -> TokenSelectionSolution:
    return TokenSelectionSolution(
        type="token_selection",
        item_id=item.id,
        selected=sorted(item.expected),
        explanation=exercise.solution_explanation,
    )


def solution_of(exercise: Exercise) -> ExerciseSolution | None:
    """The canonical solution, or None for a type without an assessor in this phase."""
    match exercise:
        case MultipleChoiceExercise():
            return MultipleChoiceSolution(
                type="multiple_choice",
                option_id=exercise.correct_option_id,
                explanation=exercise.solution_explanation,
            )
        case ShortAnswerExercise():
            return ShortAnswerSolution(
                type="short_answer",
                answer=exercise.accepted_answers[0],
                explanation=exercise.solution_explanation,
            )
        case TokenSelectionExercise():
            return _selection_solution(exercise, exercise.item())
        case MatchingExercise():
            rights = exercise.right_ids()
            return MatchingSolution(
                type="matching",
                pairs=[MatchedPair(left_id=p.id, right_id=rights[p.id]) for p in exercise.pairs],
                explanation=exercise.solution_explanation,
            )
        case TokenOrderingExercise():
            return TokenOrderingSolution(
                type="token_ordering",
                tokens=exercise.accepted_texts()[0],
                explanation=exercise.solution_explanation,
            )
        case ClozeExercise():
            return ClozeSolution(
                type="cloze",
                gaps=[ClozeGapSolution(id=gap.id, answer=gap.answer) for gap in exercise.gaps()],
                explanation=exercise.solution_explanation,
            )
        case _:
            return None


def answer_key(lesson: LessonDocument) -> AnswerKey:
    return AnswerKey(
        lesson_id=lesson.id,
        entries=[
            AnswerKeyEntry(
                exercise_id=exercise.id,
                solution=solution_of(exercise),
                rubric=exercise.rubric if isinstance(exercise, OpenExercise) else None,
                model_answer=(
                    exercise.model_answer if isinstance(exercise, TranslationExercise) else None
                ),
            )
            for exercise in lesson.exercises()
        ],
    )
