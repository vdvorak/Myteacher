"""Reference documents of a topic: generated on an editor's key from the approved concept map,
edited and discarded by the course's owner and editors, read by anyone who may view the course.

Generation runs as a job; the client polls it, then reads the document again. A document is
answered with its latest version, each citation carrying the name of the source it points at.
"""

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, field_serializer

from myteacher.accounts.models import Account
from myteacher.api.courses import course_for, editable_course
from myteacher.api.deps import Db, Now, requires
from myteacher.api.jobs import JobOut
from myteacher.assistant.service import paying_credential
from myteacher.courses import concepts, documents, topics
from myteacher.courses.documents import Content
from myteacher.courses.models import Course, ReferenceDocument, ReferenceKind, Topic
from myteacher.courses.sources import sources_of
from myteacher.jobs import runner
from myteacher.persistence import InstanceSession
from myteacher.policy import is_teacher

router = APIRouter(
    prefix="/courses/{course_id}/topics/{topic_id}/reference-documents",
    tags=["reference documents"],
)
Teacher = Annotated[Account, requires(is_teacher)]


class CitationOut(BaseModel):
    source_id: int
    # None once the source was removed from the course.
    source_name: str | None
    location: str


class PassageOut(BaseModel):
    markdown: str
    citations: list[CitationOut]
    # No citation: the passage rests on no source.
    unsourced: bool


class DocumentOut(BaseModel):
    id: int
    kind: str
    # Of the latest version; None until the first one was generated.
    title: str | None
    version: int | None
    created_at: datetime
    # The latest generation job.
    job: JobOut | None

    @field_serializer("created_at")
    def _utc(self, at: datetime) -> str:
        return at.strftime("%Y-%m-%dT%H:%M:%SZ")


class DocumentDetail(DocumentOut):
    passages: list[PassageOut]
    unsourced_passages: int


class Started(BaseModel):
    document: DocumentOut
    job: JobOut


class DocumentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: ReferenceKind


class Edit(Content):
    # The version the teacher edited; a newer one refuses the edit.
    based_on: int


class Reaction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Edits and discards are recorded by those actions themselves.
    kind: Literal["kept"]


def _summary(db: InstanceSession, document: ReferenceDocument) -> dict:
    job = runner.get_job(db, document.job_id) if document.job_id else None
    version = documents.latest_version(db, document)
    return {
        "id": document.id,
        "kind": document.kind,
        "title": version.title if version else None,
        "version": version.number if version else None,
        "created_at": document.created_at,
        "job": JobOut.of(job) if job else None,
    }


def _detail(db: InstanceSession, course: Course, document: ReferenceDocument) -> DocumentDetail:
    version = documents.latest_version(db, document)
    names = {s.id: s.name for s in sources_of(db, course)}
    passages = [
        PassageOut(
            markdown=p["markdown"],
            citations=[
                CitationOut(
                    source_id=c["source_id"],
                    source_name=names.get(c["source_id"]),
                    location=c["location"],
                )
                for c in p["citations"]
            ],
            unsourced=not p["citations"],
        )
        for p in (version.passages if version else [])
    ]
    return DocumentDetail(
        **_summary(db, document),
        passages=passages,
        unsourced_passages=sum(p.unsourced for p in passages),
    )


def _topic(db: InstanceSession, course: Course, topic_id: int) -> Topic:
    topic = topics.get_topic(db, course, topic_id)
    if topic is None:
        raise HTTPException(status_code=404)
    return topic


def _document(db: InstanceSession, topic: Topic, document_id: int) -> ReferenceDocument:
    document = documents.get_document(db, topic, document_id)
    if document is None:
        raise HTTPException(status_code=404)
    return document


def _schedule(
    request: Request,
    background: BackgroundTasks,
    db: InstanceSession,
    document: ReferenceDocument,
    actor: Account,
    now: datetime,
) -> Started:
    if paying_credential(db, actor) is None:
        raise HTTPException(status_code=409, detail="no_provider_key")
    job = runner.create_job(
        db, documents.TASK_KIND, starter=actor, course_id=document.course_id, now=now
    )
    document.job_id = job.id
    db.flush()
    # Runs after the response, once this request's transaction has committed.
    background.add_task(
        runner.run, request.app.state.jobs, job.id, documents.generation(document.id)
    )
    return Started(document=DocumentOut(**_summary(db, document)), job=JobOut.of(job))


@router.get("")
def list_documents(course_id: int, topic_id: int, db: Db, actor: Teacher) -> list[DocumentOut]:
    """The topic's documents in the order they were generated, without their text."""
    topic = _topic(db, course_for(db, actor, course_id), topic_id)
    return [DocumentOut(**_summary(db, d)) for d in documents.documents_of(db, topic)]


@router.post(
    "",
    status_code=202,
    responses={409: {"description": "The concept map is not approved, or no provider key"}},
)
def generate_document(
    course_id: int,
    topic_id: int,
    body: DocumentIn,
    request: Request,
    background: BackgroundTasks,
    db: Db,
    now: Now,
    actor: Teacher,
) -> Started:
    """Let the assistant write a reference document of the kind asked for."""
    course = editable_course(db, actor, course_id)
    topic = _topic(db, course, topic_id)
    concept_map = concepts.map_of(db, topic)
    if concept_map is None or concept_map.state != "approved":
        raise HTTPException(status_code=409, detail="map_not_approved")
    if paying_credential(db, actor) is None:
        raise HTTPException(status_code=409, detail="no_provider_key")
    document = documents.start(db, topic, body.kind, actor, now=now)
    return _schedule(request, background, db, document, actor, now)


@router.get("/{document_id}")
def read_document(
    course_id: int, topic_id: int, document_id: int, db: Db, actor: Teacher
) -> DocumentDetail:
    course = course_for(db, actor, course_id)
    return _detail(db, course, _document(db, _topic(db, course, topic_id), document_id))


@router.post(
    "/{document_id}/retry", status_code=202, responses={409: {"description": "Nothing failed"}}
)
def retry_document(
    course_id: int,
    topic_id: int,
    document_id: int,
    request: Request,
    background: BackgroundTasks,
    db: Db,
    now: Now,
    actor: Teacher,
) -> Started:
    """Generate once more a document whose generation failed."""
    course = editable_course(db, actor, course_id)
    document = _document(db, _topic(db, course, topic_id), document_id)
    job = runner.get_job(db, document.job_id) if document.job_id else None
    if document.generation_id is not None or job is None or job.state != "failed":
        raise HTTPException(status_code=409, detail="nothing_to_retry")
    return _schedule(request, background, db, document, actor, now)


@router.post(
    "/{document_id}/versions",
    status_code=201,
    responses={409: {"description": "Not generated yet, or a newer version was saved"}},
)
def edit_document(
    course_id: int,
    topic_id: int,
    document_id: int,
    body: Edit,
    db: Db,
    now: Now,
    actor: Teacher,
) -> DocumentDetail:
    """Save the teacher's text as a new version; the edit is recorded against the generation."""
    course = editable_course(db, actor, course_id)
    document = _document(db, _topic(db, course, topic_id), document_id)
    content = Content.model_validate(body.model_dump(exclude={"based_on"}))
    try:
        documents.edit(db, course, document, content, actor, based_on=body.based_on, now=now)
    except documents.DocumentChanged:
        raise HTTPException(status_code=409, detail="document_changed") from None
    except documents.UnknownSource:
        raise HTTPException(status_code=422, detail="unknown_source") from None
    return _detail(db, course, document)


@router.post("/{document_id}/reactions", status_code=204)
def react(
    course_id: int,
    topic_id: int,
    document_id: int,
    body: Reaction,
    db: Db,
    now: Now,
    actor: Teacher,
) -> Response:
    """Record that the teacher keeps the document as it is."""
    course = editable_course(db, actor, course_id)
    document = _document(db, _topic(db, course, topic_id), document_id)
    documents.react(db, document, body.kind, actor, now=now)
    return Response(status_code=204)


@router.delete("/{document_id}", status_code=204)
def discard_document(
    course_id: int, topic_id: int, document_id: int, db: Db, now: Now, actor: Teacher
) -> Response:
    """Discard the document; the discard is recorded against the generation."""
    course = editable_course(db, actor, course_id)
    documents.discard(db, _document(db, _topic(db, course, topic_id), document_id), actor, now=now)
    return Response(status_code=204)
