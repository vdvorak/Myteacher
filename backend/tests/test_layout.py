"""Layouts an attempt serves never give the answer away (#19), whatever the seed."""

from myteacher.lesson.layout import layout
from myteacher.lesson.schema import MatchingExercise, MultipleChoiceExercise, TokenOrderingExercise

SEEDS = [f"seed-{n}" for n in range(300)]


def ordering(*texts: str) -> TokenOrderingExercise:
    ids = [chr(ord("a") + i) for i in range(len(texts))]
    return TokenOrderingExercise(
        type="token_ordering",
        id="order",
        prompt="Order.",
        tokens=[{"id": i, "text": t} for i, t in zip(ids, texts, strict=True)],
        accepted_orders=[ids],
    )


def texts(exercise: TokenOrderingExercise, order: list[str]) -> list[str]:
    public = exercise.public_ids()
    by_public = {public[token.id]: token.text for token in exercise.tokens}
    return [by_public[item] for item in order]


def test_two_tokens_are_never_laid_out_in_the_accepted_order():
    exercise = ordering("Hola", "Ana")

    assert {tuple(texts(exercise, layout(exercise, seed))) for seed in SEEDS} == {("Ana", "Hola")}


def test_tokens_with_the_same_text_are_never_laid_out_as_an_accepted_order():
    exercise = ordering("la", "casa", "la")

    for seed in SEEDS:
        assert texts(exercise, layout(exercise, seed)) != ["la", "casa", "la"], seed


def test_a_matching_right_column_never_follows_its_left_partners():
    exercise = MatchingExercise(
        type="matching",
        id="pairs",
        prompt="Match.",
        pairs=[
            {"id": "p1", "left": "sí", "right": "yes"},
            {"id": "p2", "left": "no", "right": "no"},
        ],
    )
    rights = exercise.right_ids()

    for seed in SEEDS:
        assert layout(exercise, seed) == sorted(rights.values(), key=lambda r: r != rights["p2"])


def test_a_repeat_looks_new_where_another_allowed_layout_exists():
    exercise = ordering("Yo", "soy", "Ana")

    for seed in SEEDS:
        first = layout(exercise, seed)
        assert layout(exercise, f"{seed}:again", first) != first, seed


def test_a_repeat_keeps_the_answer_hidden_even_when_it_must_look_the_same():
    exercise = ordering("Hola", "Ana")
    only = layout(exercise, "x")

    assert layout(exercise, "y", only) == only


def test_types_the_browser_lays_out_have_no_served_layout():
    exercise = MultipleChoiceExercise(
        type="multiple_choice",
        id="choice",
        prompt="Pick.",
        options=[{"id": "a", "text": "a"}, {"id": "b", "text": "b"}],
        correct_option_id="a",
    )

    assert layout(exercise, "x") is None
