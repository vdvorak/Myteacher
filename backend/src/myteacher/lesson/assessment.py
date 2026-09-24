"""Deterministic assessment of closed exercise types: a pure function of definition and answer."""

from myteacher.lesson.schema import (
    AnswerKey,
    AnswerKeyEntry,
    AssessmentOutcome,
    AssessmentResult,
    AssessmentUnavailable,
    ClozeAnswer,
    ClozeExercise,
    ClozeGapSolution,
    ClozeSolution,
    Exercise,
    ExerciseAnswer,
    ExerciseSolution,
    ItemCorrectness,
    LessonDocument,
    MultipleChoiceAnswer,
    MultipleChoiceExercise,
    MultipleChoiceSolution,
    ShortAnswerAnswer,
    ShortAnswerExercise,
    ShortAnswerSolution,
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
        case MultipleChoiceExercise(), MultipleChoiceAnswer():
            result = _assess_multiple_choice(exercise, answer)
        case ShortAnswerExercise(), ShortAnswerAnswer():
            result = _assess_short_answer(exercise, answer)
        case ClozeExercise(), ClozeAnswer():
            result = _assess_cloze(exercise, answer)
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
            AnswerKeyEntry(exercise_id=exercise.id, solution=solution_of(exercise))
            for exercise in lesson.exercises()
        ],
    )
