"""Classroom material transcribed faithfully from a teacher's source, such as a scanned test."""

# ruff: noqa: F811
import json

import pytest

from myteacher.assistant import prompts
from tests.helpers import back_to_teacher, sign_in
from tests.test_attempts import MATERIAL as EVERY_TYPE
from tests.test_attempts import (  # noqa: F401 - `course` is a fixture
    RIGHT,
    as_student,
    course,
    released,
    started,
    submit,
)
from tests.test_classroom_materials import (
    MATERIAL,
    choice,
    detail,
    generate,
    materials_url,
    regenerate,
)
from tests.test_course_access import COLLEAGUE, as_teacher, grant, invite_teachers
from tests.test_courses import create_course
from tests.test_interview import KEY, add_key, generations, job
from tests.test_reference_documents import approve_map
from tests.test_releases import edit
from tests.test_results import EXERCISES, results
from tests.test_sources import PNG, upload
from tests.test_topics import add

TEST = "Test 3\n1. Ayer yo ___ con Ana. a) hablé b) hablo\n2. Nakresli časovou osu.\n"
KEY_SHEET = "Klíč: 1a\n"
TIMELINE = {
    "type": "paper_only",
    "id": "timeline",
    "prompt": "Nakresli časovou osu.",
    "answer_lines": 6,
}

TRANSCRIBED = {
    "title": "Test 3",
    "blocks": [choice("hablar", "Ayer yo ___ con Ana.", "hablé", "hablo")],
    "proposed_answers": [],
    "component_needs": [],
}


@pytest.fixture
def topic(teacher) -> tuple[int, int]:
    """A course with a key and one topic without a concept map: (course id, topic id)."""
    add_key(teacher)
    cid = create_course(teacher).json()["id"]
    return cid, add(teacher, cid, "Pretérito indefinido").json()[0]["id"]


def source(client, course_id, text=TEST, name="Test 3.txt") -> int:
    return upload(client, course_id, text.encode(), name=name).json()["source"]["id"]


def transcribe(client, topic, **body):
    return client.post(f"{materials_url(*topic)}/from-source", json=body)


def transcribed(client, topic, models, output=TRANSCRIBED, **body) -> dict:
    models.script(output)
    started = transcribe(client, topic, **body)
    assert started.status_code == 202, started.json()
    return detail(client, topic, started.json()["material"]["id"])


def transcriptions(settings):
    return [g for g in generations(settings) if g.task_kind == "classroom_material_transcription"]


def test_material_is_transcribed_from_a_source_without_a_concept_map(
    teacher, topic, models, admin_settings
):
    test = source(teacher, topic[0])
    models.script(TRANSCRIBED)

    started = transcribe(teacher, topic, source_id=test)

    assert started.status_code == 202, started.json()
    body = started.json()
    assert body["job"]["kind"] == "classroom_material_transcription"
    assert job(teacher, body["job"]["id"])["state"] == "succeeded"
    assert models.calls[-1] == ("anthropic", "claude-opus-5-5", KEY)
    [record] = transcriptions(admin_settings)
    assert record.prompt_version == prompts.current_version("classroom_material_transcription")
    sent = json.loads(models.requests[-1]["prompt"])
    assert sent["source"] == {"id": test, "name": "Test 3.txt", "text": TEST}
    assert "answer_key" not in sent
    material = detail(teacher, topic, body["material"]["id"])
    assert material["version"] == 1
    assert material["title"] == "Test 3"
    assert material["source_id"] == test
    assert material["answer_key"]["entries"][0]["solution"]["option_id"] == "a"


def test_the_answers_come_from_a_key_source_or_are_marked_proposed(teacher, topic, models):
    test = source(teacher, topic[0])
    sheet = source(teacher, topic[0], KEY_SHEET, name="Klíč.txt")
    two = {
        **TRANSCRIBED,
        "blocks": [
            choice("hablar", "Ayer yo ___ con Ana.", "hablé", "hablo"),
            choice("ir", "El lunes ___ al cine.", "fuimos", "vamos"),
        ],
        "proposed_answers": ["ir"],
    }

    material = transcribed(teacher, topic, models, two, source_id=test, key_source_id=sheet)

    sent = json.loads(models.requests[-1]["prompt"])
    assert sent["answer_key"] == {"id": sheet, "name": "Klíč.txt", "text": KEY_SHEET}
    assert material["key_source_id"] == sheet
    assert [b["id"] for b in material["lesson"]["blocks"]] == ["hablar", "ir"]
    assert material["proposed_answers"] == ["ir"]


def test_proposed_answers_must_name_exercises_of_the_material(teacher, topic, models):
    test = source(teacher, topic[0])
    models.script({**TRANSCRIBED, "proposed_answers": ["nowhere"]}, TRANSCRIBED)

    started = transcribe(teacher, topic, source_id=test)

    # The invalid answer is asked once more; the second one lands.
    assert job(teacher, started.json()["job"]["id"])["state"] == "succeeded"
    assert detail(teacher, topic, started.json()["material"]["id"])["proposed_answers"] == []


def test_only_a_read_source_of_the_same_course_is_transcribed(teacher, topic, models):
    other = source(teacher, create_course(teacher).json()["id"])
    unread = upload(teacher, topic[0], PNG, "board.png", "image/png").json()["source"]["id"]
    test = source(teacher, topic[0])

    refused = [
        transcribe(teacher, topic, source_id=other),
        transcribe(teacher, topic, source_id=test, key_source_id=other),
        transcribe(teacher, topic, source_id=unread),
    ]

    assert [(r.status_code, r.json()["detail"]) for r in refused] == [
        (422, "unknown_source"),
        (422, "unknown_source"),
        (409, "source_not_read"),
    ]
    assert teacher.get(materials_url(*topic)).json() == []


def test_transcribing_needs_edit_rights_and_a_key(teacher, sender, topic):
    test = source(teacher, topic[0])
    teacher.delete(
        f"/api/accounts/{teacher.get('/api/auth/me').json()['id']}/provider-credentials/anthropic"
    )
    assert transcribe(teacher, topic, source_id=test).json() == {"detail": "no_provider_key"}
    invite_teachers(teacher, sender, COLLEAGUE)
    grant(teacher, topic[0], COLLEAGUE, "view")
    as_teacher(teacher, COLLEAGUE)

    assert transcribe(teacher, topic, source_id=test).status_code == 403


def test_a_transcribed_material_is_reworked_from_its_source_without_a_concept_map(
    teacher, topic, models, admin_settings
):
    test = source(teacher, topic[0])
    material = transcribed(teacher, topic, models, source_id=test)
    variant = {**TRANSCRIBED, "title": "Test 3, group B", "proposed_answers": ["hablar"]}
    models.script(variant)

    started = regenerate(teacher, topic, material["id"], "Make a variant for group B.")

    assert started.status_code == 202, started.json()
    assert started.json()["job"]["kind"] == "classroom_material_transcription"
    sent = json.loads(models.requests[-1]["prompt"])
    assert sent["source"]["id"] == test
    assert sent["previous"]["title"] == "Test 3"
    assert sent["instruction"] == "Make a variant for group B."
    reworked = detail(teacher, topic, material["id"])
    assert (reworked["version"], reworked["title"]) == (2, "Test 3, group B")
    assert reworked["proposed_answers"] == ["hablar"]
    assert len(transcriptions(admin_settings)) == 2


def test_an_item_no_exercise_type_represents_is_paper_only_and_a_backlog_need(
    teacher, topic, models
):
    test = source(teacher, topic[0])
    output = {
        **TRANSCRIBED,
        "blocks": [*TRANSCRIBED["blocks"], TIMELINE],
        "component_needs": [{"block_id": "timeline", "need": "Drawing on a timeline."}],
    }

    material = transcribed(teacher, topic, models, output, source_id=test)

    assert material["lesson"]["blocks"][1] == TIMELINE
    assert [e["exercise_id"] for e in material["answer_key"]["entries"]] == ["hablar"]
    teacher.cookies.clear()
    sign_in(teacher)
    [need] = teacher.get("/api/admin/component-backlog").json()
    assert need["need"] == "Drawing on a timeline."
    assert need["course_id"] == topic[0]
    assert need["material_id"] == material["id"]
    assert need["prompt"] == "Nakresli časovou osu."


@pytest.mark.parametrize(
    "needs",
    [
        [],
        [{"block_id": "hablar", "need": "Not paper-only."}],
    ],
)
def test_every_paper_only_item_says_what_it_needs(teacher, topic, models, needs):
    test = source(teacher, topic[0])
    models.script(
        {**TRANSCRIBED, "blocks": [*TRANSCRIBED["blocks"], TIMELINE], "component_needs": needs},
        TRANSCRIBED,
    )

    started = transcribe(teacher, topic, source_id=test)

    assert job(teacher, started.json()["job"]["id"])["state"] == "succeeded"
    assert [
        b["type"]
        for b in detail(teacher, topic, started.json()["material"]["id"])["lesson"]["blocks"]
    ] == ["multiple_choice"]


def test_generated_material_has_no_paper_only_items(teacher, topic, models):
    approve_map(teacher, *topic)
    paper = {**MATERIAL, "blocks": [*MATERIAL["blocks"], TIMELINE]}
    models.script(paper, paper)

    started = generate(teacher, topic)

    assert job(teacher, started.json()["job"]["id"])["error_kind"] == "invalid_output"


def test_the_backlog_is_for_admins(teacher):
    assert teacher.get("/api/admin/component-backlog").status_code == 403


def test_a_paper_only_item_is_shown_but_neither_answered_nor_assessed_in_the_app(teacher, course):
    edit(
        teacher,
        course.topic,
        course.material,
        {**EVERY_TYPE, "blocks": [*EVERY_TYPE["blocks"], TIMELINE]},
    )
    release_id = released(teacher, course, version=2, feedback_mode="at_the_end")
    as_student(teacher)
    attempt = started(teacher, release_id)

    assert attempt["lesson"]["blocks"][-1] == TIMELINE
    submitted = submit(teacher, attempt["id"], RIGHT)

    assert submitted.status_code == 200, submitted.json()
    assert "timeline" not in submitted.json()["tries"]
    back_to_teacher(teacher)
    assert [e["id"] for e in results(teacher, course, release_id)["exercises"]] == EXERCISES


def test_a_fork_keeps_what_its_transcribed_material_came_from(teacher, sender, topic, models):
    test = source(teacher, topic[0])
    sheet = source(teacher, topic[0], KEY_SHEET, name="Klíč.txt")
    output = {
        **TRANSCRIBED,
        "blocks": [*TRANSCRIBED["blocks"], TIMELINE],
        "proposed_answers": ["hablar"],
        "component_needs": [{"block_id": "timeline", "need": "Drawing on a timeline."}],
    }
    transcribed(teacher, topic, models, output, source_id=test, key_source_id=sheet)
    invite_teachers(teacher, sender, COLLEAGUE)
    grant(teacher, topic[0], COLLEAGUE, "fork")
    as_teacher(teacher, COLLEAGUE)
    add_key(teacher)

    fork = teacher.post(f"/api/courses/{topic[0]}/fork").json()["id"]

    forked_topic = (fork, teacher.get(f"/api/courses/{fork}/topics").json()[0]["id"])
    names = {s["id"]: s["name"] for s in teacher.get(f"/api/courses/{fork}/sources").json()}
    [material] = teacher.get(materials_url(*forked_topic)).json()
    assert names[material["source_id"]] == "Test 3.txt"
    assert names[material["key_source_id"]] == "Klíč.txt"
    assert detail(teacher, forked_topic, material["id"])["proposed_answers"] == ["hablar"]
    # Reworked in the fork, it is transcribed again from the fork's own source.
    models.script(output)
    started = regenerate(teacher, forked_topic, material["id"], "Group B.")
    assert started.json()["job"]["kind"] == "classroom_material_transcription"
    assert json.loads(models.requests[-1]["prompt"])["source"]["id"] == material["source_id"]


def test_a_transcribed_material_stays_transcribed_when_its_sources_are_removed(
    teacher, topic, models
):
    test = source(teacher, topic[0])
    sheet = source(teacher, topic[0], KEY_SHEET, name="Klíč.txt")
    material = transcribed(teacher, topic, models, source_id=test, key_source_id=sheet)
    for removed in (test, sheet):
        assert teacher.delete(f"/api/courses/{topic[0]}/sources/{removed}").status_code == 204
    models.script(TRANSCRIBED)

    started = regenerate(teacher, topic, material["id"], "Fix item 1.")

    assert started.status_code == 202, started.json()
    assert started.json()["job"]["kind"] == "classroom_material_transcription"
    sent = json.loads(models.requests[-1]["prompt"])
    assert "source" not in sent
    assert sent["previous"]["title"] == "Test 3"
