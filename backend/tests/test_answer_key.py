"""The answer key: canonical solutions for printing, served only on request and only to teachers."""

from tests.helpers import as_student


def exercises(lesson: dict) -> list[dict]:
    return [block for block in lesson["blocks"] if block["type"] != "explanation"]


def test_answer_key_lists_every_exercise_with_its_canonical_solution(teacher, spanish_lesson):
    response = teacher.get("/api/lessons/es-ser-estar/answer-key")

    assert response.status_code == 200
    key = response.json()
    assert key["lesson_id"] == "es-ser-estar"
    assert key["entries"] == [
        {
            "exercise_id": exercise["id"],
            "solution": {
                "type": "multiple_choice",
                "option_id": exercise["correct_option_id"],
                "explanation": exercise["solution_explanation"],
            },
            "rubric": None,
            "model_answer": None,
        }
        for exercise in exercises(spanish_lesson)
    ]


def test_types_without_an_assessor_have_no_solution_in_the_key(teacher):
    key = teacher.get("/api/lessons/all-exercise-types/answer-key").json()

    solutions = {entry["exercise_id"]: entry["solution"] for entry in key["entries"]}
    assert solutions["choice"]["option_id"] == "esta"
    assert {
        solutions[i] for i in ["highlight", "conjugation", "distance", "dictation", "stress"]
    } == {None}


def test_the_lesson_payload_still_carries_no_key(client):
    body = client.get("/api/lessons/es-ser-estar").text

    assert "option_id" not in body
    assert "solution" not in body


def test_answer_key_of_an_unknown_lesson_is_not_found(teacher):
    assert teacher.get("/api/lessons/no-such-lesson/answer-key").status_code == 404


def test_the_answer_key_refuses_students_and_anonymous_requests(app_client, teacher, sender):
    as_student(teacher, sender)
    assert teacher.get("/api/lessons/es-ser-estar/answer-key").status_code == 403

    teacher.cookies.clear()
    assert teacher.get("/api/lessons/es-ser-estar/answer-key").status_code == 401
