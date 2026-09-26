"""Participants of a link run do its released material through their personal link, and the run
teacher sees, assesses and publishes their work as for students (#119, ADR 0012)."""

from dataclasses import dataclass

import pytest

from tests.helpers import STUDENT, back_to_teacher, invited_student
from tests.test_attempts import CLOSED, MATERIAL, RIGHT, WRONG
from tests.test_classroom_materials import generated
from tests.test_courses import create_course
from tests.test_interview import add_key
from tests.test_link_runs import join, start_link_run
from tests.test_open_assessment import ASSESSED
from tests.test_reference_documents import approve_map
from tests.test_releases import release
from tests.test_topics import add


@dataclass
class LinkRun:
    id: int
    course: int
    material: int
    join_token: str
    # Personal link tokens by the name typed; two people typed "Jan Novák".
    eva: str
    jan: str
    jan_again: str


def as_participant(token: str) -> dict:
    return {"X-Participant-Token": token}


def joined(client, run: LinkRun, name: str) -> tuple[int, str]:
    client.cookies.clear()
    body = join(client, run.join_token, name).json()
    back_to_teacher(client)
    return body["participant"]["id"], body["token"]


@pytest.fixture
def run(teacher, models) -> LinkRun:
    add_key(teacher)
    course_id = create_course(teacher).json()["id"]
    topic_id = add(teacher, course_id, "Pretérito indefinido").json()[0]["id"]
    approve_map(teacher, course_id, topic_id)
    material = generated(teacher, (course_id, topic_id), models, output=MATERIAL)
    started = start_link_run(teacher, course_id).json()
    found = LinkRun(started["id"], course_id, material["id"], started["join_token"], "", "", "")
    found.eva = joined(teacher, found, "Eva Malá")[1]
    found.jan = joined(teacher, found, "Jan Novák")[1]
    found.jan_again = joined(teacher, found, "Jan Novák")[1]
    return found


def released(client, run: LinkRun, **settings) -> int:
    response = release(client, run.id, run.material, **settings)
    assert response.status_code == 201, response.json()
    return response.json()["id"]


def my_releases(client, token) -> list[dict]:
    response = client.get("/api/my/releases", headers=as_participant(token))
    assert response.status_code == 200, response.json()
    return response.json()


def my_release(client, token, release_id):
    return client.get(f"/api/my/releases/{release_id}", headers=as_participant(token))


def started(client, token, release_id) -> dict:
    response = client.post(f"/api/my/releases/{release_id}/attempts", headers=as_participant(token))
    assert response.status_code in (200, 201), response.json()
    return response.json()


def submit(client, token, attempt_id, answers):
    return client.post(
        f"/api/attempts/{attempt_id}/rounds/first/submission",
        json={"answers": answers},
        headers=as_participant(token),
    )


def submitted(client, token, release_id, answers) -> int:
    attempt_id = started(client, token, release_id)["id"]
    assert submit(client, token, attempt_id, answers).status_code == 200
    return attempt_id


def right(text="Soy Ana y vivo en Madrid.") -> dict:
    return {**{k: RIGHT[k] for k in CLOSED}, "write": {"type": "free_text", "text": text}}


def results_url(run: LinkRun, release_id: int) -> str:
    return f"/api/runs/{run.id}/releases/{release_id}/results"


# The participant's work


def test_a_participant_sees_what_is_released_in_their_run(teacher, run):
    release_id = released(teacher, run, due_at="2026-10-01T18:00:00Z")

    [listed] = my_releases(teacher, run.eva)

    assert listed["id"] == release_id
    assert listed["title"] == MATERIAL["title"]
    assert (listed["state"], listed["can_start"]) == ("not_started", True)
    assert listed["due_at"] == "2026-10-01T18:00:00Z"


def test_a_participant_does_the_work_and_sees_their_score(teacher, run):
    release_id = released(teacher, run, feedback_mode="at_the_end")

    submitted(teacher, run.eva, release_id, right())

    found = my_release(teacher, run.eva, release_id).json()
    assert found["state"] == "submitted"
    assert found["score"] == {"points": 5.0, "total": 6, "pending": 1}
    assert found["attempt"]["first"]["submitted"] is True


def test_the_second_round_works_for_a_participant(teacher, run):
    release_id = released(teacher, run, feedback_mode="at_the_end")
    attempt_id = submitted(teacher, run.eva, release_id, {**WRONG, "write": right()["write"]})

    second = teacher.post(
        f"/api/attempts/{attempt_id}/second-round", headers=as_participant(run.eva)
    )

    assert second.status_code == 200
    assert {e["id"] for e in second.json()["exercises"]} == set(CLOSED)


def test_someone_who_joins_later_sees_earlier_releases(teacher, run):
    release_id = released(teacher, run)

    _, late = joined(teacher, run, "Pavla")

    assert [r["id"] for r in my_releases(teacher, late)] == [release_id]


def test_a_participant_reaches_neither_another_run_nor_another_participants_work(
    teacher, run, models
):
    release_id = released(teacher, run)
    evas = started(teacher, run.eva, release_id)["id"]
    other = start_link_run(teacher, run.course).json()
    teacher.cookies.clear()
    stranger = join(teacher, other["join_token"], "Cizí").json()["token"]
    back_to_teacher(teacher)

    assert my_releases(teacher, stranger) == []
    assert my_release(teacher, stranger, release_id).status_code == 404
    jans = teacher.get(f"/api/attempts/{evas}", headers=as_participant(run.jan))
    assert jans.status_code == 404


def test_a_student_does_not_reach_a_link_runs_work_even_with_a_participants_id(
    teacher, sender, run
):
    student, _ = invited_student(teacher, sender, STUDENT)
    # Ids of students and participants overlap: make a participant with the student's id.
    for number in range(student["id"]):
        participant_id, _ = joined(teacher, run, f"Host {number}")
        if participant_id >= student["id"]:
            break
    release_id = released(teacher, run)

    teacher.cookies.clear()
    assert teacher.get(f"/api/my/releases/{release_id}").status_code in (401, 404)


def test_a_wrong_personal_link_is_refused(teacher, run):
    released(teacher, run)

    refused = teacher.get("/api/my/releases", headers=as_participant("not-a-token"))

    assert (refused.status_code, refused.json()) == (401, {"detail": "unknown_participant"})


def test_a_link_run_releases_to_all_its_participants_only(teacher, run):
    refused = release(teacher, run.id, run.material, audience="chosen", student_ids=[1])

    assert (refused.status_code, refused.json()) == (422, {"detail": "not_in_run"})


# The teacher's pages


def test_the_run_names_its_participants_numbering_a_name_typed_twice(teacher, run):
    found = teacher.get(f"/api/runs/{run.id}").json()

    assert [p["name"] for p in found["participants"]] == [
        "Eva Malá",
        "Jan Novák (1)",
        "Jan Novák (2)",
    ]


def test_the_release_counts_its_participants(teacher, run):
    release_id = released(teacher, run, feedback_mode="at_the_end")
    submitted(teacher, run.eva, release_id, right())

    [listed] = teacher.get(f"/api/runs/{run.id}/releases").json()
    assert (listed["submitted"], listed["total"]) == (1, 3)
    recipients = teacher.get(f"/api/runs/{run.id}/releases/{release_id}/recipients").json()
    assert [r["name"] for r in recipients] == ["Eva Malá", "Jan Novák (1)", "Jan Novák (2)"]
    [taught] = teacher.get("/api/runs").json()
    assert (taught["latest_release"]["submitted"], taught["latest_release"]["total"]) == (1, 3)


def test_results_show_participants_by_name(teacher, run):
    release_id = released(teacher, run, feedback_mode="at_the_end")
    submitted(teacher, run.jan_again, release_id, right())

    found = teacher.get(results_url(run, release_id)).json()

    assert [(s["name"], s["state"]) for s in found["students"]] == [
        ("Eva Malá", "not_started"),
        ("Jan Novák (1)", "not_started"),
        ("Jan Novák (2)", "submitted"),
    ]
    second_jan = found["students"][2]
    detail = teacher.get(f"{results_url(run, release_id)}/{second_jan['id']}").json()
    assert detail["student"] == {"id": second_jan["id"], "name": "Jan Novák (2)", "in_run": True}
    assert len(detail["attempts"]) == 1


def test_the_teacher_retracts_a_participants_attempt(teacher, run):
    release_id = released(teacher, run, feedback_mode="at_the_end")
    submitted(teacher, run.eva, release_id, right())
    eva = teacher.get(results_url(run, release_id)).json()["students"][0]

    retracted = teacher.post(
        f"/api/runs/{run.id}/releases/{release_id}/students/{eva['id']}/retraction",
        json={"reason": "Someone else did it."},
    )

    assert retracted.status_code == 204
    found = my_release(teacher, run.eva, release_id).json()
    assert found["retraction"] == {"reason": "Someone else did it.", "whole_release": False}
    assert found["can_start"] is True  # a retracted attempt counts for nothing


def test_open_answers_of_participants_are_assessed_and_published_to_them(teacher, run, models):
    release_id = released(teacher, run, feedback_mode="at_the_end")
    submitted(teacher, run.jan, release_id, right())
    models.script(ASSESSED)

    started_job = teacher.post(f"/api/runs/{run.id}/releases/{release_id}/open-assessment")
    assert started_job.status_code == 202
    [answer] = teacher.get(f"/api/runs/{run.id}/releases/{release_id}/open-answers").json()
    assert answer["student"]["name"] == "Jan Novák (1)"
    assert teacher.post(f"/api/runs/{run.id}/releases/{release_id}/publication").json() == {
        "published": 1
    }

    found = my_release(teacher, run.jan, release_id).json()
    assert found["new_assessment"] is True
    assert found["score"] == {"points": 6.0, "total": 6, "pending": 0}
