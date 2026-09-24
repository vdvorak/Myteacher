import json

import pytest
from pydantic_ai.exceptions import ModelHTTPError
from sqlalchemy import select

from myteacher import erasure
from myteacher.assistant import prompts
from myteacher.assistant.generations import GenerationReaction
from myteacher.persistence import open_session
from tests.helpers import as_student, back_to_teacher, create_engine_for
from tests.test_concept_maps import map_url
from tests.test_course_access import COLLEAGUE, as_teacher, grant, invite_teachers
from tests.test_courses import create_course
from tests.test_interview import KEY, add_key, generations, job
from tests.test_sources import sources_url, upload
from tests.test_topics import add

TEXTBOOK = "Unidad 3. El pretérito indefinido\nhablar: hablé, hablaste, habló\n"


def documents_url(course_id: int, topic_id: int) -> str:
    return f"/api/courses/{course_id}/topics/{topic_id}/reference-documents"


def approve_map(client, course_id, topic_id) -> None:
    url = map_url(course_id, topic_id)
    for name in ("hablar", "Completed actions"):
        concept_map = client.post(
            f"{url}/concepts", json={"name": name, "description": f"About {name}."}
        ).json()
    approved = client.post(f"{url}/approval", json={"version": concept_map["version"]})
    assert approved.status_code == 200


@pytest.fixture
def topic(teacher) -> tuple[int, int]:
    """A course with a key, one topic with an approved map: (course id, topic id)."""
    add_key(teacher)
    cid = create_course(teacher).json()["id"]
    tid = add(teacher, cid, "Pretérito indefinido").json()[0]["id"]
    approve_map(teacher, cid, tid)
    return cid, tid


@pytest.fixture
def textbook(teacher, topic) -> int:
    """A source of the course with extracted text."""
    return upload(teacher, topic[0], TEXTBOOK.encode(), name="Učebnice 3.txt").json()["source"][
        "id"
    ]


def cited(source_id: int) -> dict:
    return {
        "title": "Pretérito indefinido: cheat sheet",
        "passages": [
            {
                "markdown": "## Regular -ar verbs\n\n**hablar**: hablé, hablaste, habló",
                "citations": [{"source_id": source_id, "location": "Unidad 3"}],
            },
            {"markdown": "Use it for finished actions.", "citations": []},
        ],
    }


def generate(client, topic, kind="grammar"):
    return client.post(documents_url(*topic), json={"kind": kind})


def generated(client, topic, models, output) -> dict:
    models.script(output)
    started = generate(client, topic)
    assert started.status_code == 202, started.json()
    return client.get(f"{documents_url(*topic)}/{started.json()['document']['id']}").json()


def reactions(settings) -> list[tuple[int, str]]:
    with open_session(create_engine_for(settings)) as db:
        rows = db.scalars(select(GenerationReaction).order_by(GenerationReaction.id))
        return [(r.generation_id, r.kind) for r in rows]


# Generation


def test_generating_runs_a_job_on_the_strong_slot_and_records_the_prompt_version(
    teacher, topic, textbook, models, admin_settings
):
    models.script(cited(textbook))

    started = generate(teacher, topic)

    assert started.status_code == 202
    body = started.json()
    assert body["job"]["kind"] == "reference_document"
    assert job(teacher, body["job"]["id"])["state"] == "succeeded"
    assert models.calls[-1] == ("anthropic", "claude-opus-5-5", KEY)
    [record] = [g for g in generations(admin_settings) if g.task_kind == "reference_document"]
    assert record.prompt_version == prompts.current_version("reference_document") == "v1"
    assert record.status == "succeeded"
    sent = json.loads(models.requests[-1]["prompt"])
    assert sent["kind"] == "grammar"
    assert sent["topic"] == "Pretérito indefinido"
    assert [c["name"] for c in sent["concepts"]] == ["hablar", "Completed actions"]
    assert sent["sources"] == [{"id": textbook, "name": "Učebnice 3.txt", "text": TEXTBOOK}]


def test_the_document_carries_citations_to_sources_by_identifier_and_location(
    teacher, topic, textbook, models
):
    document = generated(teacher, topic, models, cited(textbook))

    assert document["kind"] == "grammar"
    assert document["title"] == "Pretérito indefinido: cheat sheet"
    assert document["version"] == 1
    first, second = document["passages"]
    assert first["markdown"].startswith("## Regular -ar verbs")
    assert first["citations"] == [
        {"source_id": textbook, "source_name": "Učebnice 3.txt", "location": "Unidad 3"}
    ]
    assert first["unsourced"] is False
    # A passage with no citation is marked unsourced.
    assert second["unsourced"] is True
    assert document["unsourced_passages"] == 1


def test_the_list_holds_the_topics_documents(teacher, topic, textbook, models):
    document = generated(teacher, topic, models, cited(textbook))

    listed = teacher.get(documents_url(*topic)).json()

    assert [(d["id"], d["kind"], d["title"], d["version"]) for d in listed] == [
        (document["id"], "grammar", "Pretérito indefinido: cheat sheet", 1)
    ]


def test_a_course_without_sources_gets_content_marked_unsourced(teacher, topic, models):
    unsourced = {
        "title": "Vocabulario",
        "passages": [{"markdown": "- **hablar**: mluvit", "citations": []}],
    }

    document = generated(teacher, topic, models, unsourced)

    assert json.loads(models.requests[-1]["prompt"])["sources"] == []
    assert document["passages"][0]["unsourced"] is True
    assert document["unsourced_passages"] == 1


def test_citing_an_unknown_source_or_raw_html_is_asked_for_again(teacher, topic, textbook, models):
    unknown = {
        "title": "T",
        "passages": [{"markdown": "x", "citations": [{"source_id": 999, "location": "p. 1"}]}],
    }
    html = {"title": "T", "passages": [{"markdown": "<script>x</script>", "citations": []}]}
    models.script(unknown, html)

    started = generate(teacher, topic).json()

    assert job(teacher, started["job"]["id"])["error_kind"] == "invalid_output"
    assert (
        teacher.get(f"{documents_url(*topic)}/{started['document']['id']}").json()["version"]
        is None
    )


def test_a_document_needs_an_approved_concept_map(teacher):
    add_key(teacher)
    cid = create_course(teacher).json()["id"]
    tid = add(teacher, cid, "Presente").json()[0]["id"]

    refused = generate(teacher, (cid, tid))

    assert refused.status_code == 409
    assert refused.json() == {"detail": "map_not_approved"}


def test_generating_needs_a_provider_key(teacher):
    cid = create_course(teacher).json()["id"]
    tid = add(teacher, cid, "Presente").json()[0]["id"]
    approve_map(teacher, cid, tid)

    refused = generate(teacher, (cid, tid))

    assert refused.status_code == 409
    assert refused.json() == {"detail": "no_provider_key"}


def test_only_known_kinds_are_generated(teacher, topic):
    assert generate(teacher, topic, kind="poem").status_code == 422


def test_a_failed_generation_says_why_and_is_tried_again(teacher, topic, textbook, models):
    models.script(ModelHTTPError(429, "claude", {"error": "rate limited"}), cited(textbook))
    started = generate(teacher, topic).json()
    url = f"{documents_url(*topic)}/{started['document']['id']}"
    assert teacher.get(url).json()["job"]["error_kind"] == "quota"

    again = teacher.post(f"{url}/retry")

    assert again.status_code == 202
    assert teacher.get(url).json()["version"] == 1
    assert teacher.post(f"{url}/retry").json() == {"detail": "nothing_to_retry"}


# Editing and reactions


def test_editing_the_text_creates_a_new_version_and_records_the_reaction(
    teacher, topic, textbook, models, admin_settings
):
    document = generated(teacher, topic, models, cited(textbook))
    url = f"{documents_url(*topic)}/{document['id']}"
    [record] = [g for g in generations(admin_settings) if g.task_kind == "reference_document"]
    edited = {
        "title": "Pretérito: tahák",
        "passages": [
            {
                "markdown": "**hablar**: hablé, hablaste, habló, hablamos",
                "citations": [{"source_id": textbook, "location": "Unidad 3, p. 41"}],
            }
        ],
    }

    saved = teacher.post(f"{url}/versions", json={**edited, "based_on": 1})

    assert saved.status_code == 201
    assert saved.json()["version"] == 2
    assert saved.json()["title"] == "Pretérito: tahák"
    assert saved.json()["passages"][0]["citations"][0]["location"] == "Unidad 3, p. 41"
    assert saved.json()["unsourced_passages"] == 0
    assert teacher.get(url).json()["version"] == 2
    assert reactions(admin_settings) == [(record.id, "edited")]


def test_an_edit_cannot_cite_a_foreign_source_or_hold_raw_html(teacher, topic, textbook, models):
    document = generated(teacher, topic, models, cited(textbook))
    url = f"{documents_url(*topic)}/{document['id']}/versions"
    other = create_course(teacher, name="Algebra").json()["id"]
    foreign = upload(teacher, other, b"x^2").json()["source"]["id"]

    wrong_source = teacher.post(
        url,
        json={
            "title": "T",
            "passages": [{"markdown": "x", "citations": [{"source_id": foreign, "location": "1"}]}],
            "based_on": 1,
        },
    )
    html = teacher.post(
        url,
        json={
            "title": "T",
            "passages": [{"markdown": "<b>x</b>", "citations": []}],
            "based_on": 1,
        },
    )

    assert wrong_source.status_code == 422
    assert wrong_source.json() == {"detail": "unknown_source"}
    assert html.status_code == 422


def test_an_edit_of_a_version_that_is_no_longer_the_latest_is_refused(
    teacher, topic, textbook, models
):
    document = generated(teacher, topic, models, cited(textbook))
    url = f"{documents_url(*topic)}/{document['id']}/versions"
    first = teacher.post(url, json={**cited(textbook), "title": "First edit", "based_on": 1})

    second = teacher.post(url, json={**cited(textbook), "title": "Second edit", "based_on": 1})

    assert first.status_code == 201
    assert second.status_code == 409
    assert second.json() == {"detail": "document_changed"}
    latest = teacher.get(f"{documents_url(*topic)}/{document['id']}").json()
    assert (latest["version"], latest["title"]) == (2, "First edit")


def test_a_citation_of_a_removed_source_stays_through_an_edit(teacher, topic, textbook, models):
    document = generated(teacher, topic, models, cited(textbook))
    teacher.delete(f"{sources_url(topic[0])}/{textbook}")
    content = {**cited(textbook), "title": "Still citing the removed textbook"}

    saved = teacher.post(
        f"{documents_url(*topic)}/{document['id']}/versions", json={**content, "based_on": 1}
    )

    assert saved.status_code == 201
    assert saved.json()["passages"][0]["citations"][0]["source_name"] is None


def test_keeping_a_document_as_it_is_is_recorded(teacher, topic, textbook, models, admin_settings):
    document = generated(teacher, topic, models, cited(textbook))
    [record] = [g for g in generations(admin_settings) if g.task_kind == "reference_document"]

    kept = teacher.post(
        f"{documents_url(*topic)}/{document['id']}/reactions", json={"kind": "kept"}
    )

    assert kept.status_code == 204
    assert reactions(admin_settings) == [(record.id, "kept")]
    other = teacher.post(f"{documents_url(*topic)}/{document['id']}/reactions", json={"kind": "x"})
    assert other.status_code == 422


def test_discarding_a_document_removes_it_and_is_recorded(
    teacher, topic, textbook, models, admin_settings
):
    document = generated(teacher, topic, models, cited(textbook))
    url = f"{documents_url(*topic)}/{document['id']}"
    [record] = [g for g in generations(admin_settings) if g.task_kind == "reference_document"]

    discarded = teacher.delete(url)

    assert discarded.status_code == 204
    assert teacher.get(url).status_code == 404
    assert teacher.get(documents_url(*topic)).json() == []
    assert reactions(admin_settings) == [(record.id, "discarded")]


def test_a_removed_source_leaves_its_citations_without_a_name(teacher, topic, textbook, models):
    document = generated(teacher, topic, models, cited(textbook))
    teacher.delete(f"{sources_url(topic[0])}/{textbook}")

    after = teacher.get(f"{documents_url(*topic)}/{document['id']}").json()

    assert after["passages"][0]["citations"] == [
        {"source_id": textbook, "source_name": None, "location": "Unidad 3"}
    ]


# Access


def test_a_viewer_reads_documents_but_cannot_change_them(teacher, sender, topic, textbook, models):
    document = generated(teacher, topic, models, cited(textbook))
    invite_teachers(teacher, sender, COLLEAGUE)
    grant(teacher, topic[0], COLLEAGUE, "view")
    as_teacher(teacher, COLLEAGUE)
    url = f"{documents_url(*topic)}/{document['id']}"

    assert teacher.get(url).json()["title"] == document["title"]
    refused = [
        generate(teacher, topic),
        teacher.post(f"{url}/versions", json={**cited(textbook), "based_on": 1}),
        teacher.post(f"{url}/reactions", json={"kind": "kept"}),
        teacher.delete(url),
    ]
    assert [r.status_code for r in refused] == [403] * 4
    back_to_teacher(teacher)


def test_a_teacher_without_a_right_cannot_see_documents(teacher, sender, topic, textbook, models):
    document = generated(teacher, topic, models, cited(textbook))
    invite_teachers(teacher, sender, COLLEAGUE)
    as_teacher(teacher, COLLEAGUE)

    assert teacher.get(documents_url(*topic)).status_code == 404
    assert teacher.get(f"{documents_url(*topic)}/{document['id']}").status_code == 404


def test_a_document_of_another_topic_is_not_found_here(teacher, topic, textbook, models):
    document = generated(teacher, topic, models, cited(textbook))
    other = add(teacher, topic[0], "Imperfecto").json()[1]["id"]

    assert teacher.get(f"{documents_url(topic[0], other)}/{document['id']}").status_code == 404


def test_students_cannot_reach_documents(teacher, sender, topic):
    as_student(teacher, sender)

    assert teacher.get(documents_url(*topic)).status_code == 403


def test_documents_hold_no_student_data():
    tables = {rule.table for rule in erasure.rules()}

    assert (
        not {
            "reference_document",
            "reference_document_version",
            "generation_reaction",
        }
        & tables
    )
