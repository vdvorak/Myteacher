import pytest

from tests.helpers import OTHER_STUDENT, TEACHER, as_student, back_to_teacher, create_student
from tests.test_classroom_materials import MATERIAL, SHORTER, generated, materials_url
from tests.test_course_access import COLLEAGUE, THIRD, as_teacher, grant, invite_teachers
from tests.test_course_runs import add_member, create_class, enrol_class, start_run
from tests.test_courses import create_course
from tests.test_interview import add_key
from tests.test_reference_documents import approve_map
from tests.test_topics import add

DEFAULTS = {
    "feedback_mode": "immediate",
    "due_at": None,
    "late_submissions": "accept",
    "attempts": "one",
    "show_solutions": True,
}


def releases_url(run_id: int) -> str:
    return f"/api/runs/{run_id}/releases"


def release(client, run_id, material_id, version=1, **body):
    return client.post(
        releases_url(run_id), json={"material_id": material_id, "version": version, **body}
    )


def edit(client, topic, material_id, lesson, based_on=1):
    response = client.post(
        f"{materials_url(*topic)}/{material_id}/versions", json={**lesson, "based_on": based_on}
    )
    assert response.status_code == 201, response.json()


@pytest.fixture
def colleagues(teacher, sender) -> dict[str, int]:
    ids = invite_teachers(teacher, sender, COLLEAGUE, THIRD)
    ids[TEACHER] = teacher.get("/api/auth/me").json()["id"]
    return ids


@pytest.fixture
def topic(teacher) -> tuple[int, int]:
    add_key(teacher)
    cid = create_course(teacher).json()["id"]
    tid = add(teacher, cid, "Pretérito indefinido").json()[0]["id"]
    approve_map(teacher, cid, tid)
    return cid, tid


@pytest.fixture
def students(teacher) -> dict[str, int]:
    jana = create_student(teacher, name="Jana Veselá").json()["id"]
    petr = create_student(teacher, OTHER_STUDENT, name="Petr Malý").json()["id"]
    return {"jana": jana, "petr": petr}


@pytest.fixture
def run(teacher, topic, students) -> dict:
    """A run of the topic's course with the class 2.B, where Jana and Petr are."""
    run = start_run(teacher, topic[0]).json()
    klass = create_class(teacher)
    add_member(teacher, klass["id"], students["jana"])
    add_member(teacher, klass["id"], students["petr"])
    enrol_class(teacher, run["id"], klass["id"])
    run["class_id"] = klass["id"]
    return run


@pytest.fixture
def material(teacher, topic, models) -> dict:
    return generated(teacher, topic, models)


# Releasing


def test_a_material_version_is_released_to_the_whole_run_with_default_settings(
    teacher, run, material, clock
):
    me = teacher.get("/api/auth/me").json()

    released = release(teacher, run["id"], material["id"])

    assert released.status_code == 201
    body = released.json()
    assert body == {
        "id": body["id"],
        "material_id": material["id"],
        "title": MATERIAL["title"],
        "topic": "Pretérito indefinido",
        "version": 1,
        "audience": "run",
        "students": [],
        "released_by_id": me["id"],
        "released_at": "2026-09-24T08:00:00Z",
        "retracted_at": None,
        "retraction_reason": None,
        **DEFAULTS,
    }
    assert teacher.get(releases_url(run["id"])).json() == [body]


def test_every_setting_is_stored(teacher, run, material):
    body = release(
        teacher,
        run["id"],
        material["id"],
        feedback_mode="at_the_end",
        due_at="2026-10-01T20:00:00+02:00",
        late_submissions="refuse",
        attempts="repeated",
        show_solutions=False,
    ).json()

    assert {key: body[key] for key in DEFAULTS} == {
        "feedback_mode": "at_the_end",
        "due_at": "2026-10-01T18:00:00Z",
        "late_submissions": "refuse",
        "attempts": "repeated",
        "show_solutions": False,
    }


def test_settings_must_be_known_values(teacher, run, material):
    for wrong in (
        {"feedback_mode": "never"},
        {"late_submissions": "maybe"},
        {"attempts": "three"},
        {"audience": "everyone"},
        {"due_at": "tomorrow"},
        {"due_at": "2026-10-01T20:00:00"},
    ):
        assert release(teacher, run["id"], material["id"], **wrong).status_code == 422, wrong


def test_a_due_date_in_the_past_is_refused(teacher, run, material):
    refused = release(teacher, run["id"], material["id"], due_at="2026-09-23T08:00:00Z")

    assert refused.status_code == 422
    assert refused.json() == {"detail": "due_in_the_past"}


# The version is frozen


def test_editing_the_material_later_leaves_the_release_on_its_version(
    teacher, topic, run, material
):
    release(teacher, run["id"], material["id"])

    edit(teacher, topic, material["id"], SHORTER)
    later = release(teacher, run["id"], material["id"], version=2).json()

    listed = teacher.get(releases_url(run["id"])).json()
    assert [(r["version"], r["title"]) for r in listed] == [
        (1, MATERIAL["title"]),
        (2, SHORTER["title"]),
    ]
    assert later["version"] == 2


def test_only_an_existing_version_of_a_material_of_the_runs_course_is_released(
    teacher, topic, run, material, models
):
    other_course = create_course(teacher, name="Francouzština").json()["id"]
    other_topic = add(teacher, other_course, "Passé composé").json()[0]["id"]
    approve_map(teacher, other_course, other_topic)
    foreign = generated(teacher, (other_course, other_topic), models)

    assert release(teacher, run["id"], foreign["id"]).json() == {"detail": "unknown_material"}
    assert release(teacher, run["id"], 999).json() == {"detail": "unknown_material"}
    assert release(teacher, run["id"], material["id"], version=2).json() == {
        "detail": "unknown_version"
    }
    teacher.delete(f"{materials_url(*topic)}/{material['id']}")
    assert release(teacher, run["id"], material["id"]).json() == {"detail": "unknown_material"}


def test_a_topic_with_released_material_cannot_be_removed(teacher, topic, run, material):
    release(teacher, run["id"], material["id"])

    refused = teacher.delete(f"/api/courses/{topic[0]}/topics/{topic[1]}")

    assert refused.status_code == 409
    assert refused.json() == {"detail": "topic_released"}
    assert teacher.get(releases_url(run["id"])).json()[0]["version"] == 1


def test_a_discarded_material_stays_released(teacher, topic, run, material):
    release(teacher, run["id"], material["id"])

    teacher.delete(f"{materials_url(*topic)}/{material['id']}")

    assert teacher.get(releases_url(run["id"])).json()[0]["title"] == MATERIAL["title"]


# Who gets it


def test_a_material_is_released_to_chosen_students_of_the_run(teacher, run, material, students):
    body = release(
        teacher, run["id"], material["id"], audience="chosen", student_ids=[students["petr"]]
    ).json()

    assert body["audience"] == "chosen"
    assert body["students"] == [{"id": students["petr"], "name": "Petr Malý"}]


def test_chosen_students_must_be_on_the_roster(teacher, run, material, students):
    outsider = create_student(teacher, "ota@skola.example", name="Ota Starý").json()["id"]

    for body in (
        {"audience": "chosen", "student_ids": []},
        {"audience": "chosen", "student_ids": [outsider]},
        {"audience": "chosen", "student_ids": [999]},
    ):
        refused = release(teacher, run["id"], material["id"], **body)
        assert refused.status_code == 422, body
    assert release(teacher, run["id"], material["id"], audience="chosen").status_code == 422
    assert teacher.get(releases_url(run["id"])).json() == []


def test_students_are_chosen_only_for_a_chosen_audience(teacher, run, material, students):
    refused = release(teacher, run["id"], material["id"], student_ids=[students["jana"]])

    assert refused.status_code == 422


def test_a_student_who_joins_a_class_later_gets_a_whole_run_release(
    teacher, run, material, students
):
    released = release(teacher, run["id"], material["id"]).json()
    eva = create_student(teacher, "eva@skola.example", name="Eva Malá").json()["id"]

    add_member(teacher, run["class_id"], eva)

    recipients = teacher.get(f"{releases_url(run['id'])}/{released['id']}/recipients")
    assert recipients.status_code == 200
    assert [s["name"] for s in recipients.json()] == ["Eva Malá", "Jana Veselá", "Petr Malý"]


def test_the_recipients_of_a_chosen_release_are_the_chosen_students_still_in_the_run(
    teacher, run, material, students
):
    released = release(
        teacher,
        run["id"],
        material["id"],
        audience="chosen",
        student_ids=[students["jana"], students["petr"]],
    ).json()

    teacher.delete(f"/api/classes/{run['class_id']}/members/{students['petr']}")

    recipients = teacher.get(f"{releases_url(run['id'])}/{released['id']}/recipients").json()
    assert [s["name"] for s in recipients] == ["Jana Veselá"]


# The run teacher alone


def test_only_the_run_teacher_releases_and_sees_releases(teacher, colleagues, topic, run, material):
    grant(teacher, topic[0], COLLEAGUE, "edit")

    as_teacher(teacher, COLLEAGUE)
    assert release(teacher, run["id"], material["id"]).status_code == 404
    assert teacher.get(releases_url(run["id"])).status_code == 404


def test_a_student_cannot_release(teacher, sender, run, material):
    as_student(teacher, sender, "eva@skola.example")

    assert release(teacher, run["id"], material["id"]).status_code == 403


def test_the_run_teacher_releases_even_without_the_edit_right_now(
    teacher, colleagues, topic, material
):
    grant(teacher, topic[0], COLLEAGUE, "edit")
    as_teacher(teacher, COLLEAGUE)
    theirs = start_run(teacher, topic[0]).json()
    back_to_teacher(teacher)
    grant(teacher, topic[0], COLLEAGUE, "view")

    as_teacher(teacher, COLLEAGUE)
    assert release(teacher, theirs["id"], material["id"]).status_code == 201


# What may be released


def test_the_run_lists_the_materials_of_its_course_to_release(
    teacher, topic, run, material, students
):
    teacher.put(
        f"{materials_url(*topic)}/{material['id']}/targets",
        json={"student_ids": [students["petr"]]},
    )
    edit(teacher, topic, material["id"], SHORTER)

    listed = teacher.get(f"/api/runs/{run['id']}/materials")

    assert listed.status_code == 200
    assert listed.json() == [
        {
            "id": material["id"],
            "topic": "Pretérito indefinido",
            "title": SHORTER["title"],
            "versions": [2, 1],
            "target_student_ids": [students["petr"]],
        }
    ]


def test_a_release_landing_while_the_topic_is_removed_still_keeps_the_topic(
    teacher, topic, run, material, monkeypatch
):
    from myteacher.runs import releases

    release(teacher, run["id"], material["id"])
    # As if the release committed after the check had looked.
    monkeypatch.setattr(releases, "topic_released", lambda db, topic: False)

    refused = teacher.delete(f"/api/courses/{topic[0]}/topics/{topic[1]}")

    assert refused.status_code == 409
    assert refused.json() == {"detail": "topic_released"}
    assert len(teacher.get(f"/api/courses/{topic[0]}/topics").json()) == 1
