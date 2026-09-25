# The tests take the `course` fixture imported from the export tests as an argument.
# ruff: noqa: F811
import pytest

from tests.helpers import TEACHER, as_student
from tests.test_classroom_materials import materials_url
from tests.test_concept_maps import map_url
from tests.test_course_access import COLLEAGUE, THIRD, as_teacher, grant, invite_teachers
from tests.test_course_export import course, export, unpacked  # noqa: F401 - `course` is a fixture
from tests.test_reference_documents import documents_url
from tests.test_topics import topics_url


def fork(client, course_id):
    return client.post(f"/api/courses/{course_id}/fork")


def comparable(document: dict) -> dict:
    """What must be equal between a course and its fork: all but the time of the export."""
    return {k: v for k, v in document.items() if k != "exported_at"}


@pytest.fixture
def forker(teacher, course):
    """The colleague, given the fork right and signed in."""
    grant(teacher, course["course"], COLLEAGUE, "fork")
    as_teacher(teacher, COLLEAGUE)
    return teacher


def test_a_fork_is_a_new_course_of_the_forking_teacher_recording_its_origin(forker, course):
    forked = fork(forker, course["course"])

    assert forked.status_code == 201
    body = forked.json()
    assert body["id"] != course["course"]
    me = forker.get("/api/auth/me").json()
    assert body["owner_id"] == me["id"]
    assert body["access"] == "owner"
    assert body["forked_from_id"] == course["course"]
    assert body["name"] == "Španělština 2.B"
    assert forker.get(f"/api/courses/{body['id']}/access").json() == []
    assert body["id"] in {c["id"] for c in forker.get("/api/courses").json()}


def test_export_then_import_round_trips_the_course(forker, course):
    original, original_files = unpacked(export(forker, course["course"]))

    forked = fork(forker, course["course"]).json()

    copy, copy_files = unpacked(export(forker, forked["id"]))
    assert comparable(copy) == comparable(original)
    assert copy_files == original_files


def test_forked_concepts_and_records_get_their_own_identifiers(forker, course):
    forked = fork(forker, course["course"]).json()
    original_topic = course["second"]
    copy_topic = forker.get(topics_url(forked["id"])).json()[1]["id"]

    original = forker.get(map_url(course["course"], original_topic)).json()
    copy = forker.get(map_url(forked["id"], copy_topic)).json()

    assert copy_topic != original_topic
    assert copy["state"] == "approved"
    assert [c["name"] for c in copy["concepts"]] == [c["name"] for c in original["concepts"]]
    assert not {c["id"] for c in copy["concepts"]} & {c["id"] for c in original["concepts"]}
    hablar, actions = copy["concepts"]
    assert actions["prerequisite_ids"] == [hablar["id"]]


def test_the_forks_material_and_documents_work_on_their_own(forker, course):
    forked = fork(forker, course["course"]).json()
    topic = (forked["id"], forker.get(topics_url(forked["id"])).json()[1]["id"])

    [material] = forker.get(materials_url(*topic)).json()
    detail = forker.get(f"{materials_url(*topic)}/{material['id']}").json()
    assert detail["lesson"]["id"] == f"material-{material['id']}-1"
    # Students are not copied with a course.
    assert detail["target_student_ids"] == []
    answer = {"type": "multiple_choice", "option_id": "a"}
    assessed = forker.post(
        f"{materials_url(*topic)}/{material['id']}/exercises/hablar/assessment", json=answer
    )
    assert assessed.json()["correct"] is True
    [document] = forker.get(documents_url(*topic)).json()
    passages = forker.get(f"{documents_url(*topic)}/{document['id']}").json()["passages"]
    [source] = forker.get(f"/api/courses/{forked['id']}/sources").json()
    assert passages[0]["citations"][0]["source_id"] == source["id"]
    assert passages[0]["citations"][0]["source_name"] == "Učebnice 3.txt"


def test_the_fork_and_the_original_do_not_follow_each_other(teacher, forker, course):
    forked = fork(forker, course["course"]).json()
    copy_topic = forker.get(topics_url(forked["id"])).json()[0]["id"]
    forker.patch(f"{topics_url(forked['id'])}/{copy_topic}", json={"name": "Presente (copia)"})

    as_teacher(teacher, TEACHER)
    teacher.patch(f"{topics_url(course['course'])}/{course['first']}", json={"name": "Presente 2"})
    teacher.patch(f"/api/courses/{course['course']}/brief", json={"level": "B1"})

    assert teacher.get(topics_url(course["course"])).json()[0]["name"] == "Presente 2"
    as_teacher(teacher, COLLEAGUE)
    assert teacher.get(topics_url(forked["id"])).json()[0]["name"] == "Presente (copia)"
    assert teacher.get(f"/api/courses/{forked['id']}").json()["brief"]["level"] is None


def test_no_generation_job_is_copied(forker, course):
    forked = fork(forker, course["course"]).json()

    topic = (forked["id"], forker.get(topics_url(forked["id"])).json()[1]["id"])
    [material] = forker.get(materials_url(*topic)).json()
    assert material["job"] is None


@pytest.mark.parametrize("right", ["fork", "edit"])
def test_fork_and_edit_rights_may_fork(teacher, course, right):
    grant(teacher, course["course"], COLLEAGUE, right)
    as_teacher(teacher, COLLEAGUE)

    assert fork(teacher, course["course"]).status_code == 201


def test_the_owner_may_fork_their_own_course(teacher, course):
    assert fork(teacher, course["course"]).json()["forked_from_id"] == course["course"]


def test_a_viewer_without_the_fork_right_is_refused(teacher, sender, course):
    as_teacher(teacher, COLLEAGUE)
    assert fork(teacher, course["course"]).status_code == 403

    invite_teachers(teacher, sender, THIRD)
    as_teacher(teacher, THIRD)
    assert fork(teacher, course["course"]).status_code == 404

    as_student(teacher, sender, "petr@skola.example")
    assert fork(teacher, course["course"]).status_code == 403


def test_the_origin_is_forgotten_when_it_is_deleted_but_the_fork_stays(
    teacher,
    forker,
    course,
    admin_settings,
):
    from sqlalchemy import delete

    from myteacher.courses.models import Course
    from myteacher.persistence import open_session
    from tests.helpers import create_engine_for

    forked = fork(forker, course["course"]).json()
    with open_session(create_engine_for(admin_settings)) as db:
        db.execute(delete(Course).where(Course.id == course["course"]))
        db.commit()

    assert forker.get(f"/api/courses/{forked['id']}").json()["forked_from_id"] is None


# Reading archives that do not hold together


def rezipped(document: dict, files: dict[str, bytes]) -> bytes:
    import io
    import json
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zipped:
        zipped.writestr("course.json", json.dumps(document))
        for name, content in files.items():
            zipped.writestr(name, content)
    return buffer.getvalue()


def broken(document: dict, where: str) -> dict:
    import copy

    document = copy.deepcopy(document)
    topic = document["topics"][1]
    concepts = topic["concept_map"]["concepts"]
    documents = topic["reference_documents"][0]["versions"]
    materials = topic["classroom_materials"][0]["versions"]
    if where == "duplicate concept key":
        concepts[1]["key"] = concepts[0]["key"]
    elif where == "self prerequisite":
        concepts[0]["prerequisites"] = [concepts[0]["key"]]
    elif where == "repeated prerequisite":
        concepts[1]["prerequisites"] = [concepts[0]["key"]] * 2
    elif where == "cycle":
        concepts[0]["prerequisites"] = [concepts[1]["key"]]
    elif where == "duplicate version number":
        documents.append(documents[0])
    elif where == "unknown previous version":
        materials[0]["previous"] = 7
    elif where == "duplicate source key":
        document["sources"].append({**document["sources"][0], "file": None})
    elif where == "long topic name":
        topic["name"] = "x" * 201
    elif where == "long addition":
        topic["additions"]["notes"] = "x" * 2001
    elif where == "unknown addition":
        topic["additions"]["level"] = "B1"
    return document


@pytest.mark.parametrize(
    "where",
    [
        "duplicate concept key",
        "self prerequisite",
        "repeated prerequisite",
        "cycle",
        "duplicate version number",
        "unknown previous version",
        "duplicate source key",
        "long topic name",
        "long addition",
        "unknown addition",
    ],
)
def test_an_archive_that_does_not_hold_together_is_refused(teacher, course, where):
    from myteacher.courses.archive import ArchiveInvalid, read

    document, files = unpacked(export(teacher, course["course"]))
    assert read(rezipped(document, files))

    with pytest.raises(ArchiveInvalid):
        read(rezipped(broken(document, where), files))


def test_an_unreadable_zip_is_refused(teacher, course, monkeypatch):
    import zipfile

    from myteacher.courses.archive import ArchiveInvalid, read

    def encrypted(*args, **kwargs):
        raise RuntimeError("File is encrypted, password required for extraction")

    monkeypatch.setattr(zipfile.ZipFile, "read", encrypted)
    with pytest.raises(ArchiveInvalid):
        read(b"PK")
    with pytest.raises(ArchiveInvalid):
        read(b"not a zip")
