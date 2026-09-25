"""What the course and topic pages need to show their steps (#101): the facts each step's state
is read from, the two steps the teacher confirms by hand, and whether a draft was reviewed."""

import pytest

from tests.test_classroom_materials import MATERIAL, materials_url
from tests.test_classroom_materials import generated as generated_material
from tests.test_concept_maps import map_url
from tests.test_courses import create_course
from tests.test_interview import BRIEF, ROUND_ONE, add_key, answer, start
from tests.test_reference_documents import approve_map, cited, documents_url
from tests.test_reference_documents import generated as generated_document
from tests.test_sources import paste, upload
from tests.test_topics import add, topics_url


@pytest.fixture
def course(teacher) -> int:
    add_key(teacher)
    return create_course(teacher).json()["id"]


def setup_of(client, course_id) -> dict:
    return client.get(f"/api/courses/{course_id}").json()["setup"]


# The course's steps


def test_a_new_course_has_no_step_done(teacher, course):
    assert setup_of(teacher, course) == {
        "interview_finished": False,
        "brief_confirmed": False,
        "read_sources": 0,
        "sources_skipped": False,
    }


def test_a_finished_interview_is_the_brief_step_done(teacher, course, models):
    models.script(ROUND_ONE, BRIEF)
    start(teacher, course)

    answer(teacher, course, "Sixteen.", "None.")

    assert setup_of(teacher, course)["interview_finished"] is True


def test_the_teacher_confirms_the_brief_and_skips_sources_by_hand(teacher, course):
    changed = teacher.patch(
        f"/api/courses/{course}", json={"brief_confirmed": True, "sources_skipped": True}
    )

    assert changed.status_code == 200
    assert changed.json()["setup"]["brief_confirmed"] is True
    assert setup_of(teacher, course)["sources_skipped"] is True
    teacher.patch(f"/api/courses/{course}", json={"sources_skipped": False})
    assert setup_of(teacher, course)["sources_skipped"] is False


@pytest.mark.parametrize("change", [{"brief_confirmed": None}, {"sources_skipped": "yes"}])
def test_the_confirmations_are_yes_or_no(teacher, course, change):
    assert teacher.patch(f"/api/courses/{course}", json=change).status_code == 422


def test_only_sources_with_text_count_as_read(teacher, course):
    paste(teacher, course)
    upload(
        teacher, course, b"\x89PNG\r\n\x1a\n" + b"\0" * 64, name="scan.png", media_type="image/png"
    )

    assert setup_of(teacher, course)["read_sources"] == 1


def test_a_fork_keeps_the_steps_the_teacher_confirmed(teacher, course):
    teacher.patch(f"/api/courses/{course}", json={"brief_confirmed": True, "sources_skipped": True})

    copy = teacher.post(f"/api/courses/{course}/fork").json()

    assert copy["setup"]["brief_confirmed"] is True
    assert copy["setup"]["sources_skipped"] is True


def test_a_fork_of_a_course_whose_interview_finished_has_the_brief_done(teacher, course, models):
    models.script(ROUND_ONE, BRIEF)
    start(teacher, course)
    answer(teacher, course, "Sixteen.", "None.")

    copy = teacher.post(f"/api/courses/{course}/fork").json()

    # The transcript stays behind, what it established does not.
    assert copy["setup"]["brief_confirmed"] is True


# The topics' progress


def test_a_map_without_concepts_is_no_map_yet(teacher, course, models):
    tid = add(teacher, course, "Presente").json()[0]["id"]
    models.script({"concepts": []})
    teacher.post(f"{map_url(course, tid)}/proposal")

    [topic] = teacher.get(topics_url(course)).json()

    assert topic["concept_map"] == "none"


def test_each_topic_says_how_far_its_preparation_got(teacher, course, models):
    first, second, third = (
        topic["id"]
        for topic in [
            add(teacher, course, "Presente"),
            add(teacher, course, "Pretérito indefinido"),
            add(teacher, course, "Pretérito imperfecto"),
        ][-1].json()
    )
    approve_map(teacher, course, first)
    teacher.post(
        f"{map_url(course, second)}/concepts", json={"name": "ser", "description": "To be."}
    )
    source = paste(teacher, course).json()["source"]["id"]
    generated_material(teacher, (course, first), models)
    generated_document(teacher, (course, first), models, cited(source))
    discarded = generated_material(teacher, (course, first), models, MATERIAL)
    teacher.delete(f"{materials_url(course, first)}/{discarded['id']}")

    listed = {topic["id"]: topic for topic in teacher.get(topics_url(course)).json()}

    progress = {id: (t["concept_map"], t["documents"], t["materials"]) for id, t in listed.items()}
    assert progress == {first: ("approved", 1, 1), second: ("draft", 0, 0), third: ("none", 0, 0)}


# Reviewing drafts


def test_a_generated_material_is_new_until_kept_or_edited(teacher, course, models):
    tid = add(teacher, course, "Presente").json()[0]["id"]
    approve_map(teacher, course, tid)
    material = generated_material(teacher, (course, tid), models)
    url = f"{materials_url(course, tid)}/{material['id']}"
    assert material["reviewed"] is False

    teacher.post(f"{url}/reactions", json={"kind": "kept"})

    assert teacher.get(url).json()["reviewed"] is True
    assert teacher.get(materials_url(course, tid)).json()[0]["reviewed"] is True


def test_a_generated_document_is_new_until_kept(teacher, course, models):
    tid = add(teacher, course, "Presente").json()[0]["id"]
    approve_map(teacher, course, tid)
    source = paste(teacher, course).json()["source"]["id"]
    document = generated_document(teacher, (course, tid), models, cited(source))
    url = f"{documents_url(course, tid)}/{document['id']}"
    assert document["reviewed"] is False
    assert teacher.get(documents_url(course, tid)).json()[0]["reviewed"] is False

    teacher.post(f"{url}/reactions", json={"kind": "kept"})

    assert teacher.get(url).json()["reviewed"] is True
