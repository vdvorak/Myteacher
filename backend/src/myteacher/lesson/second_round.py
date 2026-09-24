"""The second round: varied repeats of the exercises a student failed in the first pass.

A pure function of (lesson, failed exercise ids, seed). Types without a renderer or an
assessor in this phase are not repeated. Repeats keep their exercise id
and option or candidate ids, so they are assessed like the original exercise.
"""

import random

from myteacher.lesson.schema import (
    ClozeExercise,
    Exercise,
    LessonDocument,
    MatchingExercise,
    MultipleChoiceExercise,
    ShortAnswerExercise,
    TokenOrderingExercise,
    TokenSelectionExercise,
)


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
        case ShortAnswerExercise():
            # Re-asked with the hint up front: recall with support rather than a copy of the answer.
            return exercise.model_copy(update={"show_hint": True})
        case MatchingExercise():
            # The pairs come in another order; right items keep their ids and are re-shuffled
            # by the renderer from the second round's seed.
            return exercise.model_copy(
                update={"pairs": _different_order(exercise.pairs, f"{seed}:{exercise.id}")}
            )
        case TokenSelectionExercise():
            # The same skill on another item of the set, where the set has another.
            current = exercise.item()
            others = [item.id for item in exercise.items if current and item.id != current.id]
            if not others:
                return exercise
            return exercise.model_copy(
                update={"active_item": random.Random(f"{seed}:{exercise.id}").choice(others)}
            )
        case TokenOrderingExercise():
            # Tokens are served in a fixed order; the renderer re-orders them for the repeat.
            return exercise
        case ClozeExercise():
            return exercise.model_copy(
                update={"blanked": _other_blanks(exercise, f"{seed}:{exercise.id}")}
            )
        case _:
            return None


def _other_blanks(exercise: ClozeExercise, seed: str) -> list[str]:
    """As many gaps as before, over different words where the candidate set allows."""
    rng = random.Random(seed)
    blanked = set(exercise.blanked)
    others = [c.id for c in exercise.candidates() if c.id not in blanked]
    chosen = rng.sample(others, min(len(blanked), len(others)))
    if len(chosen) < len(blanked):
        chosen += rng.sample(sorted(blanked), len(blanked) - len(chosen))
    order = [c.id for c in exercise.candidates()]
    return sorted(chosen, key=order.index)


def _different_order[T](items: list[T], seed: str) -> list[T]:
    """A seeded permutation that is never the original order (for two or more items)."""
    shuffled = list(items)
    random.Random(seed).shuffle(shuffled)
    if shuffled == items:
        shuffled = shuffled[1:] + shuffled[:1]
    return shuffled
