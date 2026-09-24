"""The second round: varied repeats of the exercises a student failed in the first pass.

A pure function of (lesson, failed exercise ids, seed). Types without a renderer or an
assessor in this phase are not repeated. Repeats keep their exercise id
and option ids, so they are assessed exactly like the original exercise.
"""

import random

from myteacher.lesson.schema import Exercise, LessonDocument, MultipleChoiceExercise


class UnknownExercise(ValueError):
    pass


def second_round(
    lesson: LessonDocument, failed_exercise_ids: list[str], seed: str
) -> list[Exercise]:
    known = {exercise.id for exercise in lesson.exercises()}
    unknown = sorted(set(failed_exercise_ids) - known)
    if unknown:
        raise UnknownExercise(f"not exercises of this lesson: {', '.join(unknown)}")
    failed = set(failed_exercise_ids)
    repeats = (vary(exercise, seed) for exercise in lesson.exercises() if exercise.id in failed)
    return [repeat for repeat in repeats if repeat is not None]


def vary(exercise: Exercise, seed: str) -> Exercise | None:
    """A varied repeat, or None for a type that has no variation strategy (and is not repeated)."""
    match exercise:
        case MultipleChoiceExercise():
            return exercise.model_copy(
                update={"options": _different_order(exercise.options, f"{seed}:{exercise.id}")}
            )
        case _:
            return None


def _different_order[T](items: list[T], seed: str) -> list[T]:
    """A seeded permutation that is never the original order (for two or more items)."""
    shuffled = list(items)
    random.Random(seed).shuffle(shuffled)
    if shuffled == items:
        shuffled = shuffled[1:] + shuffled[:1]
    return shuffled
