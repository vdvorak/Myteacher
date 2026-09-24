"""Free text, translation and the reading passage block."""

import copy
import json
from importlib import resources

import pytest

LESSON = "es-lectura"


def document() -> dict:
    path = resources.files("myteacher.fixtures") / "lessons" / f"{LESSON}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def served_lesson(client) -> dict:
    return client.get(f"/api/lessons/{LESSON}").json()


def block(lesson: dict, block_id: str) -> dict:
    return next(b for b in lesson["blocks"] if b.get("id") == block_id)


def assess(client, exercise: str, answer: dict, status: int = 200, **params):
    response = client.post(
        f"/api/lessons/{LESSON}/exercises/{exercise}/assessment", params=params, json=answer
    )
    assert response.status_code == status, response.text
    return response.json()


# Serving


def test_the_passage_is_served_before_the_exercises_that_reference_it(client):
    lesson = served_lesson(client)
    types = [b["type"] for b in lesson["blocks"]]

    passage = block(lesson, "barrio")
    assert passage["type"] == "passage"
    assert passage["title"] == "Mi barrio"
    assert types.index("passage") < types.index("multiple_choice")
    for exercise_id in ["where-lives", "baker", "your-neighbourhood", "sundays"]:
        assert block(lesson, exercise_id)["passage_id"] == "barrio"


def test_exercises_without_a_passage_say_so(client):
    lesson = client.get("/api/lessons/es-ser-estar").json()

    assert all(b["passage_id"] is None for b in lesson["blocks"] if b["type"] != "explanation")


def test_open_exercises_are_served_with_their_limits_but_without_rubric_or_model_answer(client):
    lesson = served_lesson(client)
    free = block(lesson, "your-neighbourhood")
    translation = block(lesson, "sundays")

    assert (free["min_characters"], free["max_characters"]) == (60, 600)
    assert translation["source_text"].startswith("Los domingos")
    assert (translation["source_language"], translation["target_language"]) == ("es", "cs")
    body = json.dumps(lesson, ensure_ascii=False)
    assert '"rubric"' not in body
    assert "V neděli" not in body


# Assessment


@pytest.mark.parametrize(
    ("exercise", "answer"),
    [
        ("your-neighbourhood", {"type": "free_text", "text": "Vivo en Brno. " * 6}),
        ("sundays", {"type": "translation", "text": "V neděli jíme u babičky."}),
    ],
)
def test_open_answers_are_not_scored(client, exercise, answer):
    result = assess(client, exercise, answer)

    assert result == {
        "status": "pending",
        "exercise_id": exercise,
        "reason": "not_deterministically_assessable",
    }


def test_an_open_answer_over_the_length_limit_is_rejected(client):
    assess(client, "sundays", {"type": "translation", "text": "x" * 301}, status=422)


@pytest.mark.parametrize("text", ["", "   ", "Vivo en Brno."])
def test_an_empty_or_too_short_open_answer_is_rejected(client, text):
    assess(client, "your-neighbourhood", {"type": "free_text", "text": text}, status=422)


def test_the_answer_key_carries_the_rubric_and_model_answer_of_open_exercises(client):
    key = client.get(f"/api/lessons/{LESSON}/answer-key").json()
    entries = {entry["exercise_id"]: entry for entry in key["entries"]}

    assert entries["sundays"]["solution"] is None
    assert entries["sundays"]["model_answer"] == "V neděli jíme s rodinou u babičky."
    assert [c["id"] for c in entries["sundays"]["rubric"]["criteria"]] == ["meaning", "natural"]
    assert entries["your-neighbourhood"]["model_answer"] is None
    assert entries["where-lives"]["rubric"] is None


# Second round


def test_open_exercises_never_appear_in_a_second_round(client):
    response = client.post(
        f"/api/lessons/{LESSON}/second-round",
        json={
            "failed_exercise_ids": ["where-lives", "your-neighbourhood", "sundays"],
            "seed": "s",
        },
    )

    assert [e["id"] for e in response.json()["exercises"]] == ["where-lives"]


def test_a_repeat_keeps_its_passage_reference(client):
    response = client.post(
        f"/api/lessons/{LESSON}/second-round",
        json={"failed_exercise_ids": ["baker"], "seed": "s"},
    )

    assert response.json()["exercises"][0]["passage_id"] == "barrio"


# Validation


def invalid(client, change) -> list[str]:
    lesson = copy.deepcopy(document())
    change(lesson)
    response = client.post("/api/lessons/validate", json=lesson)
    assert response.status_code == 422
    return [error["msg"] for error in response.json()["errors"]]


def test_fixture_validates(client):
    assert client.post("/api/lessons/validate", json=document()).status_code == 200


def test_a_dangling_passage_reference_is_rejected(client):
    messages = invalid(client, lambda d: block(d, "baker").update(passage_id="nowhere"))

    assert any("passage" in message for message in messages)


def test_a_passage_must_come_before_the_exercises_that_reference_it(client):
    def move(d):
        passage = block(d, "barrio")
        d["blocks"].remove(passage)
        d["blocks"].append(passage)

    invalid(client, move)


def test_a_reference_must_name_a_passage_not_another_block(client):
    invalid(client, lambda d: block(d, "baker").update(passage_id="where-lives"))


def test_block_ids_are_unique_across_passages_and_exercises(client):
    invalid(client, lambda d: block(d, "barrio").update(id="baker"))


def test_a_rubric_needs_a_criterion(client):
    invalid(client, lambda d: block(d, "your-neighbourhood").update(rubric={"criteria": []}))


def test_length_limits_are_consistent(client):
    invalid(client, lambda d: block(d, "your-neighbourhood").update(min_characters=700))


def test_a_translation_goes_between_two_languages(client):
    invalid(client, lambda d: block(d, "sundays").update(target_language="es"))
