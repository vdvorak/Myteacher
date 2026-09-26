"""Sources of a course: the files a teacher supplies and the text read from them.

The kind of a file is read from its content, never from what the browser declared. Text is
extracted by a job: from the file itself for text files and the text layer of PDFs, page by page,
and by the assistant (OCR, on the teacher's key) only for what the file holds no text for, images
and the pages of a PDF that are scans or handwriting, when the teacher asks for it or a
transcription needs them.
"""

import hashlib
import io
import logging
import os
import re
from datetime import datetime
from typing import Any, NamedTuple

import anyio
from pydantic import BaseModel, Field
from pydantic_ai.messages import BinaryContent
from sqlalchemy import delete, select, update

from myteacher.accounts.models import Account
from myteacher.accounts.service import get_account
from myteacher.assistant.service import Task, generate
from myteacher.courses.models import Course, Source, SourceFile, SourceKind
from myteacher.jobs.models import Job
from myteacher.jobs.runner import JobContext, JobFailed, Work
from myteacher.persistence import InstanceSession

logger = logging.getLogger(__name__)

TASK_KIND = "source_extraction"
# A textbook scan fits; a whole library does not.
MAX_SIZE = 20 * 1024 * 1024
MAX_NAME = 200
# Fewer characters than this on a page is a scan's text layer: a page number or a scanner's stamp
# at best.
SCAN_LAYER = 40
# Fewer characters than this on a page holding an image is a scan below a typed heading; a page
# of text with a picture holds more.
SCAN_WITH_HEADING = 300


class ReadText(BaseModel):
    text: str = Field(description="All the text of the attachment, transcribed exactly.")


OCR = Task("source_ocr", ReadText, slot="fast", timeout_s=300)


class UnsupportedFile(Exception):
    pass


class BadPages(ValueError):
    """Pages written other than as numbers and ranges, such as "1-2" or "3, 5-7"."""


class PagesOutside(ValueError):
    """Pages the document does not have."""


def _is_text(content: bytes) -> bool:
    return b"\x00" not in content and _decoded(content) is not None


def text_encoding(content: bytes) -> str | None:
    """UTF-8 (with or without a byte order mark), else the older Czech Windows encoding."""
    for encoding in ("utf-8", "windows-1250"):
        try:
            content.decode(encoding)
            return encoding
        except UnicodeDecodeError:
            continue
    return None


def _decoded(content: bytes) -> str | None:
    encoding = text_encoding(content)
    return content.decode("utf-8-sig" if encoding == "utf-8" else encoding) if encoding else None


# Text formats a teacher may upload; anything else declared as text (HTML, SVG) is refused,
# because the original is served back to the browser.
_TEXT_TYPES = ("text/plain", "text/markdown")
# Browsers often declare no type for these, so the extension names them.
_TEXT_EXTENSIONS = {".txt": "text/plain", ".md": "text/markdown"}


def shortened(name: str) -> str:
    """The name cut to the limit, keeping its extension so the file still opens as what it is."""
    if len(name) <= MAX_NAME:
        return name
    stem, extension = os.path.splitext(name)
    if len(extension) > 10:
        stem, extension = name, ""
    return stem[: MAX_NAME - len(extension)].rstrip() + extension


def sniff(content: bytes, declared: str, name: str = "") -> tuple[SourceKind, str]:
    """The kind and media type of a file, from its first bytes; raises `UnsupportedFile`."""
    if content.startswith(b"%PDF-"):
        return "pdf", "application/pdf"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image", "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image", "image/jpeg"
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image", "image/webp"
    media_type = declared.split(";")[0].strip().lower()
    if media_type not in _TEXT_TYPES:
        media_type = _TEXT_EXTENSIONS.get(os.path.splitext(name)[1].lower(), "")
    if media_type and _is_text(content):
        return "text", media_type
    raise UnsupportedFile()


def sources_of(db: InstanceSession, course: Course) -> list[Source]:
    return list(db.scalars(select(Source).where(Source.course_id == course.id).order_by(Source.id)))


def get_source(db: InstanceSession, course: Course, source_id: int) -> Source | None:
    return db.scalars(
        select(Source).where(Source.id == source_id, Source.course_id == course.id)
    ).first()


def being_read(db: InstanceSession, source: Source) -> bool:
    """Whether the source's latest extraction has yet to end."""
    job = db.get(Job, source.job_id) if source.job_id else None
    return job is not None and job.state in ("queued", "running")


def file_of(db: InstanceSession, source: Source) -> bytes:
    return db.get_one(SourceFile, source.id).content


def add_source(
    db: InstanceSession,
    course: Course,
    *,
    name: str,
    content: bytes,
    declared_type: str,
    uploader: Account,
    now: datetime,
) -> Source:
    kind, media_type = sniff(content, declared_type, name)
    return _stored(db, course, name, kind, media_type, content, uploader, now)


def add_text_source(
    db: InstanceSession, course: Course, *, name: str, text: str, uploader: Account, now: datetime
) -> Source:
    """Pasted text as a text source, never sniffed: text that starts like a PDF stays text."""
    return _stored(db, course, name, "text", "text/plain", text.encode(), uploader, now)


def _stored(
    db: InstanceSession,
    course: Course,
    name: str,
    kind: SourceKind,
    media_type: str,
    content: bytes,
    uploader: Account,
    now: datetime,
) -> Source:
    source = Source(
        course_id=course.id,
        name=shortened(name),
        kind=kind,
        media_type=media_type,
        size=len(content),
        visible_to_students=False,
        uploaded_by_id=uploader.id,
        created_at=now,
    )
    db.add(source)
    db.flush()
    db.add(SourceFile(source_id=source.id, content=content))
    return source


def add_page_source(
    db: InstanceSession,
    course: Course,
    *,
    url: str,
    name: str | None,
    uploader: Account,
    now: datetime,
) -> Source:
    """A web page as a source; its snapshot is taken by an extraction job. Without a name it is
    named after its URL until the snapshot gives it the page's title."""
    source = Source(
        course_id=course.id,
        name=shortened(name or url),
        kind="url",
        media_type="",
        size=0,
        visible_to_students=False,
        url=url,
        uploaded_by_id=uploader.id,
        created_at=now,
    )
    db.add(source)
    db.flush()
    return source


def remove_source(db: InstanceSession, source: Source) -> None:
    db.execute(delete(SourceFile).where(SourceFile.source_id == source.id))
    db.delete(source)


def claim_extraction(db: InstanceSession, source: Source, job: Job) -> bool:
    """Make the job the source's current extraction, unless another request did so first."""
    claimed = db.execute(
        update(Source)
        .where(
            Source.id == source.id,
            Source.job_id.is_(None) if source.job_id is None else Source.job_id == source.job_id,
        )
        .values(job_id=job.id)
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:  # type: ignore[attr-defined]
        return False
    source.job_id = job.id
    return True


class PdfPage(NamedTuple):
    text: str
    # Whether the page holds an image, such as a scan.
    has_image: bool


def _draws_image(content: Any, resources: Any, pdf: Any, depth: int = 0) -> bool:
    """Whether a page's content, or a form it draws, draws an image: listed among the page's
    resources is not enough, as pages often share them."""
    from pypdf.generic import ContentStream

    if content is None or depth > 2:
        return False
    listed = resources.get_object().get("/XObject") if resources is not None else None
    objects = listed.get_object() if listed is not None else {}
    stream = content if isinstance(content, ContentStream) else ContentStream(content, pdf)
    for operands, operator in stream.operations:
        if operator == b"INLINE IMAGE":
            return True
        if operator != b"Do" or not operands or operands[0] not in objects:
            continue
        drawn = objects[operands[0]].get_object()
        if drawn.get("/Subtype") == "/Image":
            return True
        if drawn.get("/Subtype") == "/Form" and _draws_image(
            drawn, drawn.get("/Resources") or resources, pdf, depth + 1
        ):
            return True
    return False


def pdf_pages(content: bytes) -> list[PdfPage]:
    """The text layer of a PDF page by page, and whether each page holds an image; raises
    `JobFailed` for a file pypdf cannot read."""
    from pypdf import PdfReader
    from pypdf.errors import PyPdfError

    try:
        reader = PdfReader(io.BytesIO(content))
        return [
            PdfPage(
                (page.extract_text() or "").strip(),
                _draws_image(page.get_contents(), page.get("/Resources"), reader),
            )
            for page in reader.pages
        ]
    except (PyPdfError, ValueError, KeyError, TypeError, OSError) as error:
        logger.info("unreadable PDF: %r", error)
        raise JobFailed("unreadable_file") from None


def pdf_split(content: bytes) -> list[bytes]:
    """Each page of a PDF as a PDF of its own, for the assistant to read one page at a time;
    raises `JobFailed` for a file pypdf cannot read."""
    from pypdf import PdfReader, PdfWriter
    from pypdf.errors import PyPdfError

    try:
        split = []
        for page in PdfReader(io.BytesIO(content)).pages:
            writer = PdfWriter()
            writer.add_page(page)
            buffer = io.BytesIO()
            writer.write(buffer)
            split.append(buffer.getvalue())
        return split
    except (PyPdfError, ValueError, KeyError, TypeError, OSError) as error:
        logger.info("unreadable PDF: %r", error)
        raise JobFailed("unreadable_file") from None


def page_count(db: InstanceSession, source: Source) -> int:
    """How many pages a PDF source has, from its kept pages or else its file; none for a file
    pypdf cannot read."""
    if source.pages is not None:
        return len(source.pages)
    from pypdf import PdfReader
    from pypdf.errors import PyPdfError

    try:
        return len(PdfReader(io.BytesIO(file_of(db, source))).pages)
    except (PyPdfError, ValueError, KeyError, TypeError, OSError):
        return 0


_RANGE = re.compile(r"(\d+)(?:\s*-\s*(\d+))?")


def chosen_pages(written: str, count: int) -> list[int]:
    """The pages a teacher wrote, such as "1-2" or "3, 5–7", in order and each once; raises
    `BadPages` or `PagesOutside` for a document of `count` pages."""
    ranges = []
    for part in written.replace("–", "-").split(","):
        match = _RANGE.fullmatch(part.strip())
        if match is None:
            raise BadPages()
        first, last = int(match[1]), int(match[2] or match[1])
        if last < first:
            raise BadPages()
        ranges.append((first, last))
    # Checked before the ranges are spelled out, which a range such as 1-999999999 would not be.
    if any(first < 1 or last > count for first, last in ranges):
        raise PagesOutside()
    return sorted({page for first, last in ranges for page in range(first, last + 1)})


def scanned(text: str, has_image: bool) -> bool:
    """Whether a page holds no text of its own but a scan or handwriting: its text layer is
    thin, or it holds an image below a typed heading at most."""
    length = len(text.strip())
    return length < SCAN_LAYER or (has_image and length < SCAN_WITH_HEADING)


def pages_without_text(source: Source) -> list[int]:
    """The pages of a PDF read from its file that hold no text of their own, numbered from 1."""
    return [
        number
        for number, page in enumerate(source.pages or [], 1)
        if page["read_with"] == "file" and page["scan"]
    ]


def text_of_pages(source: Source, pages: list[int] | None) -> str:
    """The source's text, or only that of the pages given when its pages are kept."""
    if pages is None or source.pages is None:
        return source.text or ""
    kept = source.pages
    return "\n\n".join(kept[n - 1]["text"] for n in pages if n <= len(kept) and kept[n - 1]["text"])


def lacks_text_for(source: Source, pages: list[int] | None) -> bool:
    """Whether the source lacks text that a transcription of the pages (all when None) needs: it
    was never read, or it is a PDF whose pages were not kept though pages are chosen, or some of
    whose wanted pages the file holds no text for."""
    if not source.text:
        return True
    if source.kind != "pdf":
        return False
    if source.pages is None:
        return pages is not None
    wanted = pages if pages is not None else range(1, len(source.pages) + 1)
    return bool(set(wanted) & set(pages_without_text(source)))


async def _ocr(
    db: InstanceSession,
    ctx: JobContext,
    job: Job,
    source: Source,
    content: bytes,
    page: int | None = None,
) -> str:
    """The text the assistant reads in an image, or in one page of a PDF given as its own file."""
    teacher = get_account(db, job.account_id)
    assert teacher is not None
    inputs: dict[str, Any] = {
        "source_id": source.id,
        "name": source.name,
        "media_type": source.media_type,
        "size": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    }
    if page is not None:
        inputs["page"] = page
    read = await generate(
        ctx.assistant,
        db,
        OCR,
        teacher=teacher,
        inputs=inputs,
        course_id=source.course_id,
        attachments=[BinaryContent(data=content, media_type=source.media_type)],
    )
    return read.text


async def _read_pdf(
    db: InstanceSession,
    ctx: JobContext,
    job: Job,
    source: Source,
    content: bytes,
    *,
    ocr: bool,
    ocr_if_no_text: bool,
    wanted: list[int] | None,
) -> list[dict[str, Any]]:
    """The pages of a PDF, each read from the file, and by the assistant when the file holds no
    text for it: see `extraction`."""
    # CPU-bound and long for a whole textbook, so off the event loop.
    layers = await anyio.to_thread.run_sync(pdf_pages, content)
    pages: list[dict[str, Any]] = [
        {"text": page.text, "read_with": "file", "scan": scanned(page.text, page.has_image)}
        for page in layers
    ]
    # What the assistant read before stays: it is not paid for twice.
    before = source.pages if source.pages is not None and len(source.pages) == len(pages) else []
    for number, page in enumerate(pages, 1):
        if page["scan"] and before and before[number - 1]["read_with"] == "ocr":
            pages[number - 1] = before[number - 1]
    unread = [n for n, page in enumerate(pages, 1) if page["scan"] and page["read_with"] == "file"]
    if ocr:
        # With nothing left without text, the teacher asks because the text read is wrong.
        to_read = unread or list(range(1, len(pages) + 1))
    elif ocr_if_no_text:
        to_read = [n for n in unread if wanted is None or n in wanted]
    else:
        to_read = []
    if to_read:
        split = await anyio.to_thread.run_sync(pdf_split, content)
        for number in to_read:
            text = await _ocr(db, ctx, job, source, split[number - 1], page=number)
            pages[number - 1] = {**pages[number - 1], "text": text.strip(), "read_with": "ocr"}
    return pages


async def _snapshot(
    db: InstanceSession, ctx: JobContext, job: Job, source: Source
) -> dict[str, Any]:
    """Fetch the page once and keep its readable text."""
    assert source.url is not None
    source_id, url, named_after_url = source.id, source.url, source.name == shortened(source.url)
    # No transaction stays open while the page is fetched.
    db.commit()
    page = await ctx.pages.fetch(url)
    values: dict[str, Any] = {
        "text": page.text,
        "extracted_with": "page",
        "media_type": page.media_type,
        "size": page.size,
        "fetched_at": ctx.assistant.clock(),
    }
    if named_after_url and page.title:
        values["name"] = shortened(page.title)
    # Only if the job is still the current one and no snapshot was taken: it never changes.
    db.execute(
        update(Source)
        .where(Source.id == source_id, Source.job_id == job.id, Source.text.is_(None))
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    return {"source_id": source_id, "characters": len(page.text), "extracted_with": "page"}


def extraction(
    source_id: int, *, ocr: bool, ocr_if_no_text: bool = False, pages: list[int] | None = None
) -> Work:
    """The work of an extraction job for the source. A text file is read as it is, and a PDF
    page by page from its file; the assistant reads by OCR only what the file holds no text for:
    an image, or the pages of a PDF that are scans or handwriting. It does so when `ocr`, then
    reading a PDF with no page left without text wholly, as the teacher asks because the text read
    is wrong; and when `ocr_if_no_text`, for the pages among `pages` (all when None). Pages the
    assistant read before are kept rather than read again."""

    async def work(db: InstanceSession, job: Job, ctx: JobContext) -> dict[str, Any]:
        source = db.get(Source, source_id)
        if source is None or source.job_id != job.id:
            # Removed, or started again meanwhile: the later extraction's result counts.
            return {"superseded": True}
        if source.kind == "url":
            return await _snapshot(db, ctx, job, source)
        content = file_of(db, source)
        read: list[dict[str, Any]] | None = None
        if source.kind == "text":
            text, method = _decoded(content) or "", "file"
        elif source.kind == "pdf":
            read = await _read_pdf(
                db, ctx, job, source, content, ocr=ocr, ocr_if_no_text=ocr_if_no_text, wanted=pages
            )
            text = "\n\n".join(page["text"] for page in read if page["text"]).strip()
            method = "ocr" if any(page["read_with"] == "ocr" for page in read) else "file"
        elif ocr or ocr_if_no_text:
            text, method = await _ocr(db, ctx, job, source, content), "ocr"
        else:
            text, method = "", "file"
        if not text.strip():
            raise JobFailed("nothing_read" if method == "ocr" else "no_text")
        # Only if the job is still the source's current extraction, which the model call may
        # have changed.
        db.execute(
            update(Source)
            .where(Source.id == source_id, Source.job_id == job.id)
            .values(text=text, extracted_with=method, pages=read)
            .execution_options(synchronize_session=False)
        )
        return {"source_id": source_id, "characters": len(text), "extracted_with": method}

    return work
