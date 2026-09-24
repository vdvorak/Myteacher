"""Sources of a course: the files a teacher supplies and the text read from them.

The kind of a file is read from its content, never from what the browser declared. Text is
extracted by a job: from the file itself for text files and PDFs with a text layer, and by the
assistant (OCR, on the teacher's key) for images and scanned PDFs when the teacher asks for it.
"""

import hashlib
import io
import logging
import os
from datetime import datetime
from typing import Any

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


class ReadText(BaseModel):
    text: str = Field(description="All the text of the attachment, transcribed exactly.")


OCR = Task("source_ocr", ReadText, slot="fast", timeout_s=300)


class UnsupportedFile(Exception):
    pass


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


def pdf_text(content: bytes) -> str:
    """The text layer of a PDF, page by page; raises `JobFailed` for a file pypdf cannot read."""
    from pypdf import PdfReader
    from pypdf.errors import PyPdfError

    try:
        reader = PdfReader(io.BytesIO(content))
        return "\n\n".join((page.extract_text() or "").strip() for page in reader.pages).strip()
    except (PyPdfError, ValueError, KeyError, TypeError, OSError) as error:
        logger.info("unreadable PDF: %r", error)
        raise JobFailed("unreadable_file") from None


async def _ocr(db: InstanceSession, ctx: JobContext, job: Job, source: Source, content: bytes):
    teacher = get_account(db, job.account_id)
    assert teacher is not None
    read = await generate(
        ctx.assistant,
        db,
        OCR,
        teacher=teacher,
        inputs={
            "source_id": source.id,
            "name": source.name,
            "media_type": source.media_type,
            "size": source.size,
            "sha256": hashlib.sha256(content).hexdigest(),
        },
        course_id=source.course_id,
        attachments=[BinaryContent(data=content, media_type=source.media_type)],
    )
    return read.text


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


def extraction(source_id: int, *, ocr: bool) -> Work:
    """The work of an extraction job for the source."""

    async def work(db: InstanceSession, job: Job, ctx: JobContext) -> dict[str, Any]:
        source = db.get(Source, source_id)
        if source is None or source.job_id != job.id:
            # Removed, or started again meanwhile: the later extraction's result counts.
            return {"superseded": True}
        if source.kind == "url":
            return await _snapshot(db, ctx, job, source)
        content = file_of(db, source)
        text: str | None = None
        method = "file"
        if source.kind == "text":
            text = _decoded(content)
        elif source.kind == "pdf" and not ocr:
            # CPU-bound and long for a whole textbook, so off the event loop.
            text = await anyio.to_thread.run_sync(pdf_text, content)
        if not (text or "").strip():
            # A scan or an image. With OCR asked for, a PDF is read by the assistant even when
            # it has a text layer, which in a scan holds a page number or a stamp at best.
            if not ocr:
                raise JobFailed("no_text")
            text, method = await _ocr(db, ctx, job, source, content), "ocr"
            if not text.strip():
                raise JobFailed("no_text")
        # Only if the job is still the source's current extraction, which the model call may
        # have changed.
        db.execute(
            update(Source)
            .where(Source.id == source_id, Source.job_id == job.id)
            .values(text=text, extracted_with=method)
            .execution_options(synchronize_session=False)
        )
        return {"source_id": source_id, "characters": len(text or ""), "extracted_with": method}

    return work
