"""Sources of a course: added and changed by its owner and editors, read by anyone who may view
the course. The file is the request body, so no form encoding is involved; its text is
extracted by a job that the client polls, then it reads the source again."""

from datetime import datetime
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_serializer, field_validator

from myteacher.accounts.models import Account
from myteacher.api.courses import course_for, editable_course
from myteacher.api.deps import Db, Now, requires
from myteacher.api.jobs import JobOut
from myteacher.assistant.service import paying_credential
from myteacher.courses import pages, sources
from myteacher.courses.models import Course, Source, SourceKind
from myteacher.jobs import runner
from myteacher.persistence import InstanceSession
from myteacher.policy import is_teacher

router = APIRouter(prefix="/courses/{course_id}/sources", tags=["sources"])
Teacher = Annotated[Account, requires(is_teacher)]

SourceName = Annotated[str, AfterValidator(str.strip), Field(min_length=1, max_length=200)]
# A file's own name, shortened to fit when it is longer.
FileName = Annotated[str, AfterValidator(str.strip), Field(min_length=1)]


class SourceOut(BaseModel):
    id: int
    name: str
    kind: SourceKind
    media_type: str
    size: int
    visible_to_students: bool
    created_at: datetime
    # "file", "ocr" or, for a web page, "page" once text was extracted; None before.
    extracted_with: str | None
    # For a web page: its address, and when its snapshot was taken (None before).
    url: str | None
    fetched_at: datetime | None
    # How long the extracted text is; None before it was extracted.
    characters: int | None
    # The latest extraction.
    job: JobOut | None

    @field_serializer("created_at", "fetched_at")
    def _utc(self, at: datetime | None) -> str | None:
        return at.strftime("%Y-%m-%dT%H:%M:%SZ") if at else None


class SourceDetail(SourceOut):
    # What the assistant will read.
    text: str | None


class Started(BaseModel):
    source: SourceOut
    # None for a file left unread, which its transcription reads.
    job: JobOut | None


class SourceChange(BaseModel):
    """Only the fields present change; none of them can be unset."""

    model_config = ConfigDict(extra="forbid")

    name: SourceName | None = None
    visible_to_students: bool | None = None

    @field_validator("name", "visible_to_students")
    @classmethod
    def _cannot_be_unset(cls, value: object) -> object:
        if value is None:
            raise ValueError("can be changed but not unset")
        return value


def _web_address(url: str) -> str:
    if not pages.is_web_address(url):
        raise ValueError("an http or https address")
    return url


class PageIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: Annotated[
        str, AfterValidator(str.strip), Field(max_length=2000), AfterValidator(_web_address)
    ]
    # Without one, the page's title names the source.
    name: SourceName | None = None


def _has_text(text: str) -> str:
    if not text.strip() or "\x00" in text:
        raise ValueError("some text, without null characters")
    try:
        # Half of a surrogate pair, which JSON allows, has no UTF-8.
        text.encode()
    except UnicodeEncodeError:
        raise ValueError("valid Unicode text") from None
    return text


class TextIn(BaseModel):
    """Text the teacher pasted, for example from a page that builds its content in the browser."""

    model_config = ConfigDict(extra="forbid")

    name: SourceName
    text: Annotated[str, AfterValidator(_has_text)]


class Extraction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Let the assistant read images and scans, on the actor's key.
    ocr: bool = False


def _out(db: InstanceSession, source: Source) -> dict:
    job = runner.get_job(db, source.job_id) if source.job_id else None
    return {
        "id": source.id,
        "name": source.name,
        "kind": source.kind,
        "media_type": source.media_type,
        "size": source.size,
        "visible_to_students": source.visible_to_students,
        "created_at": source.created_at,
        "extracted_with": source.extracted_with,
        "url": source.url,
        "fetched_at": source.fetched_at,
        "characters": len(source.text) if source.text is not None else None,
        "job": JobOut.of(job) if job else None,
    }


def _source(db: InstanceSession, course: Course, source_id: int) -> Source:
    source = sources.get_source(db, course, source_id)
    if source is None:
        raise HTTPException(status_code=404)
    return source


async def _body(request: Request) -> bytes:
    """The uploaded file, refused with 413 as soon as it exceeds the limit."""
    limit = sources.MAX_SIZE
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > limit:
        raise HTTPException(status_code=413, detail="too_large")
    content = bytearray()
    async for chunk in request.stream():
        content += chunk
        if len(content) > limit:
            raise HTTPException(status_code=413, detail="too_large")
    return bytes(content)


def _start(
    request: Request,
    background: BackgroundTasks,
    db: InstanceSession,
    source: Source,
    *,
    ocr: bool,
    actor: Account,
    now: datetime,
) -> Started:
    job = runner.create_job(
        db, sources.TASK_KIND, starter=actor, course_id=source.course_id, now=now
    )
    if not sources.claim_extraction(db, source, job):
        raise HTTPException(status_code=409, detail="extraction_running")
    # Runs after the response, once this request's transaction has committed.
    background.add_task(
        runner.run,
        request.app.state.jobs,
        job.id,
        sources.extraction(source.id, ocr=ocr),
        progress="extracting",
    )
    return Started(source=SourceOut(**_out(db, source)), job=JobOut.of(job))


def _needs_key(db: InstanceSession, actor: Account, paid: bool) -> None:
    """Refuse work the assistant does on the actor's key when they have none."""
    if paid and paying_credential(db, actor) is None:
        raise HTTPException(status_code=409, detail="no_provider_key")


@router.get("")
def list_sources(course_id: int, db: Db, actor: Teacher) -> list[SourceOut]:
    """The course's sources in the order they were added, without their text."""
    course = course_for(db, actor, course_id)
    return [SourceOut(**_out(db, source)) for source in sources.sources_of(db, course)]


@router.post(
    "",
    status_code=202,
    responses={
        201: {"description": "Stored unread, for its transcription to read"},
        409: {"description": "OCR or transcription asked for without a provider key"},
        413: {"description": "Larger than the limit"},
        415: {"description": "Not a PDF, a text file or an image"},
    },
)
def upload_source(
    course_id: int,
    request: Request,
    response: Response,
    background: BackgroundTasks,
    db: Db,
    now: Now,
    actor: Teacher,
    content: Annotated[bytes, Depends(_body)],
    name: Annotated[FileName, Query(max_length=1000)],
    ocr: bool = False,
    read: bool = True,
) -> Started:
    """Add the request body as a source and start extracting its text. With `read` false the
    source is left unread: it was uploaded to be transcribed, which reads it first on the actor's
    key, so the key is asked for before anything is stored."""
    course = editable_course(db, actor, course_id)
    if not content:
        raise HTTPException(status_code=422, detail="empty_file")
    _needs_key(db, actor, ocr or not read)
    try:
        source = sources.add_source(
            db,
            course,
            name=name,
            content=content,
            declared_type=request.headers.get("content-type", ""),
            uploader=actor,
            now=now,
        )
    except sources.UnsupportedFile:
        raise HTTPException(status_code=415, detail="unsupported_type") from None
    if not read:
        response.status_code = 201
        return Started(source=SourceOut(**_out(db, source)), job=None)
    return _start(request, background, db, source, ocr=ocr, actor=actor, now=now)


@router.post("/url", status_code=202)
def add_page(
    course_id: int,
    body: PageIn,
    request: Request,
    background: BackgroundTasks,
    db: Db,
    now: Now,
    actor: Teacher,
) -> Started:
    """Add a web page as a source and start taking its snapshot, once."""
    course = editable_course(db, actor, course_id)
    source = sources.add_page_source(
        db, course, url=body.url, name=body.name, uploader=actor, now=now
    )
    return _start(request, background, db, source, ocr=False, actor=actor, now=now)


@router.post("/text", status_code=202, responses={413: {"description": "Larger than the limit"}})
def add_text(
    course_id: int,
    body: TextIn,
    request: Request,
    background: BackgroundTasks,
    db: Db,
    now: Now,
    actor: Teacher,
) -> Started:
    """Add pasted text as a text source, read like an uploaded text file."""
    course = editable_course(db, actor, course_id)
    content = body.text.encode()
    if len(content) > sources.MAX_SIZE:
        raise HTTPException(status_code=413, detail="too_large")
    source = sources.add_text_source(
        db, course, name=body.name, text=body.text, uploader=actor, now=now
    )
    return _start(request, background, db, source, ocr=False, actor=actor, now=now)


@router.get("/{source_id}")
def read_source(course_id: int, source_id: int, db: Db, actor: Teacher) -> SourceDetail:
    source = _source(db, course_for(db, actor, course_id), source_id)
    return SourceDetail(**_out(db, source), text=source.text)


@router.get("/{source_id}/file", response_class=Response)
def download_source(course_id: int, source_id: int, db: Db, actor: Teacher) -> Response:
    """The original file. Sandboxed, so that nothing in it runs with the app's rights."""
    source = _source(db, course_for(db, actor, course_id), source_id)
    if source.kind == "url":
        # A web page has no file; its original is its address.
        raise HTTPException(status_code=404)
    content = sources.file_of(db, source)
    media_type = source.media_type
    if source.kind == "text":
        # The encoding it was read in; the default would garble an old Czech Windows file.
        media_type += f"; charset={sources.text_encoding(content) or 'utf-8'}"
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f"inline; filename*=UTF-8''{quote(source.name)}",
            "Content-Security-Policy": "sandbox",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.patch("/{source_id}")
def change_source(
    course_id: int, source_id: int, body: SourceChange, db: Db, actor: Teacher
) -> SourceOut:
    source = _source(db, editable_course(db, actor, course_id), source_id)
    for field in body.model_fields_set:
        setattr(source, field, getattr(body, field))
    return SourceOut(**_out(db, source))


@router.post(
    "/{source_id}/extract",
    status_code=202,
    responses={
        409: {"description": "Running, OCR without a key, or a page's snapshot already taken"}
    },
)
def extract_again(
    course_id: int,
    source_id: int,
    body: Extraction,
    request: Request,
    background: BackgroundTasks,
    db: Db,
    now: Now,
    actor: Teacher,
) -> Started:
    """Extract the text once more, for example with OCR after the file had none. A web page is
    fetched again only while it has no snapshot."""
    source = _source(db, editable_course(db, actor, course_id), source_id)
    if source.kind == "url":
        if body.ocr:
            raise HTTPException(status_code=422, detail="ocr_not_for_pages")
        if source.text is not None:
            raise HTTPException(status_code=409, detail="snapshot_taken")
    if sources.being_read(db, source):
        raise HTTPException(status_code=409, detail="extraction_running")
    _needs_key(db, actor, body.ocr)
    return _start(request, background, db, source, ocr=body.ocr, actor=actor, now=now)


@router.delete("/{source_id}", status_code=204)
def remove_source(course_id: int, source_id: int, db: Db, actor: Teacher) -> Response:
    source = _source(db, editable_course(db, actor, course_id), source_id)
    sources.remove_source(db, source)
    return Response(status_code=204)
