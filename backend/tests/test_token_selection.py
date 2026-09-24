"""Token selection in a text: letters, syllables or words the student taps."""

import copy
import json
from importlib import resources

import pytest

LESSON = "es-acentos"


def document() -> dict:
    path = resources.files("myteacher.fixtures") / "lessons" / f"{LESSON}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def served(client, exercise_id: str) -> dict:
    lesson = client.get(f"/api/lessons/{LESSON}").json()
    return next(b for b in lesson["blocks"] if b.get("id") == exercise_id)


def assess(client, exercise: str, item: str, selected: list[int], status: int = 200, **params):
    response = client.post(
        f"/api/lessons/{LESSON}/exercises/{exercise}/assessment",
        params=params,
        json={"type": "token_selection", "item_id": item, "selected": selected},
    )
    assert response.status_code == status, response.text
    return response.json()


def texts(exercise: dict) -> list[str]:
    return [token["text"] for token in exercise["tokens"]]


# Serving


def test_syllables_are_served_as_given(client):
    exercise = served(client, "stress")

    assert exercise["granularity"] == "syllable"
    assert exercise["item_id"] == "cancion"
    assert texts(exercise) == ["can", "ción"]
    assert [token["space_after"] for token in exercise["tokens"]] == [False, False]
    assert exercise["max_selections"] == 1


def test_words_are_split_on_whitespace(client):
    exercise = served(client, "verbs")

    assert texts(exercise) == ["Yo", "como", "pan", "y", "bebo", "agua."]
    assert [token["space_after"] for token in exercise["tokens"]] == [True] * 5 + [False]
    assert exercise["max_selections"] is None


def test_letters_are_every_character_but_spaces(client):
    exercise = served(client, "enye")

    assert texts(exercise) == ["E", "s", "p", "a", "ñ", "a"]


def test_served_exercise_carries_neither_the_expected_set_nor_other_items(client):
    body = json.dumps(served(client, "stress"), ensure_ascii=False)

    assert '"expected"' not in body
    assert "teléfono" not in body
    assert '"items"' not in body


# Assessment


def test_the_expected_set_scores_one(client):
    result = assess(client, "stress", "cancion", [1])

    assert result["score"] == 1.0
    assert result["correct"] is True
    assert result["solution"] == {
        "type": "token_selection",
        "item_id": "cancion",
        "selected": [1],
        "explanation": "The tilde marks the stress; without one, the ending decides.",
    }


def test_without_partial_credit_anything_else_scores_zero(client):
    result = assess(client, "stress", "cancion", [0])

    assert result["score"] == 0.0
    assert result["items"] == [{"id": "0", "correct": False}]


def test_partial_credit_is_the_overlap_of_the_sets(client):
    one_of_two = assess(client, "verbs", "comida", [1])
    with_an_extra = assess(client, "verbs", "comida", [1, 4, 5])
    everything = assess(client, "verbs", "comida", [0, 1, 2, 3, 4, 5])

    assert one_of_two["score"] == pytest.approx(1 / 2)
    assert with_an_extra["score"] == pytest.approx(2 / 3)
    assert everything["score"] == pytest.approx(2 / 6)
    assert with_an_extra["items"] == [
        {"id": "1", "correct": True},
        {"id": "4", "correct": True},
        {"id": "5", "correct": False},
    ]


def test_a_withheld_solution_does_not_reveal_missed_tokens(client):
    result = assess(client, "verbs", "comida", [1], reveal="false")

    assert result["solution"] is None
    assert result["items"] == [{"id": "1", "correct": True}]


def test_selection_beyond_the_limit_is_rejected(client):
    assess(client, "stress", "cancion", [0, 1], status=422)


@pytest.mark.parametrize("selected", [[2], [-1], [1, 1]])
def test_selection_must_name_distinct_tokens_of_the_item(client, selected):
    assess(client, "stress", "cancion", selected, status=422)


def test_an_unknown_item_is_rejected(client):
    assess(client, "stress", "nope", [0], status=422)


def test_every_item_of_the_set_is_assessed_on_its_own_tokens(client):
    assert assess(client, "stress", "ordenador", [3])["correct"] is True
    assert assess(client, "enye", "manana", [2])["correct"] is True


# Second round


def repeat(client, exercise: str, seed: str) -> dict:
    response = client.post(
        f"/api/lessons/{LESSON}/second-round",
        json={"failed_exercise_ids": [exercise], "seed": seed},
    )
    return response.json()["exercises"][0]


def test_second_round_asks_the_same_skill_on_another_item(client):
    items = set()
    for seed in ["s1", "s2", "s3", "s4", "s5"]:
        varied = repeat(client, "stress", seed)
        assert varied["item_id"] != "cancion"
        items.add(varied["item_id"])
        assert varied["granularity"] == "syllable"
        assert varied["max_selections"] == 1
    assert len(items) > 1


def test_second_round_item_is_assessed_against_its_own_expected_set(client):
    varied = repeat(client, "stress", "s1")
    expected = {i["id"]: i["expected"] for i in document()["blocks"][1]["items"]}

    assert assess(client, "stress", varied["item_id"], expected[varied["item_id"]])["correct"]


def test_an_exercise_with_one_item_repeats_it(client):
    lesson = client.post(
        "/api/lessons/all-exercise-types/second-round",
        json={"failed_exercise_ids": ["select"], "seed": "s"},
    ).json()

    assert lesson["exercises"][0]["item_id"] == "cancion"


# Validation


def invalid(client, exercise_id: str, change) -> None:
    lesson = copy.deepcopy(document())
    change(next(b for b in lesson["blocks"] if b.get("id") == exercise_id))
    assert client.post("/api/lessons/validate", json=lesson).status_code == 422


def test_fixture_validates(client):
    assert client.post("/api/lessons/validate", json=document()).status_code == 200


def test_syllables_need_explicit_boundaries(client):
    invalid(client, "stress", lambda b: b["items"][0].pop("tokens"))


def test_boundaries_must_spell_the_text(client):
    invalid(client, "stress", lambda b: b["items"][0].update(tokens=["can", "cion"]))


def test_expected_tokens_must_exist(client):
    invalid(client, "stress", lambda b: b["items"][0].update(expected=[5]))


def test_expected_set_is_not_empty(client):
    invalid(client, "stress", lambda b: b["items"][0].update(expected=[]))


def test_limit_leaves_room_for_the_expected_set(client):
    invalid(client, "verbs", lambda b: b.update(max_selections=1))


def test_item_ids_are_unique(client):
    invalid(client, "stress", lambda b: b["items"][1].update(id="cancion"))
