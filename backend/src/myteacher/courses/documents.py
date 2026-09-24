"""Reference documents: printable summaries of a topic written by the assistant from its approved
concept map, the brief and the course sources.

A document is a title and passages of constrained Markdown. Each passage cites sources of the
course by identifier and location; a passage without a citation is unsourced, which the reader
sees marked. The generated text is version 1; every edit by the teacher adds a version. The
teacher's reactions (kept, edited, discarded) are recorded against the generation (ADR 0010).
"""

from datetime import datetime
from typing import Annotated, Any, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from myteacher.accounts.models import Account
from myteacher.accounts.service import get_account
from myteacher.assistant.generations import GenerationReaction, ReactionKind
from myteacher.assistant.service import Task, generate_recorded
from myteacher.courses import concepts
from myteacher.courses import service as courses
from myteacher.courses.models import (
    Course,
    ReferenceDocument,
    ReferenceDocumentVersion,
    ReferenceKind,
    Source,
    Topic,
)
from myteacher.courses.sources import sources_of
from myteacher.jobs.models import Job
from myteacher.jobs.runner import JobContext, Work
from myteacher.lesson.schema import Markdown
from myteacher.persistence import InstanceSession

TASK_KIND = "reference_document"
# Of all source text sent with one request, shared equally among the sources.
SOURCE_BUDGET = 200_000


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Citation(_Strict):
    source_id: int = Field(description="The identifier of a source from the input.")
    location: Annotated[str, Field(min_length=1, max_length=200)] = Field(
        description="Where in the source: a unit, section, page or heading."
    )


class Passage(_Strict):
    markdown: Annotated[Markdown, Field(max_length=5000)]
    citations: Annotated[list[Citation], Field(max_length=10)] = Field(
        description="The sources this passage rests on; empty when it rests on none."
    )


class Content(_Strict):
    title: Annotated[str, Field(min_length=1, max_length=200)]
    passages: Annotated[list[Passage], Field(min_length=1, max_length=80)]

    def cited_sources(self) -> set[int]:
        return {c.source_id for p in self.passages for c in p.citations}


class UnknownSource(Exception):
    """The content cites a source the course does not have."""


def output_type(source_ids: set[int]) -> type[Content]:
    """The document the assistant must return, citing only these sources."""

    class Document(Content):
        @model_validator(mode="after")
        def _known_sources(self) -> Self:
            unknown = self.cited_sources() - source_ids
            if unknown:
                raise ValueError(f"cites sources not in the input: {sorted(unknown)}")
            return self

    return Document


def documents_of(db: InstanceSession, topic: Topic) -> list[ReferenceDocument]:
    return list(
        db.scalars(
            select(ReferenceDocument)
            .where(ReferenceDocument.topic_id == topic.id, ReferenceDocument.discarded_at.is_(None))
            .order_by(ReferenceDocument.id)
        )
    )


def get_document(db: InstanceSession, topic: Topic, document_id: int) -> ReferenceDocument | None:
    return db.scalars(
        select(ReferenceDocument).where(
            ReferenceDocument.id == document_id,
            ReferenceDocument.topic_id == topic.id,
            ReferenceDocument.discarded_at.is_(None),
        )
    ).first()


def latest_version(
    db: InstanceSession, document: ReferenceDocument
) -> ReferenceDocumentVersion | None:
    return db.scalars(
        select(ReferenceDocumentVersion)
        .where(ReferenceDocumentVersion.document_id == document.id)
        .order_by(ReferenceDocumentVersion.number.desc())
    ).first()


def start(
    db: InstanceSession, topic: Topic, kind: ReferenceKind, creator: Account, *, now: datetime
) -> ReferenceDocument:
    document = ReferenceDocument(
        course_id=topic.course_id,
        topic_id=topic.id,
        kind=kind,
        created_by_id=creator.id,
        created_at=now,
    )
    db.add(document)
    db.flush()
    return document


def _add_version(
    db: InstanceSession,
    document: ReferenceDocument,
    content: Content,
    *,
    author_id: int,
    generation_id: int | None,
    now: datetime,
) -> ReferenceDocumentVersion:
    number = db.scalar(
        select(func.max(ReferenceDocumentVersion.number)).where(
            ReferenceDocumentVersion.document_id == document.id
        )
    )
    version = ReferenceDocumentVersion(
        document_id=document.id,
        number=(number or 0) + 1,
        title=content.title,
        passages=[p.model_dump(mode="json") for p in content.passages],
        generation_id=generation_id,
        author_id=author_id,
        created_at=now,
    )
    db.add(version)
    db.flush()
    return version


def react(
    db: InstanceSession,
    document: ReferenceDocument,
    kind: ReactionKind,
    teacher: Account,
    *,
    now: datetime,
    detail: dict[str, Any] | None = None,
) -> None:
    """Record the teacher's reaction against the generation, if the document has one."""
    if document.generation_id is None:
        return
    db.add(
        GenerationReaction(
            generation_id=document.generation_id,
            kind=kind,
            account_id=teacher.id,
            detail=detail,
            created_at=now,
        )
    )


class DocumentChanged(Exception):
    """A newer version was saved since the one the edit started from."""


def edit(
    db: InstanceSession,
    course: Course,
    document: ReferenceDocument,
    content: Content,
    editor: Account,
    *,
    based_on: int,
    now: datetime,
) -> ReferenceDocumentVersion:
    """Add the teacher's text as a new version of the one it was based on.

    Raises `DocumentChanged` when that is no longer the latest version, and `UnknownSource` when
    it cites a source the course does not have, unless the version it edits cited it already:
    a removed source must not make the document uneditable.
    """
    latest = latest_version(db, document)
    if latest is None or latest.number != based_on:
        raise DocumentChanged()
    known = {s.id for s in sources_of(db, course)}
    known |= {c["source_id"] for p in latest.passages for c in p["citations"]}
    if not content.cited_sources() <= known:
        raise UnknownSource()
    savepoint = db.begin_nested()
    try:
        version = _add_version(
            db, document, content, author_id=editor.id, generation_id=None, now=now
        )
    except IntegrityError:
        # A concurrent edit took the same version number first.
        savepoint.rollback()
        raise DocumentChanged() from None
    savepoint.commit()
    react(db, document, "edited", editor, now=now, detail={"version": version.number})
    return version


def discard(db: InstanceSession, document: ReferenceDocument, teacher: Account, *, now: datetime):
    document.discarded_at = now
    react(db, document, "discarded", teacher, now=now)


# The generation job


def source_inputs(sources: list[Source]) -> list[dict[str, Any]]:
    readable = [s for s in sources if s.text]
    share = SOURCE_BUDGET // max(len(readable), 1)
    inputs = []
    for source in readable:
        text = source.text or ""
        item: dict[str, Any] = {"id": source.id, "name": source.name, "text": text[:share]}
        if len(text) > share:
            item["truncated"] = True
        inputs.append(item)
    return inputs


def _inputs(
    db: InstanceSession, course: Course, topic: Topic, kind: str, sources: list[Source]
) -> dict[str, Any]:
    concept_map = concepts.map_of(db, topic)
    current = concepts.concepts_of(db, concept_map) if concept_map else []
    graph = concepts.graph_of(db, concept_map) if concept_map else {}
    names = {c.id: c.name for c in current}
    return {
        "course": {
            "name": course.name,
            "subject": course.subject,
            "taught_language": course.taught_language,
            "instruction_language": course.instruction_language,
        },
        "brief": courses.brief_of(course).model_dump(mode="json"),
        "topic": topic.name,
        "kind": kind,
        "concepts": [
            {
                "name": c.name,
                "description": c.description,
                "prerequisites": [names[p] for p in sorted(graph.get(c.id, ())) if p in names],
            }
            for c in current
        ],
        "sources": source_inputs(sources),
    }


def generation(document_id: int) -> Work:
    """The work of a generation job for the document."""

    async def work(db: InstanceSession, job: Job, ctx: JobContext) -> dict[str, Any]:
        document = db.get(ReferenceDocument, document_id)
        if document is None or document.job_id != job.id:
            return {"superseded": True}
        topic = db.get_one(Topic, document.topic_id)
        course = courses.get_course(db, document.course_id)
        teacher = get_account(db, job.account_id)
        assert course is not None and teacher is not None
        sources = sources_of(db, course)
        cited = source_inputs(sources)
        task = Task(TASK_KIND, output_type({s["id"] for s in cited}), slot="strong", timeout_s=300)
        content, generation_id = await generate_recorded(
            ctx.assistant,
            db,
            task,
            teacher=teacher,
            inputs=_inputs(db, course, topic, document.kind, sources),
            course_id=course.id,
        )
        # Claim the document for this result, unless it was discarded or started again meanwhile.
        claimed = db.execute(
            update(ReferenceDocument)
            .where(
                ReferenceDocument.id == document_id,
                ReferenceDocument.job_id == job.id,
                ReferenceDocument.generation_id.is_(None),
                ReferenceDocument.discarded_at.is_(None),
            )
            .values(generation_id=generation_id)
            .execution_options(synchronize_session=False)
        )
        if claimed.rowcount != 1:  # type: ignore[attr-defined]
            return {"superseded": True}
        db.refresh(document)
        version = _add_version(
            db,
            document,
            content,
            author_id=teacher.id,
            generation_id=generation_id,
            now=ctx.assistant.clock(),
        )
        return {"document_id": document_id, "version": version.number}

    return work
