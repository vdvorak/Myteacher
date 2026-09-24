"""Deterministic assessment of closed exercise types: a pure function of definition and answer."""

from myteacher.lesson.schema import (
    AssessmentResult,
    Exercise,
    ExerciseAnswer,
    MultipleChoiceAnswer,
    MultipleChoiceExercise,
    MultipleChoiceSolution,
)


class AnswerMismatch(ValueError):
    """The answer does not fit the exercise it was given for."""


def assess(exercise: Exercise, answer: ExerciseAnswer) -> AssessmentResult:
    match exercise, answer:
        case MultipleChoiceExercise(), MultipleChoiceAnswer():
            return _assess_multiple_choice(exercise, answer)
    raise AnswerMismatch(f"a {answer.type} answer cannot assess a {exercise.type} exercise")


def _assess_multiple_choice(
    exercise: MultipleChoiceExercise, answer: MultipleChoiceAnswer
) -> AssessmentResult:
    if answer.option_id not in {option.id for option in exercise.options}:
        raise AnswerMismatch(f"option {answer.option_id!r} is not an option of this exercise")
    correct = answer.option_id == exercise.correct_option_id
    return AssessmentResult(
        exercise_id=exercise.id,
        score=1.0 if correct else 0.0,
        correct=correct,
        solution=MultipleChoiceSolution(
            type="multiple_choice",
            option_id=exercise.correct_option_id,
            explanation=exercise.solution_explanation,
        ),
    )
