"""The teacher closes joining, replaces the join link, and removes or renames participants of a
link run (#120, ADR 0012)."""

import pytest

from tests.helpers import as_student, back_to_teacher
from tests.test_course_access import COLLEAGUE, as_teacher, grant, invite_teachers
from tests.test_course_runs import RUN
from tests.test_courses import create_course
from tests.test_link_runs import check, join, lobby, me, start_link_run
from tests.test_participant_work import (
    as_participant,
    my_release,
    released,
    results_url,
    right,
    submitted,
)
from tests.test_participant_work import run as run_with_material  # noqa: F401 - a fixture


@pytest.fixture
def course(teacher) -> dict:
    return create_course(teacher).json()


@pytest.fixture
def run(teacher, course) -> dict:
    return start_link_run(teacher, course["id"], capacity=2).json()


def joining(client, run_id, open):
    return client.put(f"/api/runs/{run_id}/joining", json={"open": open})


def replace_link(client, run_id):
    return client.post(f"/api/runs/{run_id}/join-link")


def participant_url(run_id, participant_id):
    return f"/api/runs/{run_id}/participants/{participant_id}"


def joined(client, join_token, name="Eva") -> dict:
    client.cookies.clear()
    body = join(client, join_token, name).json()
    back_to_teacher(client)
    return body


# Closing joining


def test_a_closed_run_refuses_newcomers_until_opened_again(teacher, run):
    closed = joining(teacher, run["id"], False)

    assert closed.status_code == 200
    assert closed.json()["joining_open"] is False
    teacher.cookies.clear()
    assert check(teacher, run["join_token"]).json()["closed"] is True
    refused = join(teacher, run["join_token"])
    assert (refused.status_code, refused.json()) == (409, {"detail": "joining_closed"})
    back_to_teacher(teacher)

    assert joining(teacher, run["id"], True).json()["joining_open"] is True
    teacher.cookies.clear()
    assert check(teacher, run["join_token"]).json()["closed"] is False
    assert join(teacher, run["join_token"]).status_code == 201


def test_closing_keeps_those_who_joined_in(teacher, run):
    eva = joined(teacher, run["join_token"])

    joining(teacher, run["id"], False)

    assert me(teacher, eva["token"]).status_code == 200


# Replacing the join link


def test_a_replaced_join_link_stops_working_but_personal_links_keep_working(teacher, run):
    eva = joined(teacher, run["join_token"])

    replaced = replace_link(teacher, run["id"])

    assert replaced.status_code == 200
    new_token = replaced.json()["join_token"]
    assert new_token != run["join_token"]
    teacher.cookies.clear()
    assert check(teacher, run["join_token"]).status_code == 404
    assert join(teacher, run["join_token"]).status_code == 404
    assert join(teacher, new_token, "Adam").status_code == 201
    assert me(teacher, eva["token"]).status_code == 200


# Removing a participant


def test_a_removed_participants_link_is_refused_and_their_place_is_free(teacher, run):
    eva = joined(teacher, run["join_token"])
    joined(teacher, run["join_token"], "Adam")

    removed = teacher.delete(participant_url(run["id"], eva["participant"]["id"]))

    assert removed.status_code == 204
    assert me(teacher, eva["token"]).status_code == 401
    assert [p["name"] for p in lobby(teacher, run["id"]).json()["participants"]] == ["Adam"]
    found = teacher.get(f"/api/runs/{run['id']}").json()
    assert (found["participant_count"], [p["name"] for p in found["participants"]]) == (1, ["Adam"])
    # The run held two; one place is free again.
    teacher.cookies.clear()
    assert join(teacher, run["join_token"], "Pavla").status_code == 201


def test_removing_twice_or_someone_of_another_run_is_not_found(teacher, course, run):
    eva = joined(teacher, run["join_token"])
    other = start_link_run(teacher, course["id"]).json()
    teacher.delete(participant_url(run["id"], eva["participant"]["id"]))

    assert teacher.delete(participant_url(run["id"], eva["participant"]["id"])).status_code == 404
    assert teacher.delete(participant_url(other["id"], eva["participant"]["id"])).status_code == 404


def test_a_removed_participants_answers_stay_with_the_teacher(teacher, run_with_material):  # noqa: F811
    link_run = run_with_material
    release_id = released(teacher, link_run, feedback_mode="at_the_end")
    submitted(teacher, link_run.eva, release_id, right())
    eva = teacher.get(results_url(link_run, release_id)).json()["students"][0]

    teacher.delete(participant_url(link_run.id, eva["id"]))

    assert my_release(teacher, link_run.eva, release_id).status_code == 401
    listed = teacher.get(results_url(link_run, release_id)).json()["students"]
    assert [(s["name"], s["in_run"], s["state"]) for s in listed][0] == (
        "Eva Malá",
        False,
        "submitted",
    )
    [release] = teacher.get(f"/api/runs/{link_run.id}/releases").json()
    assert (release["submitted"], release["total"]) == (0, 2)
    assert teacher.get(f"{results_url(link_run, release_id)}/{eva['id']}").status_code == 200
    headers = as_participant(link_run.jan)
    assert teacher.get("/api/my/releases", headers=headers).status_code == 200


# Renaming a participant


def test_renaming_tells_two_of_the_same_name_apart(teacher, run):
    first = joined(teacher, run["join_token"], "Jan Novák")
    joined(teacher, run["join_token"], "Jan Novák")
    assert [p["name"] for p in lobby(teacher, run["id"]).json()["participants"]] == [
        "Jan Novák (1)",
        "Jan Novák (2)",
    ]

    renamed = teacher.patch(
        participant_url(run["id"], first["participant"]["id"]), json={"name": " Jan Novák st. "}
    )

    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Jan Novák st."
    assert [p["name"] for p in lobby(teacher, run["id"]).json()["participants"]] == [
        "Jan Novák st.",
        "Jan Novák",
    ]
    assert me(teacher, first["token"]).json()["name"] == "Jan Novák st."


def test_a_new_name_has_one_to_sixty_characters(teacher, run):
    eva = joined(teacher, run["join_token"])
    url = participant_url(run["id"], eva["participant"]["id"])

    assert teacher.patch(url, json={"name": "  "}).status_code == 422
    assert teacher.patch(url, json={"name": "x" * 61}).status_code == 422


# Only the run teacher


def test_only_the_run_teacher_changes_the_link_run(teacher, sender, course, run):
    eva = joined(teacher, run["join_token"])
    pid = eva["participant"]["id"]
    invite_teachers(teacher, sender, COLLEAGUE)
    back_to_teacher(teacher)
    grant(teacher, course["id"], COLLEAGUE, "edit")
    calls = [
        lambda: joining(teacher, run["id"], False),
        lambda: replace_link(teacher, run["id"]),
        lambda: teacher.patch(participant_url(run["id"], pid), json={"name": "X"}),
        lambda: teacher.delete(participant_url(run["id"], pid)),
    ]

    as_teacher(teacher, COLLEAGUE)
    assert [call().status_code for call in calls] == [404, 404, 404, 404]
    back_to_teacher(teacher)
    as_student(teacher, sender)
    assert [call().status_code for call in calls] == [403, 403, 403, 403]
    back_to_teacher(teacher)
    assert me(teacher, eva["token"]).json()["name"] == "Eva"


def test_an_enrolled_run_has_none_of_it(teacher, course):
    enrolled = teacher.post(f"/api/courses/{course['id']}/runs", json={"name": RUN}).json()

    assert joining(teacher, enrolled["id"], False).status_code == 404
    assert replace_link(teacher, enrolled["id"]).status_code == 404
    assert enrolled["joining_open"] is True


def test_a_removed_participant_numbers_nobody_who_stays(teacher, run):
    first = joined(teacher, run["join_token"], "Jan Novák")
    joined(teacher, run["join_token"], "Jan Novák")

    teacher.delete(participant_url(run["id"], first["participant"]["id"]))

    assert [p["name"] for p in lobby(teacher, run["id"]).json()["participants"]] == ["Jan Novák"]
