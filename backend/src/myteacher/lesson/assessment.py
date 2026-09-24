"""Deterministic assessment of closed exercise types: a pure function of definition and answer."""

from myteacher.lesson.schema import (
    AnswerKey,
    AnswerKeyEntry,
    AssessmentOutcome,
    AssessmentResult,
    AssessmentUnavailable,
    Exercise,
    ExerciseAnswer,
    ExerciseSolution,
    LessonDocument,
    MultipleChoiceAnswer,
    MultipleChoiceExercise,
    MultipleChoiceSolution,
)


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


def solution_of(exercise: Exercise) -> ExerciseSolution | None:
    """The canonical solution, or None for a type without an assessor in this phase."""
    match exercise:
        case MultipleChoiceExercise():
            return MultipleChoiceSolution(
                type="multiple_choice",
                option_id=exercise.correct_option_id,
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
