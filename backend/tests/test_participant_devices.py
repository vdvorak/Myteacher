"""A personal link works on one device at a time: opening it on another device moves the work
there, and the teacher sees how many devices each participant used (#121, ADR 0012)."""

import pytest

from myteacher.runs.participants import MAX_DEVICES
from tests.helpers import back_to_teacher
from tests.test_courses import create_course
from tests.test_link_runs import join, lobby, start_link_run
from tests.test_participant_work import released, started
from tests.test_participant_work import run as run_with_material  # noqa: F401 - a fixture

PHONE = "phone-5f1c"
LAPTOP = "laptop-9a2e"


def on(device: str | None, token: str) -> dict:
    headers = {"X-Participant-Token": token}
    if device is not None:
        headers["X-Participant-Device"] = device
    return headers


def open_link(client, device, token):
    return client.post("/api/participant/open", headers=on(device, token))


def me(client, device, token):
    """What the participant's home asks for over and over."""
    return client.get("/api/my/releases", headers=on(device, token))


def devices(client, run_id) -> list[int]:
    return [p["devices"] for p in lobby(client, run_id).json()["participants"]]


@pytest.fixture
def run(teacher) -> dict:
    course_id = create_course(teacher).json()["id"]
    return start_link_run(teacher, course_id).json()


@pytest.fixture
def eva(teacher, run) -> str:
    """Eva joined on her phone."""
    teacher.cookies.clear()
    joined = teacher.post(
        "/api/join",
        json={"token": run["join_token"], "name": "Eva"},
        headers={"X-Participant-Device": PHONE},
    )
    back_to_teacher(teacher)
    assert joined.status_code == 201
    return joined.json()["token"]


def test_the_device_that_joined_holds_the_work(teacher, run, eva):
    assert me(teacher, PHONE, eva).status_code == 200
    assert devices(teacher, run["id"]) == [1]


def test_opening_the_link_on_another_device_moves_the_work_there(teacher, run, eva):
    opened = open_link(teacher, LAPTOP, eva)

    assert opened.status_code == 200
    assert opened.json()["name"] == "Eva"
    # Who the link belongs to is no secret to the device it was open on before.
    assert teacher.get("/api/participant", headers=on(PHONE, eva)).json()["name"] == "Eva"
    assert me(teacher, LAPTOP, eva).status_code == 200
    refused = me(teacher, PHONE, eva)
    assert (refused.status_code, refused.json()) == (409, {"detail": "other_device"})
    assert devices(teacher, run["id"]) == [2]


def test_opening_it_again_on_the_first_device_moves_it_back_and_counts_no_new_device(
    teacher, run, eva
):
    open_link(teacher, LAPTOP, eva)

    assert open_link(teacher, PHONE, eva).status_code == 200

    assert me(teacher, PHONE, eva).status_code == 200
    assert me(teacher, LAPTOP, eva).status_code == 409
    assert devices(teacher, run["id"]) == [2]
    # Opening it where it already is changes nothing.
    open_link(teacher, PHONE, eva)
    assert devices(teacher, run["id"]) == [2]


def test_a_request_naming_no_device_is_from_another_one(teacher, eva):
    assert me(teacher, None, eva).json() == {"detail": "other_device"}
    assert open_link(teacher, None, eva).status_code == 422


def test_joining_names_a_device_or_none_at_all(teacher, run):
    teacher.cookies.clear()
    refused = teacher.post(
        "/api/join",
        json={"token": run["join_token"], "name": "Adam"},
        headers={"X-Participant-Device": ""},
    )
    back_to_teacher(teacher)

    assert refused.status_code == 422


def test_devices_are_counted_up_to_a_limit_and_the_work_still_moves(teacher, run, eva):
    for number in range(MAX_DEVICES + 5):
        assert open_link(teacher, f"device-{number}", eva).status_code == 200

    assert devices(teacher, run["id"]) == [MAX_DEVICES]
    assert me(teacher, f"device-{MAX_DEVICES + 4}", eva).status_code == 200
    assert me(teacher, PHONE, eva).status_code == 409


def test_an_unknown_link_stays_unknown_whatever_the_device(teacher, eva):
    refused = open_link(teacher, LAPTOP, "not-a-link")

    assert (refused.status_code, refused.json()) == (401, {"detail": "unknown_participant"})


def test_a_participant_who_joined_naming_no_device_is_held_by_the_first_one_to_open_it(
    teacher, run
):
    teacher.cookies.clear()
    token = join(teacher, run["join_token"], "Adam").json()["token"]
    back_to_teacher(teacher)
    assert devices(teacher, run["id"]) == [0]
    assert me(teacher, None, token).status_code == 200

    open_link(teacher, LAPTOP, token)

    assert me(teacher, None, token).status_code == 409
    assert devices(teacher, run["id"]) == [1]


def test_the_old_devices_draft_does_not_overwrite_the_newer_one(teacher, run_with_material):  # noqa: F811
    link_run = run_with_material
    release_id = released(teacher, link_run, feedback_mode="at_the_end")
    open_link(teacher, PHONE, link_run.eva)
    attempt_id = started(teacher, link_run.eva, release_id, headers=on(PHONE, link_run.eva))["id"]
    url = f"/api/attempts/{attempt_id}/rounds/first/drafts/write"
    newer = {"type": "free_text", "text": "Soy Eva."}
    older = {"type": "free_text", "text": "Soy"}
    open_link(teacher, LAPTOP, link_run.eva)
    assert teacher.put(url, json=newer, headers=on(LAPTOP, link_run.eva)).status_code == 204

    refused = teacher.put(url, json=older, headers=on(PHONE, link_run.eva))

    assert (refused.status_code, refused.json()) == (409, {"detail": "other_device"})
    attempt = started(teacher, link_run.eva, release_id, headers=on(LAPTOP, link_run.eva))
    assert attempt["first"]["answers"]["write"]["draft"] == newer
