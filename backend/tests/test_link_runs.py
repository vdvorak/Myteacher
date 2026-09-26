from datetime import timedelta

import pytest

from tests.helpers import as_student, back_to_teacher, create_student
from tests.test_course_access import COLLEAGUE, as_teacher, grant, invite_teachers
from tests.test_course_runs import RUN, create_class, runs_of
from tests.test_courses import create_course


def start_link_run(client, course_id, **fields):
    body = {"name": RUN, "mode": "link", "responsible": True, **fields}
    return client.post(f"/api/courses/{course_id}/runs", json=body)


def check(client, token):
    return client.post("/api/join/check", json={"token": token})


def join(client, token, name="Jan Novák"):
    return client.post("/api/join", json={"token": token, "name": name})


def me(client, token):
    return client.get("/api/participant", headers={"X-Participant-Token": token})


def lobby(client, run_id):
    return client.get(f"/api/runs/{run_id}/lobby")


@pytest.fixture
def course(teacher) -> dict:
    return create_course(teacher).json()


@pytest.fixture
def run(teacher, course) -> dict:
    return start_link_run(teacher, course["id"], capacity=3).json()


@pytest.fixture
def stranger(teacher, run):
    """The teacher's client signed out: joining needs no account."""
    teacher.cookies.clear()
    yield teacher
    back_to_teacher(teacher)


# Starting a link run


def test_a_link_run_takes_a_capacity_and_gets_a_join_link(teacher, course):
    started = start_link_run(teacher, course["id"], capacity=24)

    assert started.status_code == 201
    body = started.json()
    assert body["mode"] == "link"
    assert body["capacity"] == 24
    assert len(body["join_token"]) >= 20
    assert body["roster"] == []
    assert body["participant_count"] == 0
    assert teacher.get(f"/api/runs/{body['id']}").json() == body


def test_a_link_run_takes_thirty_unless_told_otherwise(teacher, course):
    assert start_link_run(teacher, course["id"]).json()["capacity"] == 30


def test_the_capacity_is_between_one_and_two_hundred(teacher, course):
    assert start_link_run(teacher, course["id"], capacity=0).status_code == 422
    assert start_link_run(teacher, course["id"], capacity=201).status_code == 422
    assert start_link_run(teacher, course["id"], capacity=200).status_code == 201


def test_the_teacher_confirms_they_are_responsible_for_the_people_they_share_it_with(
    teacher, course
):
    assert start_link_run(teacher, course["id"], responsible=False).status_code == 422
    body = {"name": RUN, "mode": "link"}
    assert teacher.post(f"/api/courses/{course['id']}/runs", json=body).status_code == 422


def test_an_enrolled_run_has_no_capacity_nor_join_link(teacher, course):
    url = f"/api/courses/{course['id']}/runs"
    started = teacher.post(url, json={"name": RUN}).json()

    assert (started["mode"], started["capacity"], started["join_token"]) == ("enrolled", None, None)
    assert teacher.post(url, json={"name": RUN, "capacity": 10}).status_code == 422
    assert teacher.post(url, json={"name": RUN, "responsible": True}).status_code == 422


def test_each_link_run_has_its_own_join_link(teacher, course, run):
    other = start_link_run(teacher, course["id"]).json()

    assert other["join_token"] != run["join_token"]


def test_a_link_run_takes_no_enrolment(teacher, sender, run):
    klass = create_class(teacher)
    student = create_student(teacher).json()

    refused = teacher.put(f"/api/runs/{run['id']}/classes/{klass['id']}")
    assert (refused.status_code, refused.json()) == (409, {"detail": "link_run"})
    assert teacher.put(f"/api/runs/{run['id']}/students/{student['id']}").status_code == 409


# Joining through the join link


def test_the_join_link_names_the_run_and_its_course_without_signing_in(stranger, course, run):
    found = check(stranger, run["join_token"])

    assert found.status_code == 200
    assert found.json() == {
        "run_id": run["id"],
        "run": RUN,
        "course": course["name"],
        "full": False,
    }


def test_an_unknown_join_link_leads_nowhere(stranger, run):
    assert check(stranger, "not-a-link").status_code == 404
    assert join(stranger, "not-a-link").json() == {"detail": "unknown_link"}


def test_joining_under_a_name_gives_a_personal_link(stranger, course, run):
    joined = join(stranger, run["join_token"], "  Jan Novák ")

    assert joined.status_code == 201
    body = joined.json()
    assert len(body["token"]) >= 40
    assert body["participant"] == {
        "id": body["participant"]["id"],
        "name": "Jan Novák",
        "joined_at": "2026-09-24T08:00:00Z",
        "run_id": run["id"],
        "run": RUN,
        "course": {"id": course["id"], "name": course["name"]},
    }


def test_a_name_has_one_to_sixty_characters(stranger, run):
    assert join(stranger, run["join_token"], "   ").status_code == 422
    assert join(stranger, run["join_token"], "x" * 61).status_code == 422
    assert join(stranger, run["join_token"], "x" * 60).status_code == 201


def test_two_people_may_share_a_name(stranger, run):
    first = join(stranger, run["join_token"]).json()
    second = join(stranger, run["join_token"]).json()

    assert first["participant"]["id"] != second["participant"]["id"]
    assert first["token"] != second["token"]


def test_a_full_run_refuses_one_more(stranger, run):
    for name in ("Jan", "Eva", "Petr"):
        assert join(stranger, run["join_token"], name).status_code == 201

    refused = join(stranger, run["join_token"], "Pavla")

    assert (refused.status_code, refused.json()) == (409, {"detail": "run_full"})
    assert check(stranger, run["join_token"]).json()["full"] is True


# The personal link


def test_the_personal_link_identifies_the_participant(stranger, run):
    joined = join(stranger, run["join_token"], "Eva").json()
    join(stranger, run["join_token"], "Petr")

    found = me(stranger, joined["token"])

    assert found.status_code == 200
    assert found.json() == joined["participant"]


def test_a_wrong_or_missing_personal_link_is_refused(stranger, run):
    join(stranger, run["join_token"])

    assert me(stranger, "not-a-token").json() == {"detail": "unknown_participant"}
    assert stranger.get("/api/participant").status_code == 401


def test_the_join_link_is_not_a_personal_link(stranger, run):
    assert me(stranger, run["join_token"]).status_code == 401


# The lobby


def test_the_run_teacher_sees_who_joined_in_order(teacher, clock, run):
    teacher.cookies.clear()
    join(teacher, run["join_token"], "Eva")
    clock.now += timedelta(minutes=2)
    join(teacher, run["join_token"], "Adam")
    back_to_teacher(teacher)

    found = lobby(teacher, run["id"])

    assert found.status_code == 200
    body = found.json()
    assert body == {
        "capacity": 3,
        "participants": [
            {
                "id": body["participants"][0]["id"],
                "name": "Eva",
                "joined_at": "2026-09-24T08:00:00Z",
            },
            {
                "id": body["participants"][1]["id"],
                "name": "Adam",
                "joined_at": "2026-09-24T08:02:00Z",
            },
        ],
    }


def test_the_participants_count_as_the_runs_size(teacher, course, run):
    teacher.cookies.clear()
    join(teacher, run["join_token"], "Eva")
    join(teacher, run["join_token"], "Adam")
    back_to_teacher(teacher)

    assert teacher.get(f"/api/runs/{run['id']}").json()["participant_count"] == 2
    listed = {"id": run["id"], "name": RUN, "roster_size": 2, "mode": "link"}
    assert runs_of(teacher, course["id"]).json() == [listed]
    taught = teacher.get("/api/runs").json()
    assert [(r["roster_size"], r["mode"]) for r in taught] == [(2, "link")]


def test_participants_of_a_link_run_do_the_home_checklists_students_step(teacher, run):
    assert teacher.get("/api/home").json()["checklist"]["students"] is False
    teacher.cookies.clear()
    join(teacher, run["join_token"], "Eva")
    back_to_teacher(teacher)

    assert teacher.get("/api/home").json()["checklist"]["students"] is True


def test_only_the_run_teacher_sees_the_lobby(teacher, sender, course, run):
    invite_teachers(teacher, sender, COLLEAGUE)
    back_to_teacher(teacher)
    grant(teacher, course["id"], COLLEAGUE, "edit")
    as_teacher(teacher, COLLEAGUE)
    assert lobby(teacher, run["id"]).status_code == 404
    teacher.cookies.clear()
    assert lobby(teacher, run["id"]).status_code == 401
    back_to_teacher(teacher)
    as_student(teacher, sender)
    assert lobby(teacher, run["id"]).status_code == 403


def test_an_enrolled_run_has_no_lobby(teacher, course):
    enrolled = teacher.post(f"/api/courses/{course['id']}/runs", json={"name": RUN}).json()

    assert lobby(teacher, enrolled["id"]).status_code == 404
