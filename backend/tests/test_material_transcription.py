"""Classroom material transcribed faithfully from a teacher's source, such as a scanned test."""

# ruff: noqa: F811
import asyncio
import json

import pytest

from myteacher.accounts.service import find_account_by_email
from myteacher.assistant import prompts
from myteacher.courses.models import Source
from myteacher.jobs.models import Job
from myteacher.jobs.runner import create_job, run_after
from myteacher.persistence import open_session
from tests.helpers import TEACHER, back_to_teacher, create_engine_for, sign_in
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
from tests.test_course_access import COLLEAGUE, NOW, as_teacher, grant, invite_teachers
from tests.test_courses import create_course
from tests.test_interview import KEY, add_key, generations, job
from tests.test_reference_documents import approve_map
from tests.test_releases import edit
from tests.test_results import EXERCISES, results
from tests.test_sources import (
    PNG,
    TEST_A,
    TEST_B,
    pdf_with_pages,
    pdf_with_text,
    sources_url,
    upload,
)
from tests.test_topics import add

TEST = "Test 3\n1. Ayer yo ___ con Ana. a) hablé b) hablo\n2. Nakresli časovou osu.\n"
KEY_SHEET = "Klíč: 1a\n"
TEST_FILE = TEST.encode()
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


def test_only_a_source_of_the_same_course_not_being_read_is_transcribed(
    teacher, topic, models, admin_settings
):
    other = source(teacher, create_course(teacher).json()["id"])
    reading = upload(teacher, topic[0], PNG, "board.png", "image/png").json()
    with open_session(create_engine_for(admin_settings)) as db:
        db.get_one(Job, reading["job"]["id"]).state = "running"
        db.commit()
    test = source(teacher, topic[0])

    refused = [
        transcribe(teacher, topic, source_id=other),
        transcribe(teacher, topic, source_id=test, key_source_id=other),
        transcribe(teacher, topic, source_id=reading["source"]["id"]),
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


# A file uploaded in the form, read as the first step of its transcription


def store(client, course_id, content=TEST_FILE, name="Test 3.txt", media_type="text/plain"):
    """Upload a file as a source left unread, for its transcription to read."""
    return client.post(
        sources_url(course_id),
        params={"name": name, "read": "false"},
        content=content,
        headers={"Content-Type": media_type},
    )


def test_a_file_is_stored_unread_for_its_transcription_to_read(teacher, topic, models):
    stored = store(teacher, topic[0], PNG, "Test 3.png", "image/png")

    assert stored.status_code == 201, stored.json()
    body = stored.json()
    assert body["job"] is None
    assert (body["source"]["name"], body["source"]["characters"]) == ("Test 3.png", None)
    assert body["source"]["job"] is None
    assert [s["id"] for s in teacher.get(sources_url(topic[0])).json()] == [body["source"]["id"]]
    assert models.calls == []


def test_a_file_is_not_stored_for_transcription_without_a_provider_key(teacher):
    cid = create_course(teacher).json()["id"]

    refused = store(teacher, cid)

    assert (refused.status_code, refused.json()) == (409, {"detail": "no_provider_key"})
    assert teacher.get(sources_url(cid)).json() == []


def test_an_unread_source_is_read_then_transcribed(teacher, topic, models):
    test = store(teacher, topic[0]).json()["source"]["id"]
    models.script(TRANSCRIBED)

    started = transcribe(teacher, topic, source_id=test)

    assert started.status_code == 202, started.json()
    # The material says it waits for its source to be read.
    assert started.json()["job"]["progress"] == "extracting"
    assert job(teacher, started.json()["job"]["id"])["state"] == "succeeded"
    read = teacher.get(f"{sources_url(topic[0])}/{test}").json()
    assert (read["text"], read["extracted_with"]) == (TEST, "file")
    assert (read["job"]["kind"], read["job"]["state"]) == ("source_extraction", "succeeded")
    sent = json.loads(models.requests[-1]["prompt"])
    assert sent["source"] == {"id": test, "name": "Test 3.txt", "text": TEST}
    assert detail(teacher, topic, started.json()["material"]["id"])["title"] == "Test 3"


def test_a_scan_is_read_by_ocr_and_a_key_from_its_text_layer_before_transcribing(
    teacher, topic, models
):
    scan = store(teacher, topic[0], PNG, "Test 3.png", "image/png").json()["source"]["id"]
    key_line = "Klic spravnych odpovedi: 1a, 2b, 3c, 4a, 5b, 6c"
    key_pdf = pdf_with_text(key_line)
    sheet = store(teacher, topic[0], key_pdf, "Klic.pdf", "application/pdf").json()["source"]["id"]
    models.script({"text": TEST}, TRANSCRIBED)

    started = transcribe(teacher, topic, source_id=scan, key_source_id=sheet)

    assert job(teacher, started.json()["job"]["id"])["state"] == "succeeded"
    ocr, transcription = models.requests
    assert ocr["attachments"] == ["image/png"]
    sent = json.loads(transcription["prompt"])
    assert (sent["source"]["text"], sent["answer_key"]["text"]) == (TEST, key_line)
    read = {s["id"]: s["extracted_with"] for s in teacher.get(sources_url(topic[0])).json()}
    assert read == {scan: "ocr", sheet: "file"}


def test_a_failed_reading_fails_the_transcription_and_a_retry_reads_again(teacher, topic, models):
    scan = store(teacher, topic[0], PNG, "Test 3.png", "image/png").json()["source"]["id"]
    models.script({"text": "   "})

    started = transcribe(teacher, topic, source_id=scan).json()

    failed = job(teacher, started["job"]["id"])
    assert (failed["state"], failed["error_kind"]) == ("failed", "nothing_read")
    assert len(models.requests) == 1
    models.script({"text": TEST}, TRANSCRIBED)
    retried = teacher.post(f"{materials_url(*topic)}/{started['material']['id']}/retry")
    assert retried.status_code == 202, retried.json()
    assert job(teacher, retried.json()["job"]["id"])["state"] == "succeeded"
    assert detail(teacher, topic, started["material"]["id"])["title"] == "Test 3"


def test_a_source_whose_reading_failed_is_read_by_ocr_to_be_transcribed(teacher, topic, models):
    board = upload(teacher, topic[0], PNG, "board.png", "image/png").json()["source"]["id"]
    models.script({"text": TEST}, TRANSCRIBED)

    started = transcribe(teacher, topic, source_id=board)

    assert job(teacher, started.json()["job"]["id"])["state"] == "succeeded"
    assert json.loads(models.requests[-1]["prompt"])["source"]["text"] == TEST


@pytest.mark.parametrize("layer", [(), ("12",)], ids=["no text layer", "a page number only"])
def test_a_scanned_pdf_is_read_by_ocr_before_transcribing(teacher, topic, models, layer):
    scan = store(teacher, topic[0], pdf_with_text(*layer), "Test 3.pdf", "application/pdf")
    models.script({"text": TEST}, TRANSCRIBED)

    started = transcribe(teacher, topic, source_id=scan.json()["source"]["id"])

    assert job(teacher, started.json()["job"]["id"])["state"] == "succeeded"
    assert models.requests[0]["attachments"] == ["application/pdf"]
    assert json.loads(models.requests[1]["prompt"])["source"]["text"] == TEST.strip()


def test_a_transcription_fails_when_its_source_changed_while_being_read(teacher, admin_settings):
    """A source removed, or read again, meanwhile: its reading did not do its work."""
    with open_session(create_engine_for(admin_settings)) as db:
        starter = find_account_by_email(db, TEACHER)
        reading, waiting = (
            create_job(db, kind, starter=starter, course_id=None, now=NOW).id
            for kind in ("source_extraction", "classroom_material_transcription")
        )
        db.commit()

    async def superseded(db, job, ctx):
        return {"superseded": True}

    async def transcription(db, job, ctx):
        raise AssertionError("transcribed without its source")

    work = [(reading, superseded)]
    asyncio.run(
        run_after(teacher.app.state.jobs, work, waiting, transcription, first_progress="extracting")
    )

    failed = job(teacher, waiting)
    assert (failed["state"], failed["error_kind"]) == ("failed", "superseded")


@pytest.mark.parametrize(
    ("content", "media_type", "refusal"),
    [
        (b"", "text/plain", (422, "empty_file")),
        (b"<svg/>", "image/svg+xml", (415, "unsupported_type")),
    ],
)
def test_a_file_for_transcription_is_refused_as_any_upload(
    teacher, topic, content, media_type, refusal
):
    refused = store(teacher, topic[0], content, "test.svg", media_type)

    assert (refused.status_code, refused.json()["detail"]) == refusal
    assert teacher.get(sources_url(topic[0])).json() == []


# Chosen pages of a PDF

KEY_PAGE = ("Answer key: 1. a) hable, 2. b) fuimos, 3. a) comimos",)


def pdf_source(client, course_id, *pages: tuple[str, ...], name="Příloha.pdf") -> int:
    """A PDF source read from its file, one page per tuple of lines."""
    uploaded = upload(client, course_id, pdf_with_pages(*pages), name, "application/pdf")
    return uploaded.json()["source"]["id"]


def sent_source(models, part="source") -> dict:
    return json.loads(models.requests[-1]["prompt"])[part]


def test_only_the_chosen_pages_are_transcribed_and_the_material_keeps_them(teacher, topic, models):
    appendix = pdf_source(teacher, topic[0], TEST_A, TEST_B)

    material = transcribed(teacher, topic, models, source_id=appendix, source_pages="2")

    sent = sent_source(models)
    assert sent["pages"] == [2]
    assert "Test B" in sent["text"]
    assert "Test A" not in sent["text"]
    assert material["source_pages"] == [2]
    assert material["key_pages"] is None


def test_the_answer_key_may_be_other_pages_of_the_same_source(teacher, topic, models):
    appendix = pdf_source(teacher, topic[0], TEST_A, KEY_PAGE, TEST_B)

    material = transcribed(
        teacher,
        topic,
        models,
        source_id=appendix,
        source_pages="1",
        key_source_id=appendix,
        key_pages="2",
    )

    test, key = sent_source(models), sent_source(models, "answer_key")
    assert (test["pages"], key["pages"]) == ([1], [2])
    assert "Test A" in test["text"]
    assert "Answer key" not in test["text"]
    assert key["text"] == KEY_PAGE[0]
    assert (material["source_pages"], material["key_pages"]) == ([1], [2])


@pytest.mark.parametrize(
    ("pages", "refusal"),
    [
        ("0", "pages_outside"),
        ("2-3", "pages_outside"),
        ("2-1", "bad_pages"),
        ("one", "bad_pages"),
        ("1,,2", "bad_pages"),
    ],
)
def test_pages_outside_the_document_or_badly_written_are_refused(teacher, topic, pages, refusal):
    appendix = pdf_source(teacher, topic[0], TEST_A, TEST_B)

    for body in ({"source_pages": pages}, {"key_source_id": appendix, "key_pages": pages}):
        refused = transcribe(teacher, topic, source_id=appendix, **body)
        assert (refused.status_code, refused.json()["detail"]) == (422, refusal)
    assert teacher.get(materials_url(*topic)).json() == []


def test_pages_are_written_as_the_teacher_likes_and_only_of_a_pdf(teacher, topic, models):
    appendix = pdf_source(teacher, topic[0], TEST_A, (), TEST_B, KEY_PAGE)
    models.script(TRANSCRIBED)

    started = transcribe(teacher, topic, source_id=appendix, source_pages=" 4, 1–1,3 - 4 ")

    assert started.json()["material"]["source_pages"] == [1, 3, 4]
    refused = transcribe(teacher, topic, source_id=source(teacher, topic[0]), source_pages="1")
    assert (refused.status_code, refused.json()["detail"]) == (422, "pages_not_pdf")


def test_reworking_transcribes_the_same_pages_again(teacher, topic, models):
    appendix = pdf_source(teacher, topic[0], TEST_A, KEY_PAGE, TEST_B)
    material = transcribed(
        teacher,
        topic,
        models,
        source_id=appendix,
        source_pages="3",
        key_source_id=appendix,
        key_pages="2",
    )
    models.script(TRANSCRIBED)

    started = regenerate(teacher, topic, material["id"], "Group B.")

    assert job(teacher, started.json()["job"]["id"])["state"] == "succeeded"
    assert sent_source(models)["pages"] == [3]
    assert "Test B" in sent_source(models)["text"]
    assert sent_source(models, "answer_key")["pages"] == [2]


def test_chosen_pages_the_file_holds_no_text_for_are_read_by_ocr_first(teacher, topic, models):
    appendix = pdf_source(teacher, topic[0], TEST_A, (), ())
    models.script({"text": "Jana: 1. hable"}, TRANSCRIBED)

    started = transcribe(teacher, topic, source_id=appendix, source_pages="2")

    assert job(teacher, started.json()["job"]["id"])["state"] == "succeeded"
    # Only the chosen page without text is read by the assistant, the rest stays as read.
    ocr, transcription = models.requests
    assert json.loads(ocr["prompt"])["page"] == 2
    assert json.loads(transcription["prompt"])["source"]["text"] == "Jana: 1. hable"
    read = teacher.get(f"{sources_url(topic[0])}/{appendix}").json()
    assert read["pages_without_text"] == [3]
    # Read once: transcribing the page again reads it no more.
    models.script(TRANSCRIBED)
    again = transcribe(teacher, topic, source_id=appendix, source_pages="2")
    assert job(teacher, again.json()["job"]["id"])["state"] == "succeeded"
    assert len(models.requests) == 3


def test_a_pdf_read_before_its_pages_were_kept_is_read_again_to_choose_pages(
    teacher, topic, models, admin_settings
):
    appendix = pdf_source(teacher, topic[0], TEST_A, TEST_B)
    with open_session(create_engine_for(admin_settings)) as db:
        db.get_one(Source, appendix).pages = None
        db.commit()
    models.script(TRANSCRIBED)

    started = transcribe(teacher, topic, source_id=appendix, source_pages="2")

    assert started.json()["job"]["progress"] == "extracting"
    assert job(teacher, started.json()["job"]["id"])["state"] == "succeeded"
    assert "Test A" not in sent_source(models)["text"]
    assert teacher.get(f"{sources_url(topic[0])}/{appendix}").json()["page_count"] == 2


def test_a_pdf_read_before_its_pages_were_kept_is_still_transcribed_whole(
    teacher, topic, models, admin_settings
):
    appendix = pdf_source(teacher, topic[0], TEST_A, TEST_B)
    with open_session(create_engine_for(admin_settings)) as db:
        db.get_one(Source, appendix).pages = None
        db.commit()
    models.script(TRANSCRIBED)

    started = transcribe(teacher, topic, source_id=appendix)

    assert started.json()["job"]["progress"] != "extracting"
    assert "Test A" in sent_source(models)["text"]
    assert "Test B" in sent_source(models)["text"]


def test_pages_of_a_file_stored_unread_are_checked_against_the_file_and_read(
    teacher, topic, models
):
    content = pdf_with_pages(TEST_A, ())
    stored = store(teacher, topic[0], content, "Příloha.pdf", "application/pdf").json()
    appendix = stored["source"]["id"]

    refused = transcribe(teacher, topic, source_id=appendix, source_pages="3")
    models.script(TRANSCRIBED)
    started = transcribe(teacher, topic, source_id=appendix, source_pages="1")

    assert (refused.status_code, refused.json()["detail"]) == (422, "pages_outside")
    assert job(teacher, started.json()["job"]["id"])["state"] == "succeeded"
    # The chosen page has text: the assistant only transcribes.
    assert len(models.requests) == 1
    assert "Test A" in sent_source(models)["text"]


def test_chosen_pages_in_which_ocr_finds_nothing_fail_the_transcription(teacher, topic, models):
    appendix = pdf_source(teacher, topic[0], TEST_A, ())
    models.script({"text": " "})

    started = transcribe(teacher, topic, source_id=appendix, source_pages="2")

    failed = job(teacher, started.json()["job"]["id"])
    assert (failed["state"], failed["error_kind"]) == ("failed", "nothing_read")
    assert len(models.requests) == 1


def test_a_fork_keeps_the_chosen_pages_and_the_pages_of_its_sources(teacher, sender, topic, models):
    appendix = pdf_source(teacher, topic[0], TEST_A, KEY_PAGE, ())
    transcribed(
        teacher,
        topic,
        models,
        source_id=appendix,
        source_pages="1",
        key_source_id=appendix,
        key_pages="2",
    )
    invite_teachers(teacher, sender, COLLEAGUE)
    grant(teacher, topic[0], COLLEAGUE, "fork")
    as_teacher(teacher, COLLEAGUE)

    fork = teacher.post(f"/api/courses/{topic[0]}/fork").json()["id"]

    forked_topic = (fork, teacher.get(f"/api/courses/{fork}/topics").json()[0]["id"])
    [material] = teacher.get(materials_url(*forked_topic)).json()
    assert (material["source_pages"], material["key_pages"]) == ([1], [2])
    [copied] = teacher.get(f"/api/courses/{fork}/sources").json()
    assert (copied["page_count"], copied["pages_without_text"]) == (3, [3])


def test_ocr_asked_for_reads_only_the_pages_still_without_text(teacher, topic, models):
    appendix = pdf_source(teacher, topic[0], TEST_A, (), ())
    models.script({"text": "Jana: 1. hable"}, TRANSCRIBED)
    transcribe(teacher, topic, source_id=appendix, source_pages="2")
    models.script({"text": "Petr: 1. jugaba"})

    again = teacher.post(f"{sources_url(topic[0])}/{appendix}/extract", json={"ocr": True})

    assert job(teacher, again.json()["job"]["id"])["state"] == "succeeded"
    assert json.loads(models.requests[-1]["prompt"])["page"] == 3
    assert len(models.requests) == 3
    read = teacher.get(f"{sources_url(topic[0])}/{appendix}").json()
    assert read["pages_without_text"] == []
    assert "Jana: 1. hable" in read["text"]
    assert "Petr: 1. jugaba" in read["text"]


def test_a_test_and_its_key_on_pages_without_text_of_one_source_are_read_together(
    teacher, topic, models
):
    appendix = pdf_source(teacher, topic[0], TEST_A, (), ())
    models.script({"text": "1. Ayer yo ___ con Ana."}, {"text": "Klic: 1. hable"}, TRANSCRIBED)

    started = transcribe(
        teacher, topic, source_id=appendix, source_pages="2", key_source_id=appendix, key_pages="3"
    )

    assert job(teacher, started.json()["job"]["id"])["state"] == "succeeded"
    assert [json.loads(r["prompt"]).get("page") for r in models.requests[:2]] == [2, 3]
    assert sent_source(models)["text"] == "1. Ayer yo ___ con Ana."
    assert sent_source(models, "answer_key")["text"] == "Klic: 1. hable"


def test_a_pdf_read_by_ocr_before_its_pages_were_kept_loses_none_of_its_text(
    teacher, topic, models, admin_settings
):
    appendix = pdf_source(teacher, topic[0], TEST_A, (), ())
    with open_session(create_engine_for(admin_settings)) as db:
        read = db.get_one(Source, appendix)
        read.pages, read.extracted_with = None, "ocr"
        db.commit()
    models.script({"text": "Jana: 1. hable"}, {"text": "Petr: 1. jugaba"}, TRANSCRIBED)

    started = transcribe(teacher, topic, source_id=appendix, source_pages="2")

    assert job(teacher, started.json()["job"]["id"])["state"] == "succeeded"
    # Every page without text is read again, not only the chosen one.
    assert [json.loads(r["prompt"]).get("page") for r in models.requests[:2]] == [2, 3]
    assert sent_source(models)["text"] == "Jana: 1. hable"
    text = teacher.get(f"{sources_url(topic[0])}/{appendix}").json()["text"]
    assert "Petr: 1. jugaba" in text


def test_key_pages_in_which_ocr_finds_nothing_fail_the_transcription(teacher, topic, models):
    appendix = pdf_source(teacher, topic[0], TEST_A, ())
    models.script({"text": " "})

    started = transcribe(
        teacher, topic, source_id=appendix, source_pages="1", key_source_id=appendix, key_pages="2"
    )

    failed = job(teacher, started.json()["job"]["id"])
    assert (failed["state"], failed["error_kind"]) == ("failed", "nothing_read")
