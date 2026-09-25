"""Matching and token ordering: arrangements assessed with optional partial credit."""

import copy
import json
from importlib import resources

import pytest

CASA = "es-la-casa"
ORDER = "en-word-order"


def document(lesson_id: str) -> dict:
    path = resources.files("myteacher.fixtures") / "lessons" / f"{lesson_id}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def served(client, lesson_id: str, exercise_id: str) -> dict:
    lesson = client.get(f"/api/lessons/{lesson_id}").json()
    return next(b for b in lesson["blocks"] if b.get("id") == exercise_id)


def assess(client, lesson: str, exercise: str, answer: dict, status: int = 200, **params):
    response = client.post(
        f"/api/lessons/{lesson}/exercises/{exercise}/assessment", params=params, json=answer
    )
    assert response.status_code == status, response.text
    return response.json()


def right_id(exercise: dict, text: str) -> str:
    return next(item["id"] for item in exercise["right"] if item["text"] == text)


def token_ids(exercise: dict, texts: list[str]) -> list[str]:
    ids = {item["text"]: item["id"] for item in exercise["tokens"]}
    return [ids[text] for text in texts]


ROOMS = {
    "la cocina": "the kitchen",
    "el baño": "the bathroom",
    "el dormitorio": "the bedroom",
    "el salón": "the living room",
}


def rooms_answer(exercise: dict, pairing: dict[str, str]) -> dict:
    lefts = {item["text"]: item["id"] for item in exercise["left"]}
    return {
        "type": "matching",
        "pairs": {lefts[left]: right_id(exercise, right) for left, right in pairing.items()},
    }


# Matching


def test_served_matching_does_not_reveal_the_pairs(client):
    exercise = served(client, CASA, "rooms")

    assert [item["text"] for item in exercise["left"]] == list(ROOMS)
    rights = [item["text"] for item in exercise["right"]]
    assert rights == sorted(rights, key=str.casefold)
    left_ids = {item["id"] for item in exercise["left"]}
    assert not left_ids & {item["id"] for item in exercise["right"]}
    assert '"pairs"' not in json.dumps(exercise)


def test_all_pairs_right_scores_one(client):
    exercise = served(client, CASA, "rooms")

    result = assess(client, CASA, "rooms", rooms_answer(exercise, ROOMS))

    assert result["score"] == 1.0
    assert result["correct"] is True


def test_partial_credit_scores_the_share_of_right_pairs(client):
    exercise = served(client, CASA, "rooms")
    pairing = dict(ROOMS, **{"la cocina": "the bathroom", "el baño": "the kitchen"})

    result = assess(client, CASA, "rooms", rooms_answer(exercise, pairing))

    assert result["score"] == 0.5
    assert result["correct"] is False
    lefts = {item["id"]: item["text"] for item in exercise["left"]}
    assert {lefts[i["id"]]: i["correct"] for i in result["items"]} == {
        "la cocina": False,
        "el baño": False,
        "el dormitorio": True,
        "el salón": True,
    }


def test_without_partial_credit_a_wrong_pair_scores_zero(client):
    exercise = served(client, ORDER, "opposites")
    lefts = {item["text"]: item["id"] for item in exercise["left"]}
    answer = {
        "type": "matching",
        "pairs": {
            lefts["early"]: right_id(exercise, "late"),
            lefts["cheap"]: right_id(exercise, "full"),
            lefts["empty"]: right_id(exercise, "expensive"),
        },
    }

    assert assess(client, ORDER, "opposites", answer)["score"] == 0.0


def test_matching_solution_lists_every_pair(client):
    exercise = served(client, CASA, "rooms")
    result = assess(client, CASA, "rooms", rooms_answer(exercise, ROOMS))

    lefts = {item["id"]: item["text"] for item in exercise["left"]}
    rights = {item["id"]: item["text"] for item in exercise["right"]}
    assert {
        lefts[p["left_id"]]: rights[p["right_id"]] for p in result["solution"]["pairs"]
    } == ROOMS


@pytest.mark.parametrize(
    "change",
    [
        lambda pairs, rights: pairs.popitem(),  # a left item unpaired
        lambda pairs, rights: pairs.update({next(iter(pairs)): "zz"}),  # unknown right
        lambda pairs, rights: pairs.update(dict.fromkeys(pairs, rights[0])),  # right used twice
    ],
)
def test_a_matching_answer_must_pair_every_item_once(client, change):
    exercise = served(client, CASA, "rooms")
    answer = rooms_answer(exercise, ROOMS)
    change(answer["pairs"], [item["id"] for item in exercise["right"]])

    assess(client, CASA, "rooms", answer, status=422)


# Token ordering


def test_served_tokens_do_not_reveal_the_order(client):
    exercise = served(client, ORDER, "yesterday")

    texts = [token["text"] for token in exercise["tokens"]]
    assert texts == sorted(texts, key=str.casefold)
    assert '"accepted_orders"' not in json.dumps(exercise)


@pytest.mark.parametrize(
    "texts",
    [
        ["I", "visited", "my", "grandmother", "yesterday"],
        ["yesterday", "I", "visited", "my", "grandmother"],
    ],
)
def test_any_accepted_order_scores_one(client, texts):
    exercise = served(client, ORDER, "yesterday")
    answer = {"type": "token_ordering", "order": token_ids(exercise, texts)}

    result = assess(client, ORDER, "yesterday", answer)

    assert result["score"] == 1.0
    assert result["correct"] is True


def test_partial_credit_counts_tokens_in_place_against_the_closest_order(client):
    exercise = served(client, ORDER, "yesterday")
    texts = ["I", "visited", "grandmother", "my", "yesterday"]

    result = assess(
        client, ORDER, "yesterday", {"type": "token_ordering", "order": token_ids(exercise, texts)}
    )

    assert result["score"] == pytest.approx(3 / 5)
    assert [item["correct"] for item in result["items"]] == [True, True, False, False, True]
    assert result["solution"]["tokens"] == ["I", "visited", "my", "grandmother", "yesterday"]


def test_without_partial_credit_a_wrong_order_scores_zero(client):
    exercise = served(client, CASA, "where-bathroom")
    texts = ["¿Dónde", "el", "está", "baño?"]

    result = assess(
        client,
        CASA,
        "where-bathroom",
        {"type": "token_ordering", "order": token_ids(exercise, texts)},
    )

    assert result["score"] == 0.0
    assert result["solution"]["tokens"] == ["¿Dónde", "está", "el", "baño?"]


def test_identical_tokens_are_interchangeable(client):
    from myteacher.lesson.assessment import assess as assess_exercise
    from myteacher.lesson.schema import LessonDocument, TokenOrderingAnswer

    lesson = copy.deepcopy(document(ORDER))
    lesson["blocks"][1] = {
        "type": "token_ordering",
        "id": "twice",
        "prompt": "Order.",
        "tokens": [
            {"id": "a", "text": "la"},
            {"id": "b", "text": "casa"},
            {"id": "c", "text": "y"},
            {"id": "d", "text": "la"},
            {"id": "e", "text": "playa"},
        ],
        "accepted_orders": [["a", "b", "c", "d", "e"]],
    }
    exercise = LessonDocument.model_validate(lesson).exercise("twice")
    public = exercise.public()
    ids = [t.id for t in public.tokens]
    by_text = {}
    for token in public.tokens:
        by_text.setdefault(token.text, []).append(token.id)
    swapped = [
        by_text["la"][1],
        by_text["casa"][0],
        by_text["y"][0],
        by_text["la"][0],
        by_text["playa"][0],
    ]

    answer = TokenOrderingAnswer(type="token_ordering", order=swapped)
    assert assess_exercise(exercise, answer, language="es").correct is True
    assert sorted(swapped) == sorted(ids)


@pytest.mark.parametrize(
    "change", [lambda order: order.pop(), lambda order: order.__setitem__(0, order[1])]
)
def test_an_order_must_use_every_token_once(client, change):
    exercise = served(client, ORDER, "yesterday")
    order = [token["id"] for token in exercise["tokens"]]
    change(order)

    assess(client, ORDER, "yesterday", {"type": "token_ordering", "order": order}, status=422)


# Second round


def repeat(client, lesson: str, exercise: str, seed: str) -> dict:
    response = client.post(
        f"/api/lessons/{lesson}/second-round",
        json={"failed_exercise_ids": [exercise], "seed": seed},
    )
    return response.json()["exercises"][0]


def test_second_round_matching_presents_the_pairs_in_another_order(client):
    first = [item["text"] for item in served(client, CASA, "rooms")["left"]]

    for seed in ["s1", "s2", "s3"]:
        varied = repeat(client, CASA, "rooms", seed)
        assert [item["text"] for item in varied["left"]] != first
        assert sorted(item["text"] for item in varied["left"]) == sorted(first)


def test_second_round_matching_is_assessed_like_the_original(client):
    varied = repeat(client, CASA, "rooms", "s1")

    assert assess(client, CASA, "rooms", rooms_answer(varied, ROOMS))["correct"] is True


def test_second_round_repeats_token_ordering(client):
    varied = repeat(client, ORDER, "yesterday", "s1")
    texts = ["I", "visited", "my", "grandmother", "yesterday"]
    answer = {"type": "token_ordering", "order": token_ids(varied, texts)}

    assert assess(client, ORDER, "yesterday", answer)["correct"] is True


# Validation


def invalid(client, lesson_id: str, exercise_id: str, change) -> None:
    lesson = copy.deepcopy(document(lesson_id))
    change(next(b for b in lesson["blocks"] if b.get("id") == exercise_id))
    assert client.post("/api/lessons/validate", json=lesson).status_code == 422


def test_fixtures_validate(client):
    for lesson_id in [CASA, ORDER]:
        assert client.post("/api/lessons/validate", json=document(lesson_id)).status_code == 200


def test_matching_needs_two_pairs(client):
    invalid(client, CASA, "rooms", lambda b: b.update(pairs=b["pairs"][:1]))


def test_matching_items_are_unique_per_column(client):
    invalid(client, CASA, "rooms", lambda b: b["pairs"][1].update(right="the kitchen"))


def test_accepted_orders_use_every_token_once(client):
    invalid(client, ORDER, "yesterday", lambda b: b["accepted_orders"].append(["a", "b"]))
    invalid(
        client, ORDER, "yesterday", lambda b: b["accepted_orders"].append(["a", "a", "b", "c", "d"])
    )


def test_an_ordering_needs_an_accepted_order(client):
    invalid(client, ORDER, "yesterday", lambda b: b.update(accepted_orders=[]))
