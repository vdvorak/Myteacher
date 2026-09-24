import copy

LESSON = "es-ser-estar"


def first_exercise(lesson: dict) -> dict:
    return next(block for block in lesson["blocks"] if block["type"] == "multiple_choice")


def assess(client, exercise_id: str, option_id: str):
    return client.post(
        f"/api/lessons/{LESSON}/exercises/{exercise_id}/assessment",
        json={"type": "multiple_choice", "option_id": option_id},
    )


# Serving a lesson


def test_lesson_is_served_with_an_explanation_and_a_multiple_choice_exercise(client):
    response = client.get(f"/api/lessons/{LESSON}")

    assert response.status_code == 200
    lesson = response.json()
    assert [block["type"] for block in lesson["blocks"]][:2] == ["explanation", "multiple_choice"]
    exercise = first_exercise(lesson)
    assert len(exercise["options"]) >= 2


def test_served_lesson_never_contains_the_answer_key(client, spanish_lesson):
    body = client.get(f"/api/lessons/{LESSON}").text

    exercise = first_exercise(spanish_lesson)
    assert "correct_option_id" not in body
    assert "solution" not in body
    assert exercise["solution_explanation"] not in body


def test_unknown_lesson_is_not_found(client):
    assert client.get("/api/lessons/no-such-lesson").status_code == 404


# Validating a lesson document


def test_well_formed_lesson_document_is_accepted(client, spanish_lesson):
    response = client.post("/api/lessons/validate", json=spanish_lesson)

    assert response.status_code == 200
    assert response.json() == {"valid": True, "errors": []}


def test_malformed_lesson_document_is_rejected_with_field_level_errors(client, spanish_lesson):
    document = copy.deepcopy(spanish_lesson)
    exercise = first_exercise(document)
    exercise["options"] = exercise["options"][:1]
    del document["title"]

    response = client.post("/api/lessons/validate", json=document)

    assert response.status_code == 422
    body = response.json()
    assert body["valid"] is False
    locations = [error["loc"] for error in body["errors"]]
    assert ["title"] in locations
    index = document["blocks"].index(exercise)
    assert ["blocks", index, "multiple_choice", "options"] in locations


def test_correct_option_must_be_one_of_the_options(client, spanish_lesson):
    document = copy.deepcopy(spanish_lesson)
    first_exercise(document)["correct_option_id"] = "not-an-option"

    response = client.post("/api/lessons/validate", json=document)

    assert response.status_code == 422
    assert "correct_option_id" in response.text


def test_unknown_block_type_is_rejected(client, spanish_lesson):
    document = copy.deepcopy(spanish_lesson)
    document["blocks"].append({"type": "slideshow", "markdown": "x"})

    assert client.post("/api/lessons/validate", json=document).status_code == 422


def test_raw_html_in_explanation_markdown_is_rejected(client, spanish_lesson):
    document = copy.deepcopy(spanish_lesson)
    document["blocks"][0]["markdown"] = "Hola <script>alert(1)</script> **amigo**"

    response = client.post("/api/lessons/validate", json=document)

    assert response.status_code == 422
    error = response.json()["errors"][0]
    assert error["loc"] == ["blocks", 0, "explanation", "markdown"]
    assert "HTML" in error["msg"]


def test_raw_html_block_in_exercise_prompt_is_rejected(client, spanish_lesson):
    document = copy.deepcopy(spanish_lesson)
    first_exercise(document)["prompt"] = "<div onclick='x()'>Elige</div>"

    assert client.post("/api/lessons/validate", json=document).status_code == 422


def test_ordinary_markdown_with_angle_brackets_is_accepted(client, spanish_lesson):
    document = copy.deepcopy(spanish_lesson)
    document["blocks"][0]["markdown"] = "Ser *vs* estar: 1 < 2 and see <https://rae.es>."

    assert client.post("/api/lessons/validate", json=document).status_code == 200


# Assessing a multiple-choice answer


def test_correct_answer_scores_one_and_returns_the_solution(client, spanish_lesson):
    exercise = first_exercise(spanish_lesson)

    response = assess(client, exercise["id"], exercise["correct_option_id"])

    assert response.status_code == 200
    assert response.json() == {
        "exercise_id": exercise["id"],
        "score": 1.0,
        "correct": True,
        "solution": {
            "type": "multiple_choice",
            "option_id": exercise["correct_option_id"],
            "explanation": exercise["solution_explanation"],
        },
    }


def test_wrong_answer_scores_zero_and_still_returns_the_solution(client, spanish_lesson):
    exercise = first_exercise(spanish_lesson)
    wrong = next(o["id"] for o in exercise["options"] if o["id"] != exercise["correct_option_id"])

    result = assess(client, exercise["id"], wrong).json()

    assert result["score"] == 0.0
    assert result["correct"] is False
    assert result["solution"]["option_id"] == exercise["correct_option_id"]


def test_assessment_is_deterministic(client, spanish_lesson):
    exercise = first_exercise(spanish_lesson)

    results = [
        assess(client, exercise["id"], exercise["correct_option_id"]).json() for _ in range(3)
    ]

    assert results[0] == results[1] == results[2]


def test_answer_naming_an_unknown_option_is_rejected(client, spanish_lesson):
    response = assess(client, first_exercise(spanish_lesson)["id"], "zzz")

    assert response.status_code == 422


def test_assessing_an_unknown_exercise_is_not_found(client):
    assert assess(client, "no-such-exercise", "a").status_code == 404


def test_unparseable_document_is_reported_in_the_same_shape(client):
    response = client.post(
        "/api/lessons/validate", content=b"{not json", headers={"content-type": "application/json"}
    )

    assert response.status_code == 422
    assert response.json()["valid"] is False
    assert response.json()["errors"][0]["type"] == "json_invalid"
