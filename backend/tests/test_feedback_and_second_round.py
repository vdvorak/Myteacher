import copy

import pytest

LESSON = "es-ser-estar"


def exercises(lesson: dict) -> list[dict]:
    return [block for block in lesson["blocks"] if block["type"] != "explanation"]


def assess(client, exercise_id: str, option_id: str, **params):
    return client.post(
        f"/api/lessons/{LESSON}/exercises/{exercise_id}/assessment",
        params=params,
        json={"type": "multiple_choice", "option_id": option_id},
    )


def second_round(client, failed: list[str], seed: str = "s1", lesson: str = LESSON):
    return client.post(
        f"/api/lessons/{lesson}/second-round",
        json={"failed_exercise_ids": failed, "seed": seed},
    )


# Feedback mode and hints


@pytest.mark.parametrize(
    ("lesson_id", "mode"), [("es-ser-estar", "immediate"), ("en-present-perfect", "at_the_end")]
)
def test_fixture_lessons_cover_both_feedback_modes(client, lesson_id, mode):
    lesson = client.get(f"/api/lessons/{lesson_id}").json()

    assert lesson["feedback_mode"] == mode
    assert len(exercises(lesson)) >= 3


def test_feedback_mode_must_be_a_known_mode(client, spanish_lesson):
    document = copy.deepcopy(spanish_lesson)
    document["feedback_mode"] = "whenever"

    response = client.post("/api/lessons/validate", json=document)

    assert response.status_code == 422
    assert ["feedback_mode"] in [error["loc"] for error in response.json()["errors"]]


def test_hints_reach_the_browser_but_solutions_do_not(client, spanish_lesson):
    served = exercises(client.get(f"/api/lessons/{LESSON}").json())

    assert [e["hint"] for e in served] == [e["hint"] for e in exercises(spanish_lesson)]
    body = client.get(f"/api/lessons/{LESSON}").text
    for exercise in exercises(spanish_lesson):
        assert exercise["solution_explanation"] not in body


def test_a_wrong_try_that_may_be_retried_does_not_reveal_the_solution(client, spanish_lesson):
    exercise = exercises(spanish_lesson)[0]
    wrong = next(o["id"] for o in exercise["options"] if o["id"] != exercise["correct_option_id"])

    result = assess(client, exercise["id"], wrong, reveal="false").json()

    assert result["correct"] is False
    assert result["solution"] is None
    assert exercise["correct_option_id"] not in str(result.values())


def test_a_correct_try_reveals_the_explanation_even_when_not_final(client, spanish_lesson):
    exercise = exercises(spanish_lesson)[0]

    result = assess(client, exercise["id"], exercise["correct_option_id"], reveal="false").json()

    assert result["correct"] is True
    assert result["solution"]["explanation"] == exercise["solution_explanation"]


# Second round


def test_second_round_repeats_only_the_failed_exercises_in_lesson_order(client, spanish_lesson):
    ids = [e["id"] for e in exercises(spanish_lesson)]

    response = second_round(client, [ids[2], ids[0]])

    assert response.status_code == 200
    assert [e["id"] for e in response.json()["exercises"]] == [ids[0], ids[2]]


def test_second_round_varies_the_option_order(client, spanish_lesson):
    for seed in ["s1", "s2", "s3", "another"]:
        for original, repeat in zip(
            [e for e in exercises(spanish_lesson)],
            second_round(client, [e["id"] for e in exercises(spanish_lesson)], seed).json()[
                "exercises"
            ],
            strict=True,
        ):
            original_order = [o["id"] for o in original["options"]]
            repeat_order = [o["id"] for o in repeat["options"]]
            assert sorted(repeat_order) == sorted(original_order)
            assert repeat_order != original_order


def test_second_round_is_deterministic_for_a_seed(client):
    assert (
        second_round(client, ["location"], "x").json()
        == second_round(client, ["location"], "x").json()
    )
    assert (
        second_round(client, ["location"], "x").json()
        != second_round(client, ["location"], "y").json()
    )


def test_second_round_never_contains_the_answer_key(client, spanish_lesson):
    body = second_round(client, [e["id"] for e in exercises(spanish_lesson)]).text

    assert "correct_option_id" not in body
    assert "solution" not in body


def test_repeats_are_assessed_like_the_original_exercise(client, spanish_lesson):
    exercise = exercises(spanish_lesson)[0]
    repeat = second_round(client, [exercise["id"]]).json()["exercises"][0]

    assert assess(client, repeat["id"], exercise["correct_option_id"]).json()["score"] == 1.0


def test_a_lesson_with_no_failures_has_no_second_round(client):
    response = second_round(client, [])

    assert response.status_code == 200
    assert response.json() == {"exercises": []}


def test_second_round_rejects_an_unknown_exercise(client):
    assert second_round(client, ["no-such-exercise"]).status_code == 422


def test_second_round_of_an_unknown_lesson_is_not_found(client):
    assert second_round(client, [], lesson="no-such-lesson").status_code == 404
