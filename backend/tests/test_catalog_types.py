"""Exercise types that are in the schema but have no renderer or assessor in phase 1."""

import copy

import pytest

from myteacher.lesson.export import lesson_json_schema

LESSON = "all-exercise-types"

UNASSESSED_ANSWERS = {
    "highlight": {"type": "span_highlight", "spans": [{"start": 4, "end": 9}]},
    "conjugation": {"type": "table_fill", "cells": {"yo": "estoy", "tu": "estas"}},
    "distance": {"type": "numeric", "value": 520},
    "dictation": {"type": "listening", "text": "Dónde está la estación"},
    "stress": {"type": "custom", "value": {"tapped": "ción"}},
}

ANSWER_KEY_FIELDS = [
    "correct_option_id",
    "correct_spans",
    "accepted_answers",
    "correct_value",
    "tolerance",
    "transcript",
    "specification",
    "solution",
]


@pytest.fixture
def all_types(client) -> dict:
    return client.get(f"/api/lessons/{LESSON}").json()


@pytest.fixture
def all_types_document() -> dict:
    import json
    from importlib import resources

    path = resources.files("myteacher.fixtures") / "lessons" / f"{LESSON}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def catalog_types() -> set[str]:
    schema = lesson_json_schema()
    mapping = schema["$defs"]["LessonDocument"]["properties"]["blocks"]["items"]["discriminator"]
    return set(mapping["mapping"]) - {"explanation", "passage"}


def test_the_all_types_fixture_holds_every_type_in_the_catalog(all_types):
    served = {block["type"] for block in all_types["blocks"]} - {"explanation", "passage"}

    assert served == catalog_types()
    assert {"span_highlight", "table_fill", "numeric", "listening", "custom"} <= served


def test_the_all_types_fixture_validates(client, all_types_document):
    assert client.post("/api/lessons/validate", json=all_types_document).json() == {
        "valid": True,
        "errors": [],
    }


def test_answer_shapes_for_every_type_are_in_the_schema():
    definitions = lesson_json_schema()["$defs"]

    for name in [
        "SpanHighlightAnswer",
        "TableFillAnswer",
        "NumericAnswer",
        "ListeningAnswer",
        "CustomAnswer",
    ]:
        assert name in definitions


def test_served_lesson_carries_no_answer_key_for_any_type(client):
    body = client.get(f"/api/lessons/{LESSON}").text

    for field in ANSWER_KEY_FIELDS:
        assert f'"{field}"' not in body
    assert "estás" not in body
    assert "estamos" not in body
    assert "530" not in body


def test_served_lesson_keeps_what_a_future_renderer_needs(all_types):
    blocks = {block.get("id"): block for block in all_types["blocks"]}

    assert blocks["highlight"]["text"].startswith("Hoy estoy")
    assert blocks["conjugation"]["rows"][0] == [
        {"kind": "given", "text": "yo"},
        {"kind": "blank", "id": "yo"},
    ]
    assert blocks["distance"]["unit"] == "km"
    assert blocks["dictation"]["audio"] == {"attachment_id": "dictado-01"}
    assert blocks["stress"]["html"].startswith("<!doctype html>")
    assert blocks["stress"]["prompt"] == "Tap the stressed syllable."


@pytest.mark.parametrize(("exercise_id", "answer"), UNASSESSED_ANSWERS.items())
def test_assessment_answers_that_the_type_has_no_assessor_yet(client, exercise_id, answer):
    response = client.post(f"/api/lessons/{LESSON}/exercises/{exercise_id}/assessment", json=answer)

    assert response.status_code == 200
    assert response.json() == {
        "status": "unavailable",
        "exercise_id": exercise_id,
        "reason": "no_assessor_in_this_phase",
    }


def test_multiple_choice_is_still_assessed(client):
    response = client.post(
        f"/api/lessons/{LESSON}/exercises/choice/assessment",
        json={"type": "multiple_choice", "option_id": "esta"},
    )

    assert response.json()["status"] == "assessed"
    assert response.json()["score"] == 1.0


def test_an_answer_of_another_type_is_rejected(client):
    response = client.post(
        f"/api/lessons/{LESSON}/exercises/distance/assessment",
        json={"type": "multiple_choice", "option_id": "esta"},
    )

    assert response.status_code == 422


def test_types_without_a_renderer_are_not_repeated_in_a_second_round(client):
    response = client.post(
        f"/api/lessons/{LESSON}/second-round",
        json={"failed_exercise_ids": ["choice", "distance", "stress"], "seed": "s"},
    )

    assert [exercise["id"] for exercise in response.json()["exercises"]] == ["choice"]


def invalid(client, document, exercise_id, change) -> list:
    document = copy.deepcopy(document)
    block = next(b for b in document["blocks"] if b.get("id") == exercise_id)
    change(block)
    response = client.post("/api/lessons/validate", json=document)
    assert response.status_code == 422
    return response.json()["errors"]


def test_a_highlight_span_must_lie_inside_the_text(client, all_types_document):
    invalid(
        client,
        all_types_document,
        "highlight",
        lambda b: b["correct_spans"].append({"start": 50, "end": 500}),
    )


def test_highlight_spans_must_not_overlap(client, all_types_document):
    invalid(
        client,
        all_types_document,
        "highlight",
        lambda b: b["correct_spans"].append({"start": 5, "end": 7}),
    )


def test_every_table_row_has_one_cell_per_column(client, all_types_document):
    invalid(client, all_types_document, "conjugation", lambda b: b["rows"][0].pop())


def test_table_blanks_have_unique_ids(client, all_types_document):
    def duplicate(block):
        block["rows"][1][1]["id"] = "yo"

    invalid(client, all_types_document, "conjugation", duplicate)


def test_numeric_tolerance_is_not_negative(client, all_types_document):
    invalid(client, all_types_document, "distance", lambda b: b.update(tolerance=-1))


def test_custom_assessment_mode_is_one_of_the_known_modes(client, all_types_document):
    invalid(client, all_types_document, "stress", lambda b: b.update(assessment_mode="self_graded"))


@pytest.mark.parametrize(("field", "value"), [("correct_value", "NaN"), ("tolerance", "Infinity")])
def test_numeric_values_are_finite(client, all_types_document, field, value):
    import json

    document = copy.deepcopy(all_types_document)
    block = next(b for b in document["blocks"] if b.get("id") == "distance")
    block[field] = "__non_finite__"
    body = json.dumps(document).replace('"__non_finite__"', value)

    response = client.post(
        "/api/lessons/validate", content=body, headers={"content-type": "application/json"}
    )

    assert response.status_code == 422


def test_custom_answer_size_counts_characters_not_escapes(client):
    answer = {"type": "custom", "value": {"text": "á" * 15_000}}

    response = client.post(f"/api/lessons/{LESSON}/exercises/stress/assessment", json=answer)

    assert response.status_code == 200
