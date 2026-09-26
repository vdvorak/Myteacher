import asyncio
import hashlib
import json
import re

import pytest
from pydantic_ai.exceptions import ModelHTTPError
from sqlalchemy import select

from myteacher import erasure
from myteacher.accounts.service import find_account_by_email
from myteacher.assistant import prompts
from myteacher.assistant.generations import GenerationRecord
from myteacher.courses import sources
from myteacher.courses.models import Source, SourceFile
from myteacher.jobs.models import Job
from myteacher.jobs.runner import create_job, run
from myteacher.persistence import open_session
from tests.helpers import TEACHER, as_student, back_to_teacher, create_engine_for
from tests.test_course_access import COLLEAGUE, NOW, as_teacher, grant, invite_teachers
from tests.test_courses import create_course
from tests.test_interview import add_key

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
TEXT = "Pretérito indefinido: hablé, hablaste, habló.\nČeská poznámka: šťastný.\n"
# Two pages of text, each more than a scan's text layer.
TEST_A = ("Test A: el preterito indefinido", "1. Ayer yo ___ con Ana. a) hable b) hablo")
TEST_B = ("Test B: el preterito imperfecto", "1. De nino yo ___ mucho. a) jugaba b) juego")


def pdf_with_text(*lines: str) -> bytes:
    """A one-page PDF whose text layer holds the lines; none makes a page with no text."""
    return pdf_with_pages(lines)


# Among a page's lines, a scanned image drawn on the page.
SCANNED_IMAGE = object()


def pdf_with_pages(*pages: tuple[object, ...]) -> bytes:
    """A PDF whose pages' text layers hold the lines given for each, and a scanned image where
    `SCANNED_IMAGE` is among them; an empty page has no text."""
    kids = [5 + 2 * index for index in range(len(pages))]
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [%s] /Count %d >>"
        % (b" ".join(b"%d 0 R" % kid for kid in kids), len(pages)),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray "
        b"/BitsPerComponent 8 /Length 1 >>\nstream\n\x80\nendstream",
    ]
    for kid, lines in zip(kids, pages, strict=True):
        texts = [line for line in lines if isinstance(line, str)]
        escaped = (re.sub(r"([()\\])", r"\\\1", line) for line in texts)
        shown = "".join(f"({line}) Tj 0 -16 Td " for line in escaped)
        drawn = "q 400 0 0 500 72 100 cm /Im1 Do Q " if SCANNED_IMAGE in lines else ""
        stream = f"{drawn}BT /F1 12 Tf 72 720 Td {shown}ET".encode("latin-1")
        objects.append(
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> "
            b"/Contents %d 0 R >>" % (kid + 1)
        )
        objects.append(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        xref,
    )
    return bytes(out)


def sources_url(course_id: int) -> str:
    return f"/api/courses/{course_id}/sources"


def upload(client, course_id, content: bytes, name="notes.txt", media_type="text/plain", ocr=False):
    return client.post(
        sources_url(course_id),
        params={"name": name, "ocr": str(ocr).lower()},
        content=content,
        headers={"Content-Type": media_type},
    )


def job(client, job_id) -> dict:
    return client.get(f"/api/jobs/{job_id}").json()


def source(client, course_id, source_id) -> dict:
    return client.get(f"{sources_url(course_id)}/{source_id}").json()


@pytest.fixture
def course(teacher) -> int:
    return create_course(teacher).json()["id"]


# Upload and extraction


def test_a_teacher_uploads_a_text_file_and_sees_the_extracted_text(teacher, course, clock):
    uploaded = upload(teacher, course, TEXT.encode(), name="  Poznámky.txt ")

    assert uploaded.status_code == 202
    body = uploaded.json()
    sid = body["source"]["id"]
    assert body["source"]["name"] == "Poznámky.txt"
    assert body["source"]["kind"] == "text"
    assert body["job"]["kind"] == "source_extraction"
    # The job ran before the test client returned.
    assert job(teacher, body["job"]["id"])["state"] == "succeeded"
    read = source(teacher, course, sid)
    assert read == {
        "id": sid,
        "name": "Poznámky.txt",
        "kind": "text",
        "media_type": "text/plain",
        "size": len(TEXT.encode()),
        "visible_to_students": False,
        "created_at": "2026-09-24T08:00:00Z",
        "extracted_with": "file",
        "url": None,
        "fetched_at": None,
        "characters": len(TEXT),
        "page_count": None,
        "pages_without_text": [],
        "job": read["job"],
        "text": TEXT,
    }
    assert read["job"]["state"] == "succeeded"


# Pasted text


def paste(client, course_id, text=TEXT, name="Pasted page"):
    return client.post(f"{sources_url(course_id)}/text", json={"name": name, "text": text})


def test_a_teacher_pastes_the_text_of_a_page_as_a_text_source(teacher, course):
    pasted = paste(teacher, course, name="  Online textbook, unit 1 ")

    assert pasted.status_code == 202
    body = pasted.json()
    assert body["job"]["kind"] == "source_extraction"
    read = source(teacher, course, body["source"]["id"])
    assert read["name"] == "Online textbook, unit 1"
    assert read["kind"] == "text"
    assert read["media_type"] == "text/plain"
    assert read["size"] == len(TEXT.encode())
    assert read["extracted_with"] == "file"
    assert read["text"] == TEXT
    assert read["job"]["state"] == "succeeded"
    # Its original is the text as pasted.
    assert teacher.get(f"{sources_url(course)}/{read['id']}/file").content == TEXT.encode()


def test_pasted_text_that_looks_like_a_file_stays_text(teacher, course):
    text = "%PDF-1.7 is the format of the textbook."

    body = paste(teacher, course, text=text).json()

    read = source(teacher, course, body["source"]["id"])
    assert (read["kind"], read["media_type"], read["text"]) == ("text", "text/plain", text)


def test_pasted_text_needs_a_name_and_some_text(teacher, course):
    assert paste(teacher, course, name="  ").status_code == 422
    assert paste(teacher, course, text=" \n\t ").status_code == 422
    assert paste(teacher, course, name="x" * 201).status_code == 422
    # Not text, and not read as such.
    assert paste(teacher, course, text="a\x00b").status_code == 422
    # Half of an emoji pair, as a browser writes it into JSON: no UTF-8 for it.
    half = teacher.post(
        f"{sources_url(course)}/text",
        content=b'{"name": "Unit 1", "text": "smile \\ud83d"}',
        headers={"Content-Type": "application/json"},
    )
    assert half.status_code == 422
    assert teacher.get(sources_url(course)).json() == []


def test_pasted_text_larger_than_the_limit_is_refused(teacher, course, monkeypatch):
    monkeypatch.setattr(sources, "MAX_SIZE", 10)

    refused = paste(teacher, course, text="čtyři slova tady")

    assert refused.status_code == 413
    assert refused.json()["detail"] == "too_large"


def test_only_an_editor_pastes_text(teacher, course, shared):
    shared("view")
    assert paste(teacher, course).status_code == 403


def test_a_text_file_in_the_old_czech_encoding_is_read_too(teacher, course):
    sid = upload(teacher, course, TEXT.encode("cp1250")).json()["source"]["id"]

    assert source(teacher, course, sid)["text"] == TEXT


def test_the_text_layer_of_a_pdf_is_extracted(teacher, course, models):
    sid = upload(
        teacher, course, pdf_with_text("Unidad 1", "El presente"), "u1.pdf", "application/pdf"
    ).json()["source"]["id"]

    read = source(teacher, course, sid)
    assert read["kind"] == "pdf"
    assert read["extracted_with"] == "file"
    assert "Unidad 1" in read["text"]
    assert "El presente" in read["text"]
    # No assistant was needed.
    assert models.calls == []


def test_the_text_of_a_pdf_is_kept_page_by_page_naming_the_pages_without_text(teacher, course):
    content = pdf_with_pages(TEST_A, (), TEST_B, ())

    sid = upload(teacher, course, content, "appendix.pdf", "application/pdf").json()["source"]["id"]

    read = source(teacher, course, sid)
    assert read["page_count"] == 4
    assert read["pages_without_text"] == [2, 4]
    assert "Test A" in read["text"]
    assert "Test B" in read["text"]


def test_a_page_with_a_scan_below_a_typed_heading_has_no_text_of_its_own(teacher, course):
    heading = ("Priloha 3: Vyplneny test z ceskeho jazyka a literatury", SCANNED_IMAGE)
    # A page of text with a picture is text.
    illustrated = (*TEST_A, *TEST_B) * 3 + (SCANNED_IMAGE,)
    content = pdf_with_pages(TEST_A, heading, illustrated)

    sid = upload(teacher, course, content, "appendix.pdf", "application/pdf").json()["source"]["id"]

    assert source(teacher, course, sid)["pages_without_text"] == [2]


def test_the_list_holds_the_sources_without_their_text(teacher, course):
    upload(teacher, course, b"first", name="b.txt")
    upload(teacher, course, b"second", name="a.txt")

    listed = teacher.get(sources_url(course)).json()

    # In the order they were added.
    assert [s["name"] for s in listed] == ["b.txt", "a.txt"]
    assert all("text" not in s for s in listed)
    assert listed[0]["characters"] == 5


def test_the_original_file_is_downloaded(teacher, course):
    content = pdf_with_text("Unidad 1")
    sid = upload(teacher, course, content, "Učebnice.pdf", "application/pdf").json()["source"]["id"]

    file = teacher.get(f"{sources_url(course)}/{sid}/file")

    assert file.status_code == 200
    assert file.content == content
    assert file.headers["content-type"] == "application/pdf"
    assert file.headers["x-content-type-options"] == "nosniff"
    assert file.headers["content-security-policy"] == "sandbox"
    assert "filename*=UTF-8''U%C4%8Debnice.pdf" in file.headers["content-disposition"]


def test_the_kind_is_read_from_the_content_not_the_declared_type(teacher, course):
    as_pdf = upload(teacher, course, PNG, "photo.pdf", "application/pdf").json()["source"]

    assert as_pdf["kind"] == "image"
    assert as_pdf["media_type"] == "image/png"
    # Declared as a PDF but not one: refused, not stored.
    assert upload(teacher, course, b"<html>", "x.pdf", "application/pdf").status_code == 415


@pytest.mark.parametrize(
    ("content", "name", "media_type"),
    [
        (b"<svg xmlns='http://www.w3.org/2000/svg'/>", "a.svg", "image/svg+xml"),
        (b"<html><script>alert(1)</script></html>", "a.html", "text/html"),
        (b"PK\x03\x04docx", "a.docx", "application/octet-stream"),
        (b"\x00\x01\x02binary", "a.txt", "text/plain"),
    ],
)
def test_other_files_are_refused(teacher, course, content, name, media_type):
    refused = upload(teacher, course, content, name, media_type)

    assert refused.status_code == 415
    assert refused.json() == {"detail": "unsupported_type"}
    assert teacher.get(sources_url(course)).json() == []


def test_empty_and_oversized_files_are_refused(teacher, course, monkeypatch):
    monkeypatch.setattr(sources, "MAX_SIZE", 100)

    assert upload(teacher, course, b"").json() == {"detail": "empty_file"}
    too_large = upload(teacher, course, b"x" * 101)
    assert too_large.status_code == 413
    assert too_large.json() == {"detail": "too_large"}
    assert upload(teacher, course, b"x" * 100).status_code == 202


def test_the_name_is_required_and_a_long_one_shortened(teacher, course):
    assert upload(teacher, course, b"x", name="   ").status_code == 422
    long = upload(teacher, course, b"x", name="Učebnice " * 40 + ".txt").json()["source"]
    assert len(long["name"]) == 200
    # The extension stays, so the file still opens as what it is.
    assert long["name"].endswith("Učebnic.txt")


def test_a_text_file_without_a_declared_type_is_known_by_its_extension(teacher, course):
    for name in ("notes.md", "notes.TXT"):
        uploaded = upload(teacher, course, b"# Unidad 1", name, "application/octet-stream")
        assert uploaded.status_code == 202
        assert uploaded.json()["source"]["kind"] == "text"
    assert upload(teacher, course, b"# x", "notes.html", "").status_code == 415


def test_the_original_text_is_served_in_the_encoding_it_was_read_in(teacher, course):
    old = upload(teacher, course, TEXT.encode("cp1250")).json()["source"]["id"]
    new = upload(teacher, course, TEXT.encode()).json()["source"]["id"]

    assert teacher.get(f"{sources_url(course)}/{old}/file").headers["content-type"] == (
        "text/plain; charset=windows-1250"
    )
    assert teacher.get(f"{sources_url(course)}/{new}/file").headers["content-type"] == (
        "text/plain; charset=utf-8"
    )


def test_reading_a_pdf_does_not_hold_up_other_requests(teacher, course, monkeypatch):
    import threading

    threads = []
    real = sources.pdf_pages
    monkeypatch.setattr(
        sources,
        "pdf_pages",
        lambda content: threads.append(threading.current_thread()) or real(content),
    )

    upload(teacher, course, pdf_with_text("Unidad 1"), "u1.pdf", "application/pdf")

    # Parsed in a worker thread, not on the event loop that serves requests.
    assert threads
    assert all(t is not threading.main_thread() and "AnyIO" in t.name for t in threads)


# Failed extraction


def test_a_pdf_without_a_text_layer_fails_with_a_readable_reason(teacher, course, models):
    body = upload(teacher, course, pdf_with_text(), "scan.pdf", "application/pdf").json()

    failed = job(teacher, body["job"]["id"])
    assert failed["state"] == "failed"
    assert failed["error_kind"] == "no_text"
    read = source(teacher, course, body["source"]["id"])
    assert read["text"] is None
    assert read["extracted_with"] is None
    assert models.calls == []


def test_an_image_without_ocr_has_no_text(teacher, course):
    body = upload(teacher, course, PNG, "board.png", "image/png").json()

    assert job(teacher, body["job"]["id"])["error_kind"] == "no_text"


def test_a_broken_pdf_fails_as_unreadable(teacher, course):
    body = upload(teacher, course, b"%PDF-1.4\nnot really", "x.pdf", "application/pdf").json()

    assert job(teacher, body["job"]["id"])["error_kind"] == "unreadable_file"


# OCR by the assistant


def test_ocr_reads_an_image_with_the_teachers_key(teacher, course, models):
    add_key(teacher)
    models.script({"text": "Tabule: ser y estar"})

    body = upload(teacher, course, PNG, "board.png", "image/png", ocr=True).json()

    assert job(teacher, body["job"]["id"])["state"] == "succeeded"
    read = source(teacher, course, body["source"]["id"])
    assert read["text"] == "Tabule: ser y estar"
    assert read["extracted_with"] == "ocr"
    (request,) = models.requests
    assert request["attachments"] == ["image/png"]
    assert "Transcribe" in request["instructions"]


def test_ocr_reads_a_scanned_pdf(teacher, course, models):
    add_key(teacher)
    models.script({"text": "Kapitola 1"})

    body = upload(teacher, course, pdf_with_text(), "scan.pdf", "application/pdf", ocr=True).json()

    assert source(teacher, course, body["source"]["id"])["text"] == "Kapitola 1"
    assert models.requests[0]["attachments"] == ["application/pdf"]


def test_ocr_reads_only_the_pages_the_file_holds_no_text_for_one_page_at_a_time(
    teacher, course, models
):
    add_key(teacher)
    models.script({"text": "Jana: 1. hable"}, {"text": "Petr: 1. jugaba"})
    content = pdf_with_pages(TEST_A, (), TEST_B, ())

    body = upload(teacher, course, content, "appendix.pdf", "application/pdf", ocr=True).json()

    assert [json.loads(r["prompt"])["page"] for r in models.requests] == [2, 4]
    assert [r["attachments"] for r in models.requests] == [["application/pdf"]] * 2
    read = source(teacher, course, body["source"]["id"])
    assert read["extracted_with"] == "ocr"
    assert read["page_count"] == 4
    assert read["pages_without_text"] == []
    assert "Test A" in read["text"]
    assert "Jana: 1. hable" in read["text"]
    assert read["text"].endswith("Petr: 1. jugaba")


def test_ocr_asked_for_a_pdf_whose_every_page_has_text_reads_them_all(teacher, course, models):
    # The teacher asks because the text layer is wrong.
    sid = upload(teacher, course, pdf_with_pages(TEST_A, TEST_B), "u.pdf", "application/pdf")
    add_key(teacher)
    models.script({"text": "Test A"}, {"text": "Test B"})

    again = teacher.post(
        f"{sources_url(course)}/{sid.json()['source']['id']}/extract", json={"ocr": True}
    )

    assert job(teacher, again.json()["job"]["id"])["state"] == "succeeded"
    assert [json.loads(r["prompt"])["page"] for r in models.requests] == [1, 2]


def test_ocr_asked_for_reads_a_pdf_even_with_a_thin_text_layer(teacher, course, models):
    # A scan whose text layer holds only a page number or a scanner's stamp.
    add_key(teacher)
    models.script({"text": "Kapitola 1: El presente"})

    body = upload(
        teacher, course, pdf_with_text("12"), "scan.pdf", "application/pdf", ocr=True
    ).json()

    read = source(teacher, course, body["source"]["id"])
    assert read["extracted_with"] == "ocr"
    assert read["text"] == "Kapitola 1: El presente"


def test_a_text_file_is_never_sent_to_ocr(teacher, course, models):
    add_key(teacher)

    body = upload(teacher, course, b"notes", ocr=True).json()

    assert source(teacher, course, body["source"]["id"])["extracted_with"] == "file"
    assert models.calls == []


def test_ocr_is_recorded_without_the_file(teacher, course, models, admin_settings):
    add_key(teacher)
    models.script({"text": "Tabule"})

    sid = upload(teacher, course, PNG, "board.png", "image/png", ocr=True).json()["source"]["id"]

    with open_session(create_engine_for(admin_settings)) as db:
        (record,) = db.scalars(select(GenerationRecord)).all()
    assert record.task_kind == "source_ocr"
    assert record.course_id == course
    assert record.inputs == {
        "source_id": sid,
        "name": "board.png",
        "media_type": "image/png",
        "size": len(PNG),
        "sha256": hashlib.sha256(PNG).hexdigest(),
    }
    assert record.output == {"text": "Tabule"}


def test_ocr_that_reads_nothing_fails_as_nothing_read(teacher, course, models):
    add_key(teacher)
    models.script({"text": "   "})

    body = upload(teacher, course, PNG, "board.png", "image/png", ocr=True).json()

    assert job(teacher, body["job"]["id"])["error_kind"] == "nothing_read"


def test_ocr_needs_a_provider_key(teacher, course):
    refused = upload(teacher, course, PNG, "board.png", "image/png", ocr=True)

    assert refused.status_code == 409
    assert refused.json() == {"detail": "no_provider_key"}
    assert teacher.get(sources_url(course)).json() == []


def test_a_provider_failure_during_ocr_is_the_jobs_reason(teacher, course, models):
    add_key(teacher)
    models.script(ModelHTTPError(429, "claude", {"error": "rate limited"}))

    body = upload(teacher, course, PNG, "board.png", "image/png", ocr=True).json()

    assert job(teacher, body["job"]["id"])["error_kind"] == "quota"


def test_extraction_runs_again_with_ocr(teacher, course, models):
    first = upload(teacher, course, PNG, "board.png", "image/png").json()
    sid = first["source"]["id"]
    add_key(teacher)
    models.script({"text": "Tabule"})

    again = teacher.post(f"{sources_url(course)}/{sid}/extract", json={"ocr": True})

    assert again.status_code == 202
    assert again.json()["job"]["id"] != first["job"]["id"]
    assert job(teacher, again.json()["job"]["id"])["state"] == "succeeded"
    read = source(teacher, course, sid)
    assert read["text"] == "Tabule"
    assert read["job"]["id"] == again.json()["job"]["id"]


def test_running_again_without_ocr_checks_the_key_only_when_needed(teacher, course):
    sid = upload(teacher, course, b"notes").json()["source"]["id"]

    assert (
        teacher.post(f"{sources_url(course)}/{sid}/extract", json={"ocr": False}).status_code == 202
    )
    refused = teacher.post(f"{sources_url(course)}/{sid}/extract", json={"ocr": True})
    assert refused.json() == {"detail": "no_provider_key"}


def test_extraction_is_not_started_twice_at_once(teacher, course, admin_settings):
    sid = upload(teacher, course, b"notes").json()["source"]["id"]
    with open_session(create_engine_for(admin_settings)) as db:
        db.get_one(Job, source(teacher, course, sid)["job"]["id"]).state = "running"
        db.commit()

    refused = teacher.post(f"{sources_url(course)}/{sid}/extract", json={"ocr": False})

    assert refused.status_code == 409
    assert refused.json() == {"detail": "extraction_running"}


def test_an_earlier_extraction_does_not_overwrite_a_later_one(teacher, course, admin_settings):
    sid = upload(teacher, course, b"first version").json()["source"]["id"]
    engine = create_engine_for(admin_settings)
    with open_session(engine) as db:
        # A job that is no longer the source's current one, as when it was started again.
        stale = create_job(
            db,
            sources.TASK_KIND,
            starter=find_account_by_email(db, TEACHER),
            course_id=course,
            now=NOW,
        ).id
        db.get_one(Source, sid).text = "the later result"
        db.commit()

    asyncio.run(run(teacher.app.state.jobs, stale, sources.extraction(sid, ocr=False)))

    assert source(teacher, course, sid)["text"] == "the later result"
    assert job(teacher, stale)["state"] == "succeeded"


# Visibility and removal


def test_a_source_is_marked_visible_to_students_and_back(teacher, course):
    sid = upload(teacher, course, b"notes").json()["source"]["id"]
    url = f"{sources_url(course)}/{sid}"

    shown = teacher.patch(url, json={"visible_to_students": True})
    hidden = teacher.patch(url, json={"visible_to_students": False})

    assert shown.status_code == 200
    assert shown.json()["visible_to_students"] is True
    assert hidden.json()["visible_to_students"] is False
    assert teacher.patch(url, json={"visible_to_students": None}).status_code == 422
    assert teacher.patch(url, json={"text": "x"}).status_code == 422


def test_a_source_is_renamed(teacher, course):
    sid = upload(teacher, course, b"notes").json()["source"]["id"]

    renamed = teacher.patch(f"{sources_url(course)}/{sid}", json={"name": " Chapter 1 "})

    assert renamed.json()["name"] == "Chapter 1"
    assert teacher.patch(f"{sources_url(course)}/{sid}", json={"name": ""}).status_code == 422


def test_a_source_is_removed_with_its_file(teacher, course, admin_settings):
    sid = upload(teacher, course, b"notes").json()["source"]["id"]
    url = f"{sources_url(course)}/{sid}"

    removed = teacher.delete(url)

    assert removed.status_code == 204
    assert teacher.get(url).status_code == 404
    assert teacher.get(f"{url}/file").status_code == 404
    assert teacher.delete(url).status_code == 404
    with open_session(create_engine_for(admin_settings)) as db:
        assert db.scalars(select(SourceFile)).all() == []


# Access


@pytest.fixture
def shared(teacher, sender, course):
    """The course with one source, shared with a colleague at a right the test chooses."""
    invite_teachers(teacher, sender, COLLEAGUE)
    sid = upload(teacher, course, TEXT.encode()).json()["source"]["id"]

    def share(right):
        back_to_teacher(teacher)
        grant(teacher, course, COLLEAGUE, right)
        as_teacher(teacher, COLLEAGUE)
        return sid

    return share


def test_a_viewer_reads_the_sources_but_cannot_change_them(teacher, course, shared):
    sid = shared("view")
    url = f"{sources_url(course)}/{sid}"

    assert [s["id"] for s in teacher.get(sources_url(course)).json()] == [sid]
    assert teacher.get(url).json()["text"] == TEXT
    assert teacher.get(f"{url}/file").content == TEXT.encode()
    refused = [
        upload(teacher, course, b"mine"),
        teacher.patch(url, json={"visible_to_students": True}),
        teacher.post(f"{url}/extract", json={"ocr": False}),
        teacher.delete(url),
    ]
    assert [r.status_code for r in refused] == [403] * 4


def test_an_editor_adds_and_changes_sources(teacher, course, shared):
    sid = shared("edit")
    url = f"{sources_url(course)}/{sid}"

    assert upload(teacher, course, b"mine").status_code == 202
    assert teacher.patch(url, json={"visible_to_students": True}).status_code == 200
    assert teacher.delete(url).status_code == 204


def test_a_teacher_without_a_right_cannot_see_the_sources(teacher, sender, course):
    sid = upload(teacher, course, b"notes").json()["source"]["id"]
    invite_teachers(teacher, sender, COLLEAGUE)
    as_teacher(teacher, COLLEAGUE)

    assert teacher.get(sources_url(course)).status_code == 404
    assert teacher.get(f"{sources_url(course)}/{sid}").status_code == 404
    assert teacher.get(f"{sources_url(course)}/{sid}/file").status_code == 404
    assert upload(teacher, course, b"x").status_code == 404


def test_a_source_of_another_course_is_not_found(teacher, course):
    other = create_course(teacher, name="Algebra").json()["id"]
    sid = upload(teacher, course, b"notes").json()["source"]["id"]

    assert teacher.get(f"{sources_url(other)}/{sid}").status_code == 404
    assert teacher.delete(f"{sources_url(other)}/{sid}").status_code == 404


def test_students_cannot_reach_sources(teacher, sender, course):
    as_student(teacher, sender)

    assert teacher.get(sources_url(course)).status_code == 403
    assert upload(teacher, course, b"x").status_code == 403


def test_sources_hold_no_student_data():
    tables = {rule.table for rule in erasure.rules()}

    assert not {"source", "source_file"} & tables


def test_the_ocr_prompt_is_versioned():
    assert prompts.current_version("source_ocr") == "v1"
