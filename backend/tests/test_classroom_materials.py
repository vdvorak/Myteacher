import json

import pytest
from pydantic_ai.exceptions import ModelHTTPError
from sqlalchemy import select

from myteacher import erasure
from myteacher.assistant import prompts
from myteacher.assistant.generations import GenerationReaction
from myteacher.persistence import open_session
from tests.helpers import create_engine_for, create_student
from tests.test_course_access import COLLEAGUE, as_teacher, grant, invite_teachers
from tests.test_courses import create_course
from tests.test_interview import KEY, add_key, generations, job
from tests.test_reference_documents import TEXTBOOK, approve_map
from tests.test_sources import upload
from tests.test_topics import add, topics_url

EXPLANATION = {"type": "explanation", "markdown": "The preterite tells **finished** actions."}


def choice(exercise_id: str, prompt: str, right: str, wrong: str) -> dict:
    return {
        "type": "multiple_choice",
        "id": exercise_id,
        "prompt": prompt,
        "options": [{"id": "a", "text": right}, {"id": "b", "text": wrong}],
        "correct_option_id": "a",
        "hint": None,
        "solution_explanation": f"It is *{right}*.",
    }


MATERIAL = {
    "title": "Pretérito indefinido in class",
    "blocks": [
        EXPLANATION,
        choice("hablar", "Ayer yo ___ con Ana.", "hablé", "hablo"),
        choice("ir", "El lunes ___ al cine.", "fuimos", "vamos"),
    ],
}
SHORTER = {
    "title": "Pretérito indefinido, short",
    "blocks": [choice("ser", "Ayer ___ un buen día.", "fue", "es")],
}


def materials_url(course_id: int, topic_id: int) -> str:
    return f"/api/courses/{course_id}/topics/{topic_id}/classroom-materials"


@pytest.fixture
def topic(teacher) -> tuple[int, int]:
    """A course with a key, one topic with an approved map: (course id, topic id)."""
    add_key(teacher)
    cid = create_course(teacher).json()["id"]
    tid = add(teacher, cid, "Pretérito indefinido").json()[0]["id"]
    approve_map(teacher, cid, tid)
    return cid, tid


def generate(client, topic, **body):
    return client.post(materials_url(*topic), json=body)


def detail(client, topic, material_id) -> dict:
    return client.get(f"{materials_url(*topic)}/{material_id}").json()


def generated(client, topic, models, output=MATERIAL, **body) -> dict:
    models.script(output)
    started = generate(client, topic, **body)
    assert started.status_code == 202, started.json()
    return detail(client, topic, started.json()["material"]["id"])


def regenerate(client, topic, material_id, instruction, based_on=1):
    return client.post(
        f"{materials_url(*topic)}/{material_id}/regeneration",
        json={"instruction": instruction, "based_on": based_on},
    )


def reactions(settings) -> list[tuple[int, str, dict | None]]:
    with open_session(create_engine_for(settings)) as db:
        rows = db.scalars(select(GenerationReaction).order_by(GenerationReaction.id))
        return [(r.generation_id, r.kind, r.detail) for r in rows]


def material_generations(settings):
    return [g for g in generations(settings) if g.task_kind == "classroom_material"]


# Generation


def test_generating_runs_a_job_on_the_strong_slot_and_records_the_prompt_version(
    teacher, topic, models, admin_settings
):
    textbook = upload(teacher, topic[0], TEXTBOOK.encode(), name="Učebnice 3.txt").json()
    teacher.patch(
        f"{topics_url(topic[0])}/{topic[1]}", json={"additions": {"emphasis": "Only -ar verbs."}}
    )
    models.script(MATERIAL)

    started = generate(teacher, topic)

    assert started.status_code == 202
    body = started.json()
    assert body["job"]["kind"] == "classroom_material"
    assert body["material"]["version"] is None
    assert job(teacher, body["job"]["id"])["state"] == "succeeded"
    assert models.calls[-1] == ("anthropic", "claude-opus-5-5", KEY)
    [record] = material_generations(admin_settings)
    assert record.prompt_version == prompts.current_version("classroom_material") == "v2"
    sent = json.loads(models.requests[-1]["prompt"])
    assert sent["topic"]["name"] == "Pretérito indefinido"
    assert sent["topic"]["additions"] == {"emphasis": "Only -ar verbs."}
    assert [c["name"] for c in sent["concepts"]] == ["hablar", "Completed actions"]
    assert sent["sources"] == [
        {"id": textbook["source"]["id"], "name": "Učebnice 3.txt", "text": TEXTBOOK}
    ]
    assert "instruction" not in sent


def test_the_material_is_a_lesson_document_without_a_student_and_with_its_answer_key(
    teacher, topic, models
):
    material = generated(teacher, topic, models)

    assert material["title"] == "Pretérito indefinido in class"
    assert material["version"] == 1
    lesson = material["lesson"]
    assert lesson["title"] == "Pretérito indefinido in class"
    assert lesson["language"] == "es"
    assert [b["type"] for b in lesson["blocks"]] == [
        "explanation",
        "multiple_choice",
        "multiple_choice",
    ]
    # What reaches the page carries no solutions; they are in the answer key.
    assert "correct_option_id" not in lesson["blocks"][1]
    assert [e["exercise_id"] for e in material["answer_key"]["entries"]] == ["hablar", "ir"]
    assert material["answer_key"]["entries"][0]["solution"]["option_id"] == "a"
    assert "student_id" not in material
    assert material["target_student_ids"] == []


def test_materials_are_listed_on_the_topic(teacher, topic, models):
    first = generated(teacher, topic, models)
    second = generated(teacher, topic, models, SHORTER)

    listed = teacher.get(materials_url(*topic)).json()

    assert [m["id"] for m in listed] == [first["id"], second["id"]]
    assert [m["title"] for m in listed] == [MATERIAL["title"], SHORTER["title"]]
    assert "lesson" not in listed[0]


def test_only_catalog_exercise_types_are_accepted_from_the_assistant(teacher, topic, models):
    numeric = {
        "type": "numeric",
        "id": "count",
        "prompt": "How many forms?",
        "value": 6,
        "tolerance": 0,
    }
    outside = {"title": "x", "blocks": [numeric]}
    duplicate = {"title": "x", "blocks": [MATERIAL["blocks"][1], MATERIAL["blocks"][1]]}
    models.script(outside, duplicate)

    started = generate(teacher, topic)

    assert job(teacher, started.json()["job"]["id"])["error_kind"] == "invalid_output"
    assert detail(teacher, topic, started.json()["material"]["id"])["version"] is None


def test_material_needs_an_approved_map_and_a_key(teacher, topic):
    unmapped = (topic[0], add(teacher, topic[0], "Imperfecto").json()[1]["id"])

    refused = generate(teacher, unmapped)

    assert refused.status_code == 409
    assert refused.json() == {"detail": "map_not_approved"}
    keyless = create_course(teacher).json()["id"]
    as_other = (keyless, add(teacher, keyless, "x").json()[0]["id"])
    approve_map(teacher, *as_other)
    teacher.delete(
        f"/api/accounts/{teacher.get('/api/auth/me').json()['id']}/provider-credentials/anthropic"
    )
    assert generate(teacher, as_other).json() == {"detail": "no_provider_key"}


def test_a_failed_generation_says_why_and_is_retried(teacher, topic, models):
    models.script(ModelHTTPError(429, "claude", {"error": "rate limited"}))
    started = generate(teacher, topic)
    material_id = started.json()["material"]["id"]
    assert detail(teacher, topic, material_id)["job"]["error_kind"] == "quota"
    models.script(MATERIAL)

    retried = teacher.post(f"{materials_url(*topic)}/{material_id}/retry")

    assert retried.status_code == 202
    assert detail(teacher, topic, material_id)["version"] == 1
    assert teacher.post(f"{materials_url(*topic)}/{material_id}/retry").json() == {
        "detail": "nothing_to_retry"
    }


def test_the_first_generation_can_follow_an_instruction(teacher, topic, models):
    material = generated(teacher, topic, models, instruction="  Five exercises, only cloze.  ")

    sent = json.loads(models.requests[-1]["prompt"])
    assert sent["instruction"] == "Five exercises, only cloze."
    assert "previous" not in sent
    [version] = material["versions"]
    assert version["instruction"] == "Five exercises, only cloze."
    assert version["previous"] is None


@pytest.mark.parametrize("instruction", ["", "   ", "x" * 2001])
def test_a_first_instruction_must_say_something_short(teacher, topic, instruction):
    assert generate(teacher, topic, instruction=instruction).status_code == 422


def test_a_retried_first_generation_keeps_its_instruction(teacher, topic, models):
    models.script(ModelHTTPError(429, "claude", {"error": "rate limited"}))
    material_id = generate(teacher, topic, instruction="Only cloze.").json()["material"]["id"]
    models.script(MATERIAL)

    teacher.post(f"{materials_url(*topic)}/{material_id}/retry")

    assert json.loads(models.requests[-1]["prompt"])["instruction"] == "Only cloze."
    assert detail(teacher, topic, material_id)["versions"][0]["instruction"] == "Only cloze."


# Regeneration with an instruction


def test_regenerating_with_an_instruction_makes_a_new_linked_version(
    teacher, topic, models, admin_settings
):
    material = generated(teacher, topic, models)
    models.script(SHORTER)

    started = regenerate(teacher, topic, material["id"], "  Only one exercise, please.  ")

    assert started.status_code == 202
    assert job(teacher, started.json()["job"]["id"])["state"] == "succeeded"
    after = detail(teacher, topic, material["id"])
    assert after["version"] == 2
    assert after["title"] == SHORTER["title"]
    assert [b["id"] for b in after["lesson"]["blocks"]] == ["ser"]
    assert [
        {k: v[k] for k in ("number", "instruction", "previous", "generated")}
        for v in after["versions"]
    ] == [
        {"number": 1, "instruction": None, "previous": None, "generated": True},
        {
            "number": 2,
            "instruction": "Only one exercise, please.",
            "previous": 1,
            "generated": True,
        },
    ]
    sent = json.loads(models.requests[-1]["prompt"])
    assert sent["instruction"] == "Only one exercise, please."
    # The previous version as authored, with its solutions, so it can be reworked.
    assert sent["previous"]["blocks"][1]["correct_option_id"] == "a"
    first, second = material_generations(admin_settings)
    assert reactions(admin_settings) == [
        (first.id, "regenerated", {"instruction": "Only one exercise, please.", "version": 1})
    ]
    assert second.status == "succeeded"


def test_a_regeneration_starts_from_the_version_the_teacher_saw(teacher, topic, models):
    material = generated(teacher, topic, models)
    models.script(SHORTER)
    regenerate(teacher, topic, material["id"], "Shorter.")

    stale = regenerate(teacher, topic, material["id"], "Longer.", based_on=1)

    assert stale.status_code == 409
    assert stale.json() == {"detail": "material_changed"}
    assert regenerate(teacher, topic, material["id"], " ").status_code == 422
    assert regenerate(teacher, topic, material["id"], "x" * 2001, based_on=2).status_code == 422


def test_nothing_changes_while_a_generation_runs(teacher, topic, models, monkeypatch):
    from myteacher.jobs import runner

    material = generated(teacher, topic, models)
    # The regeneration has not run yet.
    monkeypatch.setattr(runner, "run", lambda *args, **kwargs: None)
    regenerate(teacher, topic, material["id"], "Shorter.")

    refused = regenerate(teacher, topic, material["id"], "Again.")

    assert refused.status_code == 409
    assert refused.json() == {"detail": "generation_running"}
    assert detail(teacher, topic, material["id"])["job"]["state"] == "queued"


def test_a_failed_regeneration_keeps_the_version_and_can_be_asked_again(teacher, topic, models):
    material = generated(teacher, topic, models)
    models.script(ModelHTTPError(429, "claude", {"error": "rate limited"}))

    regenerate(teacher, topic, material["id"], "Shorter.")

    after = detail(teacher, topic, material["id"])
    assert after["version"] == 1
    assert after["job"]["error_kind"] == "quota"
    models.script(SHORTER)
    assert regenerate(teacher, topic, material["id"], "Shorter.").status_code == 202
    assert detail(teacher, topic, material["id"])["version"] == 2


# Reactions


def test_keeping_the_material_is_recorded(teacher, topic, models, admin_settings):
    material = generated(teacher, topic, models)

    kept = teacher.post(
        f"{materials_url(*topic)}/{material['id']}/reactions", json={"kind": "kept"}
    )

    assert kept.status_code == 204
    [record] = material_generations(admin_settings)
    assert reactions(admin_settings) == [(record.id, "kept", {"version": 1})]


def test_editing_adds_a_version_and_is_recorded(teacher, topic, models, admin_settings):
    material = generated(teacher, topic, models)
    edited = {**MATERIAL, "title": "Pretérito: en clase", "blocks": MATERIAL["blocks"][:2]}

    saved = teacher.post(
        f"{materials_url(*topic)}/{material['id']}/versions", json={**edited, "based_on": 1}
    )

    assert saved.status_code == 201
    assert saved.json()["version"] == 2
    assert saved.json()["title"] == "Pretérito: en clase"
    assert saved.json()["versions"][-1] == {
        **saved.json()["versions"][-1],
        "instruction": None,
        "previous": 1,
        "generated": False,
    }
    [record] = material_generations(admin_settings)
    assert reactions(admin_settings) == [(record.id, "edited", {"version": 2})]
    # Keeping the teacher's own version says nothing more about the generation.
    teacher.post(f"{materials_url(*topic)}/{material['id']}/reactions", json={"kind": "kept"})
    assert reactions(admin_settings) == [(record.id, "edited", {"version": 2})]


def test_an_edit_must_be_a_valid_lesson_from_the_latest_version(teacher, topic, models):
    material = generated(teacher, topic, models)
    url = f"{materials_url(*topic)}/{material['id']}/versions"

    invalid = teacher.post(url, json={"title": "x", "blocks": [], "based_on": 1})
    stale = teacher.post(url, json={**MATERIAL, "based_on": 7})

    assert invalid.status_code == 422
    assert stale.status_code == 409
    assert stale.json() == {"detail": "material_changed"}


def test_discarding_is_recorded_and_the_material_is_gone(teacher, topic, models, admin_settings):
    material = generated(teacher, topic, models)

    discarded = teacher.delete(f"{materials_url(*topic)}/{material['id']}")

    assert discarded.status_code == 204
    assert teacher.get(materials_url(*topic)).json() == []
    assert teacher.get(f"{materials_url(*topic)}/{material['id']}").status_code == 404
    [record] = material_generations(admin_settings)
    assert reactions(admin_settings) == [(record.id, "discarded", {"version": 1})]


def test_a_material_discarded_while_it_is_generated_stays_discarded(
    teacher, topic, models, admin_settings
):
    def discard_meanwhile():
        with open_session(create_engine_for(admin_settings)) as db:
            from myteacher.courses.models import ClassroomMaterial

            for row in db.query(ClassroomMaterial):
                row.discarded_at = row.created_at
            db.commit()
        return MATERIAL

    models.script(discard_meanwhile)
    started = generate(teacher, topic)

    assert job(teacher, started.json()["job"]["id"])["result"] == {"superseded": True}
    assert teacher.get(materials_url(*topic)).json() == []


# Target students


def test_chosen_target_students_are_stored_and_do_not_reach_the_assistant(teacher, topic, models):
    jana = create_student(teacher).json()["id"]
    petr = create_student(teacher, email="petr@skola.example", name="Petr Malý").json()["id"]

    material = generated(teacher, topic, models, target_student_ids=[petr, jana, petr])

    assert material["target_student_ids"] == sorted([jana, petr])
    sent = json.loads(models.requests[-1]["prompt"])
    assert str(jana) not in json.dumps(sent.get("students", []))
    assert "students" not in sent and "target_student_ids" not in sent
    changed = teacher.put(
        f"{materials_url(*topic)}/{material['id']}/targets", json={"student_ids": [jana]}
    )
    assert changed.status_code == 200
    assert changed.json()["target_student_ids"] == [jana]


def test_targets_must_be_students(teacher, topic, models):
    me = teacher.get("/api/auth/me").json()["id"]

    refused = generate(teacher, topic, target_student_ids=[me])

    assert refused.status_code == 422
    assert refused.json() == {"detail": "unknown_student"}
    assert generate(teacher, topic, target_student_ids=[9999]).status_code == 422


def test_erasing_a_student_removes_them_from_the_targets(teacher, topic, models, admin_settings):
    from tests.test_erasure import as_admin, erase

    jana = create_student(teacher).json()["id"]
    material = generated(teacher, topic, models, target_student_ids=[jana])

    as_admin(teacher)
    assert erase(teacher, jana).status_code == 204

    assert "classroom_material_target" in {rule.table for rule in erasure.rules()}
    with open_session(create_engine_for(admin_settings)) as db:
        from myteacher.courses.models import ClassroomMaterialTarget

        assert db.query(ClassroomMaterialTarget).count() == 0
    assert material["target_student_ids"] == [jana]


# Access


def test_a_viewer_reads_and_previews_material_but_cannot_change_it(teacher, sender, topic, models):
    material = generated(teacher, topic, models)
    invite_teachers(teacher, sender, COLLEAGUE)
    grant(teacher, topic[0], COLLEAGUE, "view")
    as_teacher(teacher, COLLEAGUE)
    url = f"{materials_url(*topic)}/{material['id']}"

    assert detail(teacher, topic, material["id"])["lesson"] == material["lesson"]
    refused = [
        generate(teacher, topic),
        regenerate(teacher, topic, material["id"], "Shorter."),
        teacher.post(f"{url}/versions", json={**MATERIAL, "based_on": 1}),
        teacher.post(f"{url}/reactions", json={"kind": "kept"}),
        teacher.put(f"{url}/targets", json={"student_ids": []}),
        teacher.post(f"{url}/retry"),
        teacher.delete(url),
    ]
    assert [r.status_code for r in refused] == [403] * 7


def test_the_preview_assesses_answers_against_the_latest_version(teacher, topic, models):
    material = generated(teacher, topic, models)
    url = f"{materials_url(*topic)}/{material['id']}/exercises"

    right = teacher.post(
        f"{url}/hablar/assessment", json={"type": "multiple_choice", "option_id": "a"}
    )
    unknown = teacher.post(
        f"{url}/nope/assessment", json={"type": "multiple_choice", "option_id": "a"}
    )

    assert right.status_code == 200
    assert right.json()["status"] == "assessed"
    assert right.json()["correct"] is True
    assert unknown.status_code == 404


def test_removing_the_topic_removes_its_material(teacher, topic, models):
    material = generated(teacher, topic, models)

    teacher.delete(f"{topics_url(topic[0])}/{topic[1]}")

    assert teacher.get(f"{materials_url(*topic)}/{material['id']}").status_code == 404


def test_no_edit_is_saved_while_a_regeneration_runs(teacher, topic, models, monkeypatch):
    from myteacher.jobs import runner

    material = generated(teacher, topic, models)
    monkeypatch.setattr(runner, "run", lambda *args, **kwargs: None)
    regenerate(teacher, topic, material["id"], "Shorter.")

    refused = teacher.post(
        f"{materials_url(*topic)}/{material['id']}/versions", json={**MATERIAL, "based_on": 1}
    )

    # Otherwise the regeneration, built on version 1, would land over the edit.
    assert refused.status_code == 409
    assert refused.json() == {"detail": "generation_running"}


def test_reworking_and_retrying_need_the_map_still_approved(teacher, topic, models):
    from tests.test_concept_maps import map_url

    material = generated(teacher, topic, models)
    models.script(ModelHTTPError(429, "claude", {"error": "rate limited"}))
    failed = generate(teacher, topic).json()["material"]["id"]
    teacher.post(f"{map_url(*topic)}/reopening")

    refused = [
        regenerate(teacher, topic, material["id"], "Shorter."),
        teacher.post(f"{materials_url(*topic)}/{failed}/retry"),
    ]

    assert [r.json() for r in refused] == [{"detail": "map_not_approved"}] * 2


def test_a_failed_regeneration_is_cleared_once_the_teacher_moves_on(teacher, topic, models):
    material = generated(teacher, topic, models)
    models.script(ModelHTTPError(429, "claude", {"error": "rate limited"}))
    regenerate(teacher, topic, material["id"], "Shorter.")
    url = f"{materials_url(*topic)}/{material['id']}"
    assert detail(teacher, topic, material["id"])["job"]["state"] == "failed"

    teacher.post(f"{url}/reactions", json={"kind": "kept"})

    assert detail(teacher, topic, material["id"])["job"] is None
    models.script(ModelHTTPError(429, "claude", {"error": "rate limited"}))
    regenerate(teacher, topic, material["id"], "Shorter.")
    teacher.post(f"{url}/versions", json={**MATERIAL, "based_on": 1})
    assert detail(teacher, topic, material["id"])["job"] is None
