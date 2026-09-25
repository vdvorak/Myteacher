"""The course archive: the one portable representation of a course, as a backup and for fork.

An archive is a zip holding `course.json`, a versioned document of the course, its brief, topics,
concept maps, reference documents and classroom material, plus the original files of its sources
under `sources/`. Records refer to each other by keys made for the archive, never by database
identifiers. Who owns the course and whom it is shared with are not part of it, and neither is
anything about students (ADR 0008): the targets of classroom material stay behind. Neither are
the transcripts of the course and topic interviews, generation records or retired concepts: what
the interviews established is in the brief and the topics' additions.

A later slice that adds to the format raises `VERSION`; a reader refuses versions it does not know.
Importing builds a new course from an archive with identifiers of its own; a fork is an export
followed by an import (ADR 0008).
"""

import io
import re
import zipfile
from datetime import datetime
from typing import Annotated, Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, ValidationError, model_validator

from myteacher.accounts.models import Account
from myteacher.courses import concepts, documents, materials
from myteacher.courses import service as courses
from myteacher.courses.brief import CourseBrief
from myteacher.courses.concepts import ConceptDescription, ConceptName, has_cycle
from myteacher.courses.models import (
    ClassroomMaterial,
    ClassroomMaterialVersion,
    Concept,
    ConceptMap,
    ConceptPrerequisite,
    Course,
    ReferenceDocument,
    ReferenceDocumentVersion,
    ReferenceKind,
    Source,
    SourceFile,
    SourceKind,
    Topic,
)
from myteacher.courses.sources import sources_of
from myteacher.courses.topic_interview import AdditionText, additions_of, set_additions
from myteacher.courses.topics import topics_of
from myteacher.lesson.schema import LessonDocument
from myteacher.persistence import InstanceSession

FORMAT = "myteacher-course"
VERSION = 1
DOCUMENT_NAME = "course.json"

UtcTime = Annotated[
    datetime, PlainSerializer(lambda at: at.strftime("%Y-%m-%dT%H:%M:%SZ"), return_type=str)
]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


Name = Annotated[str, Field(min_length=1, max_length=200)]


def _unique(values: list, what: str) -> None:
    if len(set(values)) != len(values):
        raise ValueError(f"every {what} must be unique")


class ArchiveCourse(_Model):
    name: Name
    subject: Name
    taught_language: str | None
    instruction_language: str


class ArchiveSource(_Model):
    key: str
    name: Name
    kind: SourceKind
    media_type: str
    size: int
    visible_to_students: bool
    text: str | None
    extracted_with: str | None
    url: str | None
    fetched_at: UtcTime | None
    # The path of the original file in the archive; None for a web page, kept as its text.
    file: str | None


class ArchiveConcept(_Model):
    key: str
    name: ConceptName
    description: ConceptDescription
    # Keys of concepts of the same map.
    prerequisites: list[str]


class ArchiveConceptMap(_Model):
    state: Literal["draft", "approved"]
    approved_before: bool
    concepts: list[ArchiveConcept]

    @model_validator(mode="after")
    def _a_graph(self) -> Self:
        keys = [c.key for c in self.concepts]
        _unique(keys, "concept key")
        for c in self.concepts:
            _unique(c.prerequisites, "prerequisite of a concept")
            if not set(c.prerequisites) <= set(keys):
                raise ValueError(f"unknown prerequisites of {c.key!r}")
        index = {key: n for n, key in enumerate(keys)}
        # A concept requiring itself is a cycle too.
        if has_cycle({n: {index[p] for p in c.prerequisites} for n, c in enumerate(self.concepts)}):
            raise ValueError("prerequisites must not form a cycle")
        return self


class ArchiveCitation(_Model):
    # The key of a source in the archive; None when the source was removed from the course.
    source: str | None
    location: str


class ArchivePassage(_Model):
    markdown: str
    citations: list[ArchiveCitation]


class ArchiveDocumentVersion(_Model):
    number: int
    title: Name
    passages: list[ArchivePassage]


class ArchiveReferenceDocument(_Model):
    kind: ReferenceKind
    versions: Annotated[list[ArchiveDocumentVersion], Field(min_length=1)]

    @model_validator(mode="after")
    def _numbered(self) -> Self:
        _unique([v.number for v in self.versions], "version number")
        return self


class ArchiveMaterialVersion(_Model):
    number: int
    # The lesson document as authored, with its answer key.
    lesson: dict[str, Any]
    instruction: str | None
    # The number of the version it came from.
    previous: int | None


class ArchiveMaterial(_Model):
    versions: Annotated[list[ArchiveMaterialVersion], Field(min_length=1)]

    @model_validator(mode="after")
    def _linked(self) -> Self:
        _unique([v.number for v in self.versions], "version number")
        seen: set[int] = set()
        for v in self.versions:
            if v.previous is not None and v.previous not in seen:
                raise ValueError(f"version {v.number} comes from no earlier version")
            seen.add(v.number)
        return self


class ArchiveDiagnosticOffer(_Model):
    reason: str
    answer: str | None


class ArchiveAdditions(_Model):
    goals: AdditionText = None
    prior_knowledge: AdditionText = None
    emphasis: AdditionText = None
    notes: AdditionText = None


class ArchiveTopic(_Model):
    name: Name
    diagnostic_wanted: bool
    additions: ArchiveAdditions
    diagnostic_offer: ArchiveDiagnosticOffer | None
    concept_map: ArchiveConceptMap | None
    reference_documents: list[ArchiveReferenceDocument]
    classroom_materials: list[ArchiveMaterial]


class Archive(_Model):
    format: Literal["myteacher-course"]
    version: Literal[1]
    exported_at: UtcTime
    course: ArchiveCourse
    brief: CourseBrief
    sources: list[ArchiveSource]
    # In teaching order.
    topics: list[ArchiveTopic]

    @model_validator(mode="after")
    def _sources_by_key(self) -> Self:
        _unique([s.key for s in self.sources], "source key")
        _unique([s.file for s in self.sources if s.file is not None], "source file")
        return self


def _file_name(key: str, name: str) -> str:
    # One flat, safe name per source, whatever the teacher called it.
    return f"sources/{key}-{re.sub(r'[\\/:*?\"<>|\x00-\x1f]', '_', name)}"


def _concept_map(db: InstanceSession, topic: Topic) -> ArchiveConceptMap | None:
    concept_map = concepts.map_of(db, topic)
    if concept_map is None:
        return None
    current = concepts.concepts_of(db, concept_map)
    graph = concepts.graph_of(db, concept_map)
    keys = {c.id: f"concept-{n}" for n, c in enumerate(current, 1)}
    return ArchiveConceptMap(
        state=concept_map.state,  # type: ignore[arg-type]
        approved_before=concept_map.approved_before,
        concepts=[
            ArchiveConcept(
                key=keys[c.id],
                name=c.name,
                description=c.description,
                prerequisites=[keys[p.id] for p in current if p.id in graph[c.id]],
            )
            for c in current
        ],
    )


def _reference_documents(
    db: InstanceSession, topic: Topic, source_keys: dict[int, str]
) -> list[ArchiveReferenceDocument]:
    archived = []
    for document in documents.documents_of(db, topic):
        versions = documents.versions_of(db, document)
        if not versions:
            continue
        archived.append(
            ArchiveReferenceDocument(
                kind=document.kind,
                versions=[
                    ArchiveDocumentVersion(
                        number=v.number,
                        title=v.title,
                        passages=[
                            ArchivePassage(
                                markdown=p["markdown"],
                                citations=[
                                    ArchiveCitation(
                                        source=source_keys.get(c["source_id"]),
                                        location=c["location"],
                                    )
                                    for c in p["citations"]
                                ],
                            )
                            for p in v.passages
                        ],
                    )
                    for v in versions
                ],
            )
        )
    return archived


def _materials(db: InstanceSession, topic: Topic, topic_key: str) -> list[ArchiveMaterial]:
    archived = []
    for material in materials.materials_of(db, topic):
        versions = materials.versions_of(db, material)
        if not versions:
            continue
        numbers = {v.id: v.number for v in versions}
        key = f"{topic_key}-material-{len(archived) + 1}"
        archived.append(
            ArchiveMaterial(
                versions=[
                    ArchiveMaterialVersion(
                        number=v.number,
                        # Named by the archive, not by the row it was stored in.
                        lesson={**v.lesson, "id": f"{key}-v{v.number}"},
                        instruction=v.instruction,
                        previous=numbers.get(v.previous_version_id)
                        if v.previous_version_id
                        else None,
                    )
                    for v in versions
                ]
            )
        )
    return archived


def _source(source: Source, key: str, has_file: bool) -> ArchiveSource:
    return ArchiveSource(
        key=key,
        name=source.name,
        kind=source.kind,
        media_type=source.media_type,
        size=source.size,
        visible_to_students=source.visible_to_students,
        text=source.text,
        extracted_with=source.extracted_with,
        url=source.url,
        fetched_at=source.fetched_at,
        file=_file_name(key, source.name) if has_file else None,
    )


def export(db: InstanceSession, course: Course, *, now: datetime) -> bytes:
    """The course as an archive: its document and its source files, zipped."""
    files: dict[str, bytes] = {}
    archived_sources = []
    source_keys: dict[int, str] = {}
    for n, source in enumerate(sources_of(db, course), 1):
        key = f"source-{n}"
        source_keys[source.id] = key
        stored = db.get(SourceFile, source.id)
        archived = _source(source, key, stored is not None)
        if stored is not None and archived.file is not None:
            files[archived.file] = stored.content
        archived_sources.append(archived)
    archive = Archive(
        format=FORMAT,
        version=VERSION,
        exported_at=now,
        course=ArchiveCourse(
            name=course.name,
            subject=course.subject,
            taught_language=course.taught_language,
            instruction_language=course.instruction_language,
        ),
        brief=courses.brief_of(course),
        sources=archived_sources,
        topics=[
            ArchiveTopic(
                name=topic.name,
                diagnostic_wanted=topic.diagnostic_wanted,
                additions=ArchiveAdditions(**additions_of(topic)),
                diagnostic_offer=ArchiveDiagnosticOffer(
                    reason=topic.diagnostic_offer, answer=topic.diagnostic_offer_answer
                )
                if topic.diagnostic_offer
                else None,
                concept_map=_concept_map(db, topic),
                reference_documents=_reference_documents(db, topic, source_keys),
                classroom_materials=_materials(db, topic, f"topic-{n}"),
            )
            for n, topic in enumerate(topics_of(db, course), 1)
        ],
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zipped:
        zipped.writestr(DOCUMENT_NAME, archive.model_dump_json(indent=2))
        for name, content in files.items():
            zipped.writestr(name, content)
    return buffer.getvalue()


# Importing


class ArchiveInvalid(Exception):
    """Not an archive this app can read: `reason` says why."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


# A citation of a source the course no longer had: it keeps its location and points at no row.
NO_SOURCE = 0


def read(data: bytes) -> tuple[Archive, dict[str, bytes]]:
    """The archive's document and the source files it names."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zipped:
            archive = Archive.model_validate_json(zipped.read(DOCUMENT_NAME))
            files = {s.file: zipped.read(s.file) for s in archive.sources if s.file is not None}
    # An encrypted or damaged member raises RuntimeError or ValueError while it is read.
    except (zipfile.BadZipFile, KeyError, RuntimeError, ValueError) as error:
        raise ArchiveInvalid(str(error)) from None
    return archive, files


def _import_concepts(
    db: InstanceSession,
    archived: ArchiveConceptMap,
    course: Course,
    topic: Topic,
    owner: Account,
    now: datetime,
) -> None:
    approved = archived.state == "approved"
    concept_map = ConceptMap(
        course_id=course.id,
        topic_id=topic.id,
        state=archived.state,
        approved_at=now if approved else None,
        approved_by_id=owner.id if approved else None,
        approved_before=archived.approved_before,
        created_at=now,
    )
    db.add(concept_map)
    db.flush()
    rows = {
        c.key: Concept(
            course_id=course.id,
            concept_map_id=concept_map.id,
            position=position,
            name=c.name,
            description=c.description,
            created_at=now,
        )
        for position, c in enumerate(archived.concepts)
    }
    db.add_all(rows.values())
    db.flush()
    for c in archived.concepts:
        for key in c.prerequisites:
            if key not in rows:
                raise ArchiveInvalid(f"unknown prerequisite {key!r}")
            db.add(ConceptPrerequisite(concept_id=rows[c.key].id, prerequisite_id=rows[key].id))


def _import_documents(
    db: InstanceSession,
    archived: list[ArchiveReferenceDocument],
    course: Course,
    topic: Topic,
    source_ids: dict[str, int],
    owner: Account,
    now: datetime,
) -> None:
    for document in archived:
        row = ReferenceDocument(
            course_id=course.id,
            topic_id=topic.id,
            kind=document.kind,
            created_by_id=owner.id,
            created_at=now,
        )
        db.add(row)
        db.flush()
        for version in document.versions:
            passages = []
            for p in version.passages:
                citations = []
                for c in p.citations:
                    if c.source is not None and c.source not in source_ids:
                        raise ArchiveInvalid(f"unknown source {c.source!r}")
                    source_id = source_ids[c.source] if c.source is not None else NO_SOURCE
                    citations.append({"source_id": source_id, "location": c.location})
                passages.append({"markdown": p.markdown, "citations": citations})
            db.add(
                ReferenceDocumentVersion(
                    document_id=row.id,
                    number=version.number,
                    title=version.title,
                    passages=passages,
                    author_id=owner.id,
                    created_at=now,
                )
            )


def _import_materials(
    db: InstanceSession,
    archived: list[ArchiveMaterial],
    course: Course,
    topic: Topic,
    owner: Account,
    now: datetime,
) -> None:
    for material in archived:
        row = ClassroomMaterial(
            course_id=course.id, topic_id=topic.id, created_by_id=owner.id, created_at=now
        )
        db.add(row)
        db.flush()
        by_number: dict[int, ClassroomMaterialVersion] = {}
        for version in material.versions:
            try:
                lesson = LessonDocument.model_validate(
                    {**version.lesson, "id": f"material-{row.id}-{version.number}"}
                )
            except ValidationError as error:
                raise ArchiveInvalid(str(error)) from None
            previous = by_number.get(version.previous) if version.previous else None
            stored = ClassroomMaterialVersion(
                material_id=row.id,
                number=version.number,
                lesson=lesson.model_dump(mode="json"),
                instruction=version.instruction,
                previous_version_id=previous.id if previous else None,
                author_id=owner.id,
                created_at=now,
            )
            db.add(stored)
            db.flush()
            by_number[version.number] = stored


def import_course(
    db: InstanceSession,
    data: bytes,
    owner: Account,
    *,
    now: datetime,
    forked_from: Course | None = None,
) -> Course:
    """A new course owned by `owner` built from the archive, every record with an identifier
    of its own. Raises `ArchiveInvalid` for an archive this app cannot read."""
    archive, files = read(data)
    basics = archive.course
    course = courses.create_course(
        db,
        owner,
        name=basics.name,
        subject=basics.subject,
        taught_language=basics.taught_language,
        instruction_language=basics.instruction_language,
        now=now,
    )
    course.forked_from_id = forked_from.id if forked_from else None
    courses.change_brief(course, archive.brief.model_dump(mode="json"))
    source_ids: dict[str, int] = {}
    for s in archive.sources:
        source = Source(
            course_id=course.id,
            name=s.name,
            kind=s.kind,
            media_type=s.media_type,
            size=s.size,
            visible_to_students=s.visible_to_students,
            text=s.text,
            extracted_with=s.extracted_with,
            url=s.url,
            fetched_at=s.fetched_at,
            uploaded_by_id=owner.id,
            created_at=now,
        )
        db.add(source)
        db.flush()
        if s.file is not None:
            db.add(SourceFile(source_id=source.id, content=files[s.file]))
        source_ids[s.key] = source.id
    for position, t in enumerate(archive.topics):
        offer = t.diagnostic_offer
        topic = Topic(
            course_id=course.id,
            position=position,
            name=t.name,
            diagnostic_wanted=t.diagnostic_wanted,
            diagnostic_offer=offer.reason if offer else None,
            diagnostic_offer_answer=offer.answer if offer else None,
            created_at=now,
        )
        set_additions(topic, t.additions.model_dump())
        db.add(topic)
        db.flush()
        if t.concept_map is not None:
            _import_concepts(db, t.concept_map, course, topic, owner, now)
        _import_documents(db, t.reference_documents, course, topic, source_ids, owner, now)
        _import_materials(db, t.classroom_materials, course, topic, owner, now)
    db.flush()
    return course
