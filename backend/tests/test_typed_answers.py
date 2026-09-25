"""Short answer and cloze: typed answers assessed with the exercise's tolerance rules."""

import copy
import json
from importlib import resources

import pytest

VOCAB = "es-vocabulario"
VERBS = "en-irregular-verbs"


def document(lesson_id: str) -> dict:
    path = resources.files("myteacher.fixtures") / "lessons" / f"{lesson_id}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def assess(client, lesson: str, exercise: str, answer: dict, **params) -> dict:
    response = client.post(
        f"/api/lessons/{lesson}/exercises/{exercise}/assessment", params=params, json=answer
    )
    assert response.status_code == 200, response.text
    return response.json()


def short(client, exercise: str, text: str, lesson: str = VOCAB, **params) -> dict:
    return assess(client, lesson, exercise, {"type": "short_answer", "text": text}, **params)


def cloze(client, exercise: str, gaps: dict, lesson: str = VOCAB, **params) -> dict:
    return assess(client, lesson, exercise, {"type": "cloze", "gaps": gaps}, **params)


# Short answer and tolerance rules


@pytest.mark.parametrize(
    ("text", "correct"),
    [
        ("canción", True),
        ("Canción", True),  # case is ignored by default
        ("  canción ", True),  # surrounding whitespace never counts
        ("cancion", False),  # accents count by default
        ("canciòn", False),
    ],
)
def test_short_answer_default_rules(client, text, correct):
    assert short(client, "song", text)["correct"] is correct


@pytest.mark.parametrize(
    ("text", "correct"),
    [("año", True), ("AÑO", True), ("ano", False), ("anyo", False)],
)
def test_ignoring_diacritics_never_turns_enye_into_n(client, text, correct):
    assert short(client, "year", text)["correct"] is correct


@pytest.mark.parametrize(
    "text",
    [
        "¿Dónde está la estación?",
        "Dónde está la estación",
        "donde esta la estacion",
        "¿donde   esta la  estacion?",
    ],
)
def test_punctuation_and_accents_can_both_be_ignored(client, text):
    assert short(client, "where", text)["correct"] is True


def lesson_in(monkeypatch, language: str, answer: str) -> str:
    """The vocabulary lesson in another language, with `answer` accepted for `year`."""
    from myteacher.api import lessons
    from myteacher.lesson.schema import LessonDocument

    lesson = document(VOCAB)
    lesson["id"] = f"{language.lower()}-vocabulary"
    lesson["language"] = language
    exercise = next(b for b in lesson["blocks"] if b.get("id") == "year")
    exercise["accepted_answers"] = [answer]
    served = {**lessons.fixture_lessons(), lesson["id"]: LessonDocument.model_validate(lesson)}
    monkeypatch.setattr(lessons, "fixture_lessons", lambda: served)
    return lesson["id"]


@pytest.mark.parametrize(
    ("answer", "text", "correct"),
    [
        ("řeka", "reka", False),  # a háček makes a letter of its own in Czech
        ("čeština", "cestina", False),
        ("ďábel", "dabel", False),
        ("tělo", "telo", False),
        ("kůň", "kun", False),  # and so does the kroužek
        ("kůň", "kůn", False),
        ("Šťastný", "šťastny", True),  # the acute accent is ignored
        ("výlet", "vylet", True),
        ("úterý", "UTERY", True),
        ("úterý", "Uterý", True),
    ],
)
def test_ignoring_diacritics_in_czech_keeps_hacek_and_krouzek(
    monkeypatch, client, answer, text, correct
):
    lesson = lesson_in(monkeypatch, "cs", answer)

    assert short(client, "year", text, lesson=lesson)["correct"] is correct


def test_czech_does_not_keep_the_spanish_enye(monkeypatch, client):
    lesson = lesson_in(monkeypatch, "cs", "año")

    assert short(client, "year", "ano", lesson=lesson)["correct"] is True


def test_the_letters_kept_follow_the_language_not_its_region(monkeypatch, client):
    lesson = lesson_in(monkeypatch, "cs-CZ", "řeka")

    assert short(client, "year", "reka", lesson=lesson)["correct"] is False


def test_a_language_without_letters_of_its_own_ignores_every_mark(monkeypatch, client):
    lesson = lesson_in(monkeypatch, "en", "naïve café")

    assert short(client, "year", "naive cafe", lesson=lesson)["correct"] is True


def test_ignoring_punctuation_still_needs_the_words(client):
    assert short(client, "where", "¿Dónde está?")["correct"] is False


def test_listed_alternatives_are_accepted(client):
    for text in ["don't", "don’t", "Don't"]:
        assert short(client, "contraction", text, lesson=VERBS)["correct"] is True
    assert short(client, "contraction", "dont", lesson=VERBS)["correct"] is False


def test_whitespace_rule_can_be_switched_off(client):
    lesson = document(VOCAB)
    exercise = next(b for b in lesson["blocks"] if b.get("id") == "where")
    exercise["tolerance"] = {"normalise_whitespace": False}
    from myteacher.lesson.assessment import assess as assess_exercise
    from myteacher.lesson.schema import LessonDocument, ShortAnswerAnswer

    parsed = LessonDocument.model_validate(lesson).exercise("where")
    spaced = ShortAnswerAnswer(type="short_answer", text="¿Dónde  está la estación?")
    exact = ShortAnswerAnswer(type="short_answer", text="¿Dónde está la estación?")
    assert assess_exercise(parsed, spaced, language="es").correct is False
    assert assess_exercise(parsed, exact, language="es").correct is True


def test_case_rule_can_be_switched_off(client):
    lesson = document(VOCAB)
    exercise = next(b for b in lesson["blocks"] if b.get("id") == "song")
    exercise["tolerance"] = {"ignore_case": False}
    from myteacher.lesson.assessment import assess as assess_exercise
    from myteacher.lesson.schema import LessonDocument, ShortAnswerAnswer

    parsed = LessonDocument.model_validate(lesson).exercise("song")
    assert (
        assess_exercise(
            parsed, ShortAnswerAnswer(type="short_answer", text="Canción"), language="es"
        ).correct
        is False
    )


def test_short_answer_solution_is_the_first_accepted_answer(client):
    result = short(client, "song", "cancion")

    assert result["score"] == 0.0
    assert result["solution"] == {
        "type": "short_answer",
        "answer": "canción",
        "explanation": "*Canción* carries an accent on the *o*: can-**ción**.",
    }


def test_a_retryable_wrong_short_answer_withholds_the_solution(client):
    assert short(client, "song", "cancion", reveal="false")["solution"] is None


# Cloze


def test_cloze_scores_per_gap_with_partial_credit(client):
    result = cloze(client, "tomorrow", {"w2": "vamos", "w4": "hermana"})

    assert result["score"] == 0.5
    assert result["correct"] is False
    assert result["items"] == [
        {"id": "w2", "correct": True},
        {"id": "w4", "correct": False},
    ]
    assert result["solution"]["gaps"] == [
        {"id": "w2", "answer": "vamos"},
        {"id": "w4", "answer": "hermano"},
    ]


def test_cloze_all_gaps_right_is_correct(client):
    result = cloze(client, "yesterday", {"v1": "went", "v3": "Saw"}, lesson=VERBS)

    assert result["score"] == 1.0
    assert result["correct"] is True


def test_an_empty_gap_is_wrong(client):
    result = cloze(client, "yesterday", {"v1": "went", "v3": ""}, lesson=VERBS)

    assert result["items"][1] == {"id": "v3", "correct": False}


def test_withheld_cloze_solution_still_says_which_gaps_are_wrong(client):
    result = cloze(client, "tomorrow", {"w2": "voy", "w4": "hermano"}, reveal="false")

    assert result["solution"] is None
    assert [item["correct"] for item in result["items"]] == [False, True]


def test_cloze_answer_must_name_gaps_of_the_exercise(client):
    response = client.post(
        f"/api/lessons/{VOCAB}/exercises/tomorrow/assessment",
        json={"type": "cloze", "gaps": {"nope": "x"}},
    )

    assert response.status_code == 422


def test_served_cloze_hides_the_blanked_words_and_offers_a_bank(client):
    lesson = client.get(f"/api/lessons/{VOCAB}").json()
    exercise = next(b for b in lesson["blocks"] if b.get("id") == "tomorrow")

    assert exercise["segments"] == [
        {"kind": "text", "text": "Mañana"},
        {"kind": "text", "text": " "},
        {"kind": "gap", "id": "w2"},
        {"kind": "text", "text": " a "},
        {"kind": "text", "text": "Madrid"},
        {"kind": "text", "text": " con mi "},
        {"kind": "gap", "id": "w4"},
        {"kind": "text", "text": " "},
        {"kind": "text", "text": "pequeño"},
        {"kind": "text", "text": "."},
    ]
    assert sorted(exercise["word_bank"]) == ["hermana", "hermano", "vamos", "voy"]
    assert exercise["word_bank"] == sorted(exercise["word_bank"])


def test_cloze_without_a_bank_has_none(client):
    lesson = client.get(f"/api/lessons/{VERBS}").json()
    exercise = next(b for b in lesson["blocks"] if b.get("id") == "yesterday")

    assert exercise["word_bank"] is None
    body = json.dumps(lesson, ensure_ascii=False)
    assert "went" not in body
    assert "saw" not in body
    assert '"answer"' not in body


def test_served_short_answer_carries_no_accepted_answers(client):
    body = client.get(f"/api/lessons/{VOCAB}").text

    assert "canción" not in body.replace("*canción*", "")
    assert '"accepted_answers"' not in body


# Second round


def repeat(client, lesson: str, exercise: str, seed: str = "s1") -> dict:
    response = client.post(
        f"/api/lessons/{lesson}/second-round",
        json={"failed_exercise_ids": [exercise], "seed": seed},
    )
    return response.json()["exercises"][0]


TOMORROW_WORDS = {"w1": "Mañana", "w2": "vamos", "w3": "Madrid", "w4": "hermano", "w5": "pequeño"}


def gaps_of(exercise: dict) -> list[str]:
    return [s["id"] for s in exercise["segments"] if s["kind"] == "gap"]


def test_second_round_cloze_blanks_different_words(client):
    for seed in ["s1", "s2", "s3", "s4"]:
        varied = repeat(client, VOCAB, "tomorrow", seed)
        assert len(gaps_of(varied)) == 2
        assert set(gaps_of(varied)) != {"w2", "w4"}
        assert set(gaps_of(varied)) <= {"w1", "w2", "w3", "w4", "w5"}


def test_second_round_cloze_bank_matches_the_new_gaps(client):
    varied = repeat(client, VOCAB, "tomorrow")

    for gap in gaps_of(varied):
        assert TOMORROW_WORDS[gap] in varied["word_bank"]
    assert {"voy", "hermana"} <= set(varied["word_bank"])


def test_second_round_cloze_is_assessed_on_its_new_gaps(client):
    varied = repeat(client, VOCAB, "tomorrow")

    result = cloze(client, "tomorrow", {gap: TOMORROW_WORDS[gap] for gap in gaps_of(varied)})

    assert result["correct"] is True


def test_second_round_short_answer_shows_the_hint_up_front(client):
    first = next(
        b for b in client.get(f"/api/lessons/{VOCAB}").json()["blocks"] if b.get("id") == "song"
    )
    varied = repeat(client, VOCAB, "song")

    assert first["show_hint"] is False
    assert varied["show_hint"] is True
    assert varied["hint"] == first["hint"]


# Validation


def invalid(client, lesson_id: str, exercise_id: str, change) -> None:
    lesson = copy.deepcopy(document(lesson_id))
    change(next(b for b in lesson["blocks"] if b.get("id") == exercise_id))
    assert client.post("/api/lessons/validate", json=lesson).status_code == 422


def test_fixtures_validate(client):
    for lesson_id in [VOCAB, VERBS]:
        assert client.post("/api/lessons/validate", json=document(lesson_id)).status_code == 200


def test_blanked_words_must_be_candidates(client):
    invalid(client, VOCAB, "tomorrow", lambda b: b["blanked"].append("nope"))


def test_a_cloze_blanks_at_least_one_word(client):
    invalid(client, VOCAB, "tomorrow", lambda b: b.update(blanked=[]))


def test_candidate_ids_are_unique(client):
    invalid(client, VOCAB, "tomorrow", lambda b: b["segments"][0].update(id="w2"))


def test_a_short_answer_accepts_at_least_one_answer(client):
    invalid(client, VOCAB, "song", lambda b: b.update(accepted_answers=[]))


def test_unknown_tolerance_rules_are_rejected(client):
    invalid(client, VOCAB, "song", lambda b: b.update(tolerance={"ignore_everything": True}))


def test_a_candidate_id_must_not_give_its_answer_away(client):
    for old, new in [("w2", "vamos"), ("w1", "manana")]:
        lesson = copy.deepcopy(document(VOCAB))
        rename_gap(next(b for b in lesson["blocks"] if b.get("id") == "tomorrow"), old, new)
        assert any("gives its answer away" in msg for msg in validation_errors(client, lesson))


def rename_gap(block: dict, old: str, new: str) -> None:
    """Rename a candidate and its entry in `blanked`, so only the id itself is under test."""
    next(s for s in block["segments"] if s.get("id") == old)["id"] = new
    block["blanked"] = [new if gap == old else gap for gap in block["blanked"]]


def validation_errors(client, lesson: dict) -> list[str]:
    return [e["msg"] for e in client.post("/api/lessons/validate", json=lesson).json()["errors"]]


@pytest.mark.parametrize("identifier", ["went", "gap-went", "went-1", "went2", "past-went-form"])
def test_a_gap_id_containing_its_answer_is_rejected(client, identifier):
    lesson = copy.deepcopy(document(VERBS))
    rename_gap(next(b for b in lesson["blocks"] if b.get("id") == "yesterday"), "v1", identifier)

    assert any("gives its answer away" in msg for msg in validation_errors(client, lesson))


def test_a_gap_id_spelling_an_alternative_is_rejected(client):
    lesson = copy.deepcopy(document(VERBS))
    block = next(b for b in lesson["blocks"] if b.get("id") == "yesterday")
    block["segments"][1]["alternatives"] = ["goed"]
    rename_gap(block, "v1", "goed")

    assert any("gives its answer away" in msg for msg in validation_errors(client, lesson))


def test_short_answers_do_not_block_neutral_ids(client):
    lesson = copy.deepcopy(document(VERBS))
    block = next(b for b in lesson["blocks"] if b.get("id") == "yesterday")
    block["segments"][1]["answer"] = "a"
    rename_gap(block, "v1", "gap-1")

    assert client.post("/api/lessons/validate", json=lesson).status_code == 200


def test_a_cloze_answer_must_fill_every_gap(client):
    for gaps in [{"v1": "went"}, {"v2": "bought"}]:
        response = client.post(
            f"/api/lessons/{VERBS}/exercises/yesterday/assessment",
            json={"type": "cloze", "gaps": gaps},
        )
        assert response.status_code == 422
