"""A student completes a released classroom material as an attempt the server owns (ADR 0011):
it counts tries, decides when a solution is revealed, pins variants and lays items out (#19)."""

from dataclasses import dataclass
from datetime import timedelta

import pytest
from sqlalchemy import select

from myteacher.courses.models import ConceptMap
from myteacher.persistence import open_session
from myteacher.runs.models import Assessment, AssessmentConcept, Attempt, AttemptDraft
from tests.helpers import (
    OTHER_STUDENT,
    STUDENT,
    STUDENT_PASSWORD,
    accept,
    back_to_teacher,
    create_engine_for,
    invited_student,
    sign_in,
)
from tests.test_classroom_materials import EXPLANATION, choice, generated, materials_url
from tests.test_concept_maps import concept_url, map_url
from tests.test_course_runs import add_member, create_class, enrol_class, start_run
from tests.test_courses import create_course
from tests.test_erasure import as_admin, erase
from tests.test_interview import add_key
from tests.test_reference_documents import approve_map
from tests.test_releases import edit, release
from tests.test_topics import add

CLOZE = {
    "type": "cloze",
    "id": "gaps",
    "prompt": "Fill the gap.",
    "segments": [
        {"kind": "text", "text": "Yo "},
        {"kind": "candidate", "id": "g1", "answer": "soy"},
        {"kind": "text", "text": " de "},
        {"kind": "candidate", "id": "g2", "answer": "Praga"},
        {"kind": "text", "text": "."},
    ],
    "blanked": ["g1"],
}
MATCHING = {
    "type": "matching",
    "id": "pairs",
    "prompt": "Match.",
    "pairs": [
        {"id": "p1", "left": "sí", "right": "yes"},
        {"id": "p2", "left": "no", "right": "no"},
    ],
}
ORDERING = {
    "type": "token_ordering",
    "id": "order",
    "prompt": "Order the words.",
    "tokens": [{"id": "a", "text": "Yo"}, {"id": "b", "text": "soy"}, {"id": "c", "text": "Ana"}],
    "accepted_orders": [["a", "b", "c"]],
}
SELECTION = {
    "type": "token_selection",
    "id": "select",
    "prompt": "Tap the stressed syllable.",
    "granularity": "syllable",
    "items": [
        {"id": "cancion", "text": "canción", "tokens": ["can", "ción"], "expected": [1]},
        {"id": "arbol", "text": "árbol", "tokens": ["ár", "bol"], "expected": [0]},
    ],
    "max_selections": 1,
}
WRITING = {
    "type": "free_text",
    "id": "write",
    "prompt": "Write about yourself.",
    "rubric": {"criteria": [{"id": "content", "description": "Says who they are.", "points": 1}]},
}
MATERIAL = {
    "title": "Pretérito in class",
    "blocks": [
        EXPLANATION,
        choice("hablar", "Ayer yo ___ con Ana.", "hablé", "hablo"),
        CLOZE,
        MATCHING,
        ORDERING,
        SELECTION,
        WRITING,
    ],
}
# Public ids are ranked by text: right items "no" r1, "yes" r2; tokens "Ana" t1, "soy" t2, "Yo" t3.
PAIRING = ["r2", "r1"]
ACCEPTED_ORDER = ["t3", "t2", "t1"]
RIGHT = {
    "hablar": {"type": "multiple_choice", "option_id": "a"},
    "gaps": {"type": "cloze", "gaps": {"g1": "soy"}},
    "pairs": {"type": "matching", "pairs": {"p1": "r2", "p2": "r1"}},
    "order": {"type": "token_ordering", "order": ACCEPTED_ORDER},
    "select": {"type": "token_selection", "item_id": "cancion", "selected": [1]},
    "write": {"type": "free_text", "text": "Soy Ana y vivo en Madrid."},
}
WRONG = {
    "hablar": {"type": "multiple_choice", "option_id": "b"},
    "gaps": {"type": "cloze", "gaps": {"g1": "estoy"}},
    "pairs": {"type": "matching", "pairs": {"p1": "r1", "p2": "r2"}},
    "order": {"type": "token_ordering", "order": ["t1", "t2", "t3"]},
    "select": {"type": "token_selection", "item_id": "cancion", "selected": [0]},
}
CLOSED = ["hablar", "gaps", "pairs", "order", "select"]


@dataclass
class Course:
    id: int
    topic: tuple[int, int]
    material: int
    run: int
    klass: int
    jana: int
    petr: int


@pytest.fixture
def course(teacher, sender, models) -> Course:
    """A run with Jana and Petr in its class and a material of every catalog type to release;
    both students have signed in once."""
    add_key(teacher)
    cid = create_course(teacher).json()["id"]
    tid = add(teacher, cid, "Pretérito indefinido").json()[0]["id"]
    approve_map(teacher, cid, tid)
    material = generated(teacher, (cid, tid), models, output=MATERIAL)
    jana, jana_token = invited_student(teacher, sender, STUDENT, name="Jana Veselá")
    petr, petr_token = invited_student(teacher, sender, OTHER_STUDENT, name="Petr Malý")
    run = start_run(teacher, cid).json()
    klass = create_class(teacher)
    for student in (jana, petr):
        add_member(teacher, klass["id"], student["id"])
    enrol_class(teacher, run["id"], klass["id"])
    for token in (jana_token, petr_token):
        teacher.cookies.clear()
        assert accept(teacher, token, STUDENT_PASSWORD).status_code == 200
    back_to_teacher(teacher)
    return Course(cid, (cid, tid), material["id"], run["id"], klass["id"], jana["id"], petr["id"])


def released(client, course: Course, **settings) -> int:
    response = release(client, course.run, course.material, **settings)
    assert response.status_code == 201, response.json()
    return response.json()["id"]


def as_student(client, email=STUDENT) -> None:
    client.cookies.clear()
    assert sign_in(client, email, STUDENT_PASSWORD).status_code == 200


def my_releases(client) -> list[dict]:
    return client.get("/api/my/releases").json()


def my_release(client, release_id) -> dict:
    return client.get(f"/api/my/releases/{release_id}").json()


def start(client, release_id):
    return client.post(f"/api/my/releases/{release_id}/attempts")


def started(client, release_id) -> dict:
    response = start(client, release_id)
    assert response.status_code in (200, 201), response.json()
    return response.json()


def draft(client, attempt_id, exercise_id, answer, round="first"):
    return client.put(
        f"/api/attempts/{attempt_id}/rounds/{round}/drafts/{exercise_id}", json=answer
    )


def answer(client, attempt_id, exercise_id, given, round="first"):
    return client.post(
        f"/api/attempts/{attempt_id}/rounds/{round}/exercises/{exercise_id}/tries", json=given
    )


def submit(client, attempt_id, answers=None, round="first"):
    return client.post(
        f"/api/attempts/{attempt_id}/rounds/{round}/submission", json={"answers": answers or {}}
    )


def outcomes(submitted) -> dict[str, dict]:
    return {key: done["result"] for key, done in submitted.json()["tries"].items()}


def attempt(client, attempt_id) -> dict:
    return client.get(f"/api/attempts/{attempt_id}").json()


def blocks(lesson: dict) -> dict[str, dict]:
    return {block["id"]: block for block in lesson["blocks"] if "id" in block}


def answer_all(client, attempt_id, answers: dict) -> None:
    for exercise_id, given in answers.items():
        assert answer(client, attempt_id, exercise_id, given).status_code == 200


# What a student sees


def test_a_student_sees_the_releases_meant_for_them(teacher, course, clock):
    for_everyone = released(teacher, course, due_at="2026-10-01T18:00:00Z")
    released(teacher, course, audience="chosen", student_ids=[course.petr])

    as_student(teacher)
    listed = my_releases(teacher)

    assert listed == [
        {
            "id": for_everyone,
            "title": MATERIAL["title"],
            "topic": "Pretérito indefinido",
            "run": "Španělština 2.B 2026/27",
            "released_at": "2026-09-24T08:00:00Z",
            "due_at": "2026-10-01T18:00:00Z",
            "state": "not_started",
            "late": False,
            "counting_attempt_id": None,
        }
    ]


def test_a_student_who_left_the_run_loses_the_release_and_the_attempt(teacher, course):
    release_id = released(teacher, course)
    as_student(teacher)
    started_attempt = started(teacher, release_id)

    back_to_teacher(teacher)
    teacher.delete(f"/api/classes/{course.klass}/members/{course.jana}")

    as_student(teacher)
    assert my_releases(teacher) == []
    assert teacher.get(f"/api/my/releases/{release_id}").status_code == 404
    assert start(teacher, release_id).status_code == 404
    assert teacher.get(f"/api/attempts/{started_attempt['id']}").status_code == 404
    assert answer(teacher, started_attempt["id"], "hablar", RIGHT["hablar"]).status_code == 404


def test_a_student_cannot_open_a_release_chosen_for_someone_else(teacher, course):
    release_id = released(teacher, course, audience="chosen", student_ids=[course.petr])

    as_student(teacher)

    assert teacher.get(f"/api/my/releases/{release_id}").status_code == 404
    assert start(teacher, release_id).status_code == 404


def test_a_student_cannot_touch_another_students_attempt(teacher, course):
    release_id = released(teacher, course)
    as_student(teacher)
    janas = started(teacher, release_id)

    as_student(teacher, OTHER_STUDENT)

    assert teacher.get(f"/api/attempts/{janas['id']}").status_code == 404
    assert draft(teacher, janas["id"], "hablar", RIGHT["hablar"]).status_code == 404
    assert answer(teacher, janas["id"], "hablar", RIGHT["hablar"]).status_code == 404


def test_teachers_have_no_releases_of_their_own_to_complete(teacher, course):
    assert teacher.get("/api/my/releases").status_code == 403


# Opening a release starts an attempt


def test_opening_a_release_starts_an_attempt_on_its_version_without_the_answer_key(teacher, course):
    release_id = released(teacher, course, feedback_mode="at_the_end")
    edit(teacher, course.topic, course.material, {"title": "Changed", "blocks": MATERIAL["blocks"]})

    as_student(teacher)
    response = start(teacher, release_id)

    assert response.status_code == 201
    body = response.json()
    assert body["number"] == 1
    assert body["lesson"]["title"] == MATERIAL["title"]
    assert body["lesson"]["feedback_mode"] == "at_the_end"
    assert list(blocks(body["lesson"])) == ["hablar", "gaps", "pairs", "order", "select", "write"]
    for key in ("correct_option_id", "accepted_orders", "blanked", "rubric", "expected"):
        assert key not in response.text
    assert body["first"]["answers"] == {}
    assert body["second"] is None
    assert body["submitted_at"] is None
    assert my_releases(teacher)[0]["state"] == "in_progress"


def test_opening_the_release_again_resumes_the_attempt(teacher, course):
    release_id = released(teacher, course)
    as_student(teacher)
    first = started(teacher, release_id)

    again = start(teacher, release_id)

    assert again.status_code == 200
    assert again.json()["id"] == first["id"]
    assert again.json()["seed"] == first["seed"]
    assert my_release(teacher, release_id)["attempt"]["id"] == first["id"]


def test_the_layouts_served_never_give_the_answer_away(teacher, course):
    release_id = released(teacher, course)
    as_student(teacher)

    layouts = started(teacher, release_id)["first"]["layouts"]

    assert sorted(layouts) == ["order", "pairs"]
    assert layouts["pairs"] != PAIRING
    assert sorted(layouts["pairs"]) == ["r1", "r2"]
    assert layouts["order"] != ACCEPTED_ORDER
    assert sorted(layouts["order"]) == ["t1", "t2", "t3"]


# Answers are saved as they are given


def test_a_draft_is_saved_and_comes_back_on_another_device(teacher, course):
    release_id = released(teacher, course, feedback_mode="at_the_end")
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]

    started_writing = {"type": "free_text", "text": "Soy"}
    assert draft(teacher, attempt_id, "write", started_writing).status_code == 204
    assert draft(teacher, attempt_id, "write", RIGHT["write"]).status_code == 204
    assert draft(teacher, attempt_id, "gaps", RIGHT["gaps"]).status_code == 204

    as_student(teacher)
    answers = my_release(teacher, release_id)["attempt"]["first"]["answers"]
    assert answers == {
        "gaps": {"draft": RIGHT["gaps"], "tries": []},
        "write": {"draft": RIGHT["write"], "tries": []},
    }


def test_a_draft_must_fit_its_exercise(teacher, course):
    release_id = released(teacher, course)
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]

    assert draft(teacher, attempt_id, "hablar", RIGHT["gaps"]).status_code == 422
    assert draft(teacher, attempt_id, "nothing", RIGHT["hablar"]).status_code == 404
    assert draft(teacher, attempt_id, "hablar", RIGHT["hablar"], round="second").status_code == 404


# Immediate feedback: the attempt counts the tries


def test_a_wrong_first_try_comes_back_without_its_solution_and_the_second_reveals_it(
    teacher, course
):
    release_id = released(teacher, course)
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]

    first = answer(teacher, attempt_id, "hablar", WRONG["hablar"])
    second = answer(teacher, attempt_id, "hablar", WRONG["hablar"])

    assert first.status_code == 200
    assert first.json()["correct"] is False
    assert first.json()["solution"] is None
    assert second.json()["solution"]["option_id"] == "a"
    tries = attempt(teacher, attempt_id)["first"]["answers"]["hablar"]["tries"]
    assert [t["result"]["solution"] is None for t in tries] == [True, False]


def test_no_try_is_taken_after_the_last_one(teacher, course):
    release_id = released(teacher, course)
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]
    answer(teacher, attempt_id, "hablar", WRONG["hablar"])
    answer(teacher, attempt_id, "hablar", WRONG["hablar"])
    answer(teacher, attempt_id, "gaps", RIGHT["gaps"])
    answer(teacher, attempt_id, "write", RIGHT["write"])

    for exercise_id in ("hablar", "gaps", "write"):
        refused = answer(teacher, attempt_id, exercise_id, RIGHT[exercise_id])
        assert refused.status_code == 409, exercise_id
        assert refused.json() == {"detail": "exercise_locked"}
    assert len(attempt(teacher, attempt_id)["first"]["answers"]["hablar"]["tries"]) == 2


def test_nothing_is_assessed_before_submission_at_the_end(teacher, course):
    release_id = released(teacher, course, feedback_mode="at_the_end")
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]

    refused = answer(teacher, attempt_id, "hablar", RIGHT["hablar"])

    assert refused.status_code == 409
    assert refused.json() == {"detail": "assessed_at_the_end"}


def test_the_last_try_of_the_first_pass_submits_the_attempt(teacher, course, clock):
    release_id = released(teacher, course)
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]

    answer_all(teacher, attempt_id, {k: v for k, v in RIGHT.items() if k != "write"})
    assert attempt(teacher, attempt_id)["submitted_at"] is None
    clock.now += timedelta(minutes=20)
    pending = answer(teacher, attempt_id, "write", RIGHT["write"])

    assert pending.json()["status"] == "pending"
    body = attempt(teacher, attempt_id)
    assert body["submitted_at"] == "2026-09-24T08:20:00Z"
    assert body["late"] is False
    assert my_releases(teacher)[0]["state"] == "submitted"
    assert my_releases(teacher)[0]["counting_attempt_id"] == attempt_id


def test_a_cloze_answer_fills_exactly_the_gaps_of_the_attempts_variant(teacher, course):
    release_id = released(teacher, course)
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]

    # Stateless assessment took any candidate as long as the count matched; g2 is visible text.
    refused = answer(teacher, attempt_id, "gaps", {"type": "cloze", "gaps": {"g2": "Praga"}})

    assert refused.status_code == 422
    assert "tries" not in attempt(teacher, attempt_id)["first"]["answers"].get("gaps", {})


def test_a_selection_answers_the_item_the_attempt_asks(teacher, course):
    release_id = released(teacher, course)
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]

    other_item = {"type": "token_selection", "item_id": "arbol", "selected": [0]}

    assert answer(teacher, attempt_id, "select", other_item).status_code == 422


# Feedback at the end: submitting assesses


def test_submitting_assesses_closed_answers_and_leaves_open_ones_waiting(teacher, course, clock):
    release_id = released(teacher, course, feedback_mode="at_the_end")
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]
    draft(teacher, attempt_id, "hablar", WRONG["hablar"])
    draft(teacher, attempt_id, "gaps", RIGHT["gaps"])

    response = submit(
        teacher,
        attempt_id,
        {key: RIGHT[key] for key in ("pairs", "order", "select", "write")},
    )

    assert response.status_code == 200
    assessed = outcomes(response)
    assert sorted(assessed) == ["gaps", "hablar", "order", "pairs", "select", "write"]
    assert assessed["hablar"]["correct"] is False
    assert assessed["hablar"]["solution"]["option_id"] == "a"
    assert all(assessed[key]["correct"] for key in ("gaps", "pairs", "order", "select"))
    assert assessed["write"] == {
        "status": "pending",
        "exercise_id": "write",
        "reason": "not_deterministically_assessable",
    }
    body = attempt(teacher, attempt_id)
    assert body["first"]["submitted"] is True
    assert body["submitted_at"] == "2026-09-24T08:00:00Z"
    assert body["first"]["answers"]["hablar"]["tries"][0]["answer"] == WRONG["hablar"]


def test_an_open_exercise_may_be_left_empty_but_not_a_closed_one(teacher, course):
    release_id = released(teacher, course, feedback_mode="at_the_end")
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]
    closed = {key: RIGHT[key] for key in CLOSED}

    missing = submit(teacher, attempt_id, {k: v for k, v in closed.items() if k != "order"})
    assert missing.status_code == 422
    assert missing.json() == {"detail": "unanswered"}
    assert attempt(teacher, attempt_id)["submitted_at"] is None

    submitted = submit(teacher, attempt_id, closed)
    assert submitted.status_code == 200
    assert "write" not in outcomes(submitted)


def test_a_submitted_round_takes_no_more_answers(teacher, course):
    release_id = released(teacher, course, feedback_mode="at_the_end")
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]
    submit(teacher, attempt_id, {key: RIGHT[key] for key in CLOSED})

    for refused in (
        draft(teacher, attempt_id, "hablar", WRONG["hablar"]),
        submit(teacher, attempt_id, {key: RIGHT[key] for key in CLOSED}),
    ):
        assert refused.status_code == 409
        assert refused.json() == {"detail": "round_closed"}


def test_submitting_is_for_feedback_at_the_end(teacher, course):
    release_id = released(teacher, course)
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]

    refused = submit(teacher, attempt_id, {key: RIGHT[key] for key in CLOSED})

    assert refused.status_code == 409
    assert refused.json() == {"detail": "assessed_immediately"}


# Solutions follow the release


def test_a_release_hiding_solutions_withholds_them_from_wrong_answers_only(teacher, course):
    at_the_end = released(teacher, course, feedback_mode="at_the_end", show_solutions=False)
    immediate = released(teacher, course, show_solutions=False)
    as_student(teacher)

    submitted = outcomes(
        submit(teacher, started(teacher, at_the_end)["id"], {**WRONG, "gaps": RIGHT["gaps"]})
    )
    attempt_id = started(teacher, immediate)["id"]
    answer(teacher, attempt_id, "hablar", WRONG["hablar"])
    last = answer(teacher, attempt_id, "hablar", WRONG["hablar"]).json()
    right = answer(teacher, attempt_id, "gaps", RIGHT["gaps"]).json()

    # A right answer's solution gives nothing away, and its explanation teaches.
    assert submitted["gaps"]["solution"]["gaps"] == [{"id": "g1", "answer": "soy"}]
    assert right["solution"]["gaps"] == [{"id": "g1", "answer": "soy"}]
    assert {submitted[key]["solution"] for key in CLOSED if key != "gaps"} == {None}
    assert last["solution"] is None
    tries = attempt(teacher, attempt_id)["first"]["answers"]
    assert [t["result"]["solution"] for t in tries["hablar"]["tries"]] == [None, None]
    assert tries["gaps"]["tries"][0]["result"]["solution"] == right["solution"]


def test_a_right_answer_comes_with_its_explanation_when_solutions_are_hidden(teacher, course):
    release_id = released(teacher, course, show_solutions=False)
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]

    right = answer(teacher, attempt_id, "hablar", RIGHT["hablar"]).json()

    assert right["solution"] == {
        "type": "multiple_choice",
        "option_id": "a",
        "explanation": "It is *hablé*.",
    }


# The due date


def test_a_submission_after_the_due_date_is_marked_late(teacher, course, clock):
    release_id = released(
        teacher, course, feedback_mode="at_the_end", due_at="2026-09-25T08:00:00Z"
    )
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]
    clock.now += timedelta(days=2)

    submit(teacher, attempt_id, {key: RIGHT[key] for key in CLOSED})

    assert attempt(teacher, attempt_id)["late"] is True
    assert my_releases(teacher)[0]["late"] is True


def test_a_release_refusing_late_work_takes_nothing_after_the_due_date(teacher, course, clock):
    at_the_end = released(
        teacher,
        course,
        feedback_mode="at_the_end",
        due_at="2026-09-25T08:00:00Z",
        late_submissions="refuse",
    )
    immediate = released(teacher, course, due_at="2026-09-25T08:00:00Z", late_submissions="refuse")
    untouched = released(teacher, course, due_at="2026-09-25T08:00:00Z", late_submissions="refuse")
    as_student(teacher)
    open_at_the_end = started(teacher, at_the_end)["id"]
    open_immediate = started(teacher, immediate)["id"]
    clock.now += timedelta(days=2)

    for refused in (
        submit(teacher, open_at_the_end, {key: RIGHT[key] for key in CLOSED}),
        draft(teacher, open_at_the_end, "hablar", RIGHT["hablar"]),
        answer(teacher, open_immediate, "hablar", RIGHT["hablar"]),
        start(teacher, untouched),
    ):
        assert refused.status_code == 409
        assert refused.json() == {"detail": "past_due"}
    assert my_release(teacher, untouched)["can_start"] is False


# Repeated attempts


def test_a_release_takes_one_attempt_unless_it_allows_more(teacher, course):
    release_id = released(teacher, course, feedback_mode="at_the_end")
    as_student(teacher)
    submit(teacher, started(teacher, release_id)["id"], {key: RIGHT[key] for key in CLOSED})

    refused = start(teacher, release_id)

    assert refused.status_code == 409
    assert refused.json() == {"detail": "no_more_attempts"}
    assert my_release(teacher, release_id)["can_start"] is False


def test_a_repeated_attempt_starts_afresh_and_the_last_submitted_counts(teacher, course):
    release_id = released(teacher, course, feedback_mode="at_the_end", attempts="repeated")
    as_student(teacher)
    first = started(teacher, release_id)
    submit(teacher, first["id"], {key: WRONG[key] for key in CLOSED})
    assert my_release(teacher, release_id)["can_start"] is True

    second = start(teacher, release_id)

    assert second.status_code == 201
    assert second.json()["number"] == 2
    assert second.json()["id"] != first["id"]
    assert second.json()["first"]["answers"] == {}
    assert my_releases(teacher)[0]["state"] == "in_progress"
    assert my_releases(teacher)[0]["counting_attempt_id"] == first["id"]

    submit(teacher, second.json()["id"], {key: RIGHT[key] for key in CLOSED})
    assert my_releases(teacher)[0]["counting_attempt_id"] == second.json()["id"]
    assert my_release(teacher, release_id)["attempt"]["id"] == second.json()["id"]


# The second round


def test_the_second_round_repeats_what_failed_first_time_with_the_variant_the_attempt_holds(
    teacher, course
):
    release_id = released(teacher, course)
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]
    answer_all(teacher, attempt_id, {**RIGHT, "hablar": WRONG["hablar"], "gaps": WRONG["gaps"]})
    answer_all(teacher, attempt_id, {"hablar": WRONG["hablar"], "gaps": RIGHT["gaps"]})

    second = teacher.post(f"/api/attempts/{attempt_id}/second-round")

    assert second.status_code == 200
    repeats = {exercise["id"]: exercise for exercise in second.json()["exercises"]}
    assert list(repeats) == ["hablar", "gaps"]
    gaps = [s["id"] for s in repeats["gaps"]["segments"] if s["kind"] == "gap"]
    assert gaps == ["g2"]
    assert answer(teacher, attempt_id, "gaps", RIGHT["gaps"], round="second").status_code == 422
    repeat = answer(
        teacher, attempt_id, "gaps", {"type": "cloze", "gaps": {"g2": "Praga"}}, round="second"
    )
    assert repeat.json()["correct"] is True
    again = teacher.post(f"/api/attempts/{attempt_id}/second-round").json()
    assert again["exercises"] == second.json()["exercises"]
    assert len(again["answers"]["gaps"]["tries"]) == 1
    assert attempt(teacher, attempt_id)["second"]["exercises"] == second.json()["exercises"]


def test_the_second_round_waits_for_the_first_pass(teacher, course):
    release_id = released(teacher, course)
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]

    refused = teacher.post(f"/api/attempts/{attempt_id}/second-round")

    assert refused.status_code == 409
    assert refused.json() == {"detail": "not_submitted"}


def test_a_second_round_at_the_end_is_submitted_as_a_round(teacher, course):
    release_id = released(teacher, course, feedback_mode="at_the_end")
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]
    submit(teacher, attempt_id, {**{key: RIGHT[key] for key in CLOSED}, "hablar": WRONG["hablar"]})
    teacher.post(f"/api/attempts/{attempt_id}/second-round")

    submitted = submit(teacher, attempt_id, {"hablar": RIGHT["hablar"]}, round="second")

    assert submitted.status_code == 200
    assert outcomes(submitted)["hablar"]["correct"] is True
    assert attempt(teacher, attempt_id)["second"]["submitted"] is True


# Assessments are about concepts


def test_assessments_record_the_concepts_of_the_topics_map(teacher, course, settings):
    concept_ids = [c["id"] for c in teacher.get(map_url(*course.topic)).json()["concepts"]]
    release_id = released(teacher, course)
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]
    answer(teacher, attempt_id, "hablar", RIGHT["hablar"])

    with open_session(create_engine_for(settings)) as db:
        assessment = db.scalars(select(Assessment)).one()
        recorded = db.scalars(
            select(AssessmentConcept.concept_id).where(
                AssessmentConcept.assessment_id == assessment.id
            )
        ).all()
    assert assessment.exercise_id == "hablar"
    assert sorted(recorded) == sorted(concept_ids)


def test_an_assessment_records_the_current_concepts_of_a_reopened_map(teacher, course, settings):
    concepts = teacher.get(map_url(*course.topic)).json()["concepts"]
    kept, retired = concepts[0]["id"], concepts[1]["id"]
    teacher.post(f"{map_url(*course.topic)}/reopening")
    assert teacher.delete(concept_url(course.topic, retired)).status_code == 200
    release_id = released(teacher, course)
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]

    answer(teacher, attempt_id, "hablar", RIGHT["hablar"])

    with open_session(create_engine_for(settings)) as db:
        recorded = db.scalars(select(AssessmentConcept.concept_id)).all()
    assert recorded == [kept]


def test_an_assessment_records_no_concepts_of_a_map_never_approved(teacher, course, settings):
    release_id = released(teacher, course)
    with open_session(create_engine_for(settings)) as db:
        # As if the map were still the assistant's first proposal, which no teacher reviewed.
        concept_map = db.scalars(select(ConceptMap)).one()
        concept_map.state, concept_map.approved_before = "draft", False
        db.commit()
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]

    answer(teacher, attempt_id, "hablar", RIGHT["hablar"])

    with open_session(create_engine_for(settings)) as db:
        assert db.scalars(select(AssessmentConcept)).all() == []


def test_a_discarded_material_still_opens_for_its_release(teacher, course):
    release_id = released(teacher, course)
    teacher.delete(f"{materials_url(*course.topic)}/{course.material}")

    as_student(teacher)

    assert start(teacher, release_id).status_code == 201


def test_erasing_a_student_removes_their_attempts_and_answers(teacher, course, settings):
    release_id = released(teacher, course)
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]
    draft(teacher, attempt_id, "gaps", RIGHT["gaps"])
    answer(teacher, attempt_id, "hablar", RIGHT["hablar"])

    as_admin(teacher)
    assert erase(teacher, course.jana, "Jana Veselá").status_code == 204

    with open_session(create_engine_for(settings)) as db:
        for table in (Attempt, AttemptDraft, Assessment, AssessmentConcept):
            assert db.scalars(select(table)).all() == [], table.__tablename__


def test_a_try_racing_another_for_the_same_place_is_refused_not_failed(
    teacher, course, monkeypatch
):
    from myteacher.runs import attempts

    release_id = released(teacher, course)
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]
    answer(teacher, attempt_id, "hablar", WRONG["hablar"])
    # As if a try from another device landed after this one had counted the tries.
    monkeypatch.setattr(attempts, "tries_of", lambda db, attempt, round: {})

    refused = answer(teacher, attempt_id, "hablar", RIGHT["hablar"])

    assert refused.status_code == 409
    assert refused.json() == {"detail": "exercise_locked"}


def test_a_submission_racing_another_is_refused_not_failed(teacher, course, monkeypatch):
    from myteacher.runs import attempts

    release_id = released(teacher, course, feedback_mode="at_the_end")
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]
    submit(teacher, attempt_id, {key: RIGHT[key] for key in CLOSED})
    # As if the other submission committed after this one had looked.
    monkeypatch.setattr(attempts, "_closed", lambda attempt, round: False)

    refused = submit(teacher, attempt_id, {key: RIGHT[key] for key in CLOSED})

    assert refused.status_code == 409
    assert refused.json() == {"detail": "round_closed"}


def test_a_submission_answers_with_what_it_assessed_drafts_saved_before_included(teacher, course):
    release_id = released(teacher, course, feedback_mode="at_the_end")
    as_student(teacher)
    attempt_id = started(teacher, release_id)["id"]
    draft(teacher, attempt_id, "write", RIGHT["write"])

    submitted = submit(teacher, attempt_id, {key: RIGHT[key] for key in CLOSED})

    assert submitted.json()["tries"]["write"]["answer"] == RIGHT["write"]
    assert submitted.json()["tries"]["hablar"]["answer"] == RIGHT["hablar"]
