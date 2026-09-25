"""The layouts an attempt serves (#19): the order of a matching's right column and of the tokens
to order. They are drawn from the attempt's seed on the server, which knows the key, so a layout
that gives the answer away is drawn again: a right column in the order of its left partners, or
tokens already in an accepted order."""

import random

from myteacher.lesson.schema import Exercise, MatchingExercise, TokenOrderingExercise

# Enough that a layout with a single allowed order is still found (with two items, half of all
# draws are allowed), while a small exercise whose every order is an answer does not loop forever.
_DRAWS = 64


def layout(exercise: Exercise, seed: str, previous: list[str] | None = None) -> list[str] | None:
    """The public item ids in the order to show them, or None for a type the browser lays out
    itself. A repeat avoids `previous`, the layout of the first pass, where another is allowed."""
    match exercise:
        case MatchingExercise():
            rights = exercise.right_ids()
            items = sorted(rights.values())
            pairing = [rights[pair.id] for pair in exercise.pairs]

            def gives_away(order: list[str]) -> bool:
                return order == pairing

        case TokenOrderingExercise():
            public = exercise.public_ids()
            text = {public[token.id]: token.text for token in exercise.tokens}
            items = sorted(public.values())
            accepted = exercise.accepted_texts()

            def gives_away(order: list[str]) -> bool:
                # Tokens with the same text are interchangeable, so orders compare as texts.
                return [text[item] for item in order] in accepted

        case _:
            return None
    rng = random.Random(seed)
    draws = []
    for _ in range(_DRAWS):
        order = list(items)
        rng.shuffle(order)
        draws.append(order)
        if not gives_away(order) and order != previous:
            return order
    # Every draw looked like the first pass or an answer: looking new yields to hiding the answer.
    return next((order for order in draws if not gives_away(order)), draws[-1])
