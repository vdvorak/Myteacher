"""The course archive: the one portable representation of a course, as a backup and for fork.

An archive is a zip holding `course.json`, a versioned document of the course, its brief, topics,
concept maps, reference documents and classroom material, plus the original files of its sources
under `sources/`. Records refer to each other by keys made for the archive, never by database
identifiers. Who owns the course and whom it is shared with are not part of it, and neither is
anything about students (ADR 0008): the targets of classroom material stay behind. Neither are
the transcripts of the course and topic interviews, generation records or retired concepts: what
the interviews established is in the brief and the topics' additions.

A later slice that adds to the format raises `VERSION`; a reader refuses versions it does not know.
"""

import io
import re
import zipfile
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, PlainSerializer

from myteacher.courses import concepts, documents, materials
from myteacher.courses import service as courses
from myteacher.courses.brief import CourseBrief
from myteacher.courses.models import Course, Source, SourceFile, Topic
from myteacher.courses.sources import sources_of
from myteacher.courses.topic_interview import additions_of
from myteacher.courses.topics import topics_of
from myteacher.persistence import InstanceSession

FORMAT = "myteacher-course"
VERSION = 1
DOCUMENT_NAME = "course.json"

UtcTime = Annotated[
    datetime, PlainSerializer(lambda at: at.strftime("%Y-%m-%dT%H:%M:%SZ"), return_type=str)
]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ArchiveCourse(_Model):
    name: str
    subject: str
    taught_language: str | None
    instruction_language: str


class ArchiveSource(_Model):
    key: str
    name: str
    kind: str
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
    name: str
    description: str
    # Keys of concepts of the same map.
    prerequisites: list[str]


class ArchiveConceptMap(_Model):
    state: Literal["draft", "approved"]
    approved_before: bool
    concepts: list[ArchiveConcept]


class ArchiveCitation(_Model):
    # The key of a source in the archive; None when the source was removed from the course.
    source: str | None
    location: str


class ArchivePassage(_Model):
    markdown: str
    citations: list[ArchiveCitation]


class ArchiveDocumentVersion(_Model):
    number: int
    title: str
    passages: list[ArchivePassage]


class ArchiveReferenceDocument(_Model):
    kind: str
    versions: list[ArchiveDocumentVersion]


class ArchiveMaterialVersion(_Model):
    number: int
    # The lesson document as authored, with its answer key.
    lesson: dict[str, Any]
    instruction: str | None
    # The number of the version it came from.
    previous: int | None


class ArchiveMaterial(_Model):
    versions: list[ArchiveMaterialVersion]


class ArchiveDiagnosticOffer(_Model):
    reason: str
    answer: str | None


class ArchiveTopic(_Model):
    name: str
    diagnostic_wanted: bool
    additions: dict[str, str | None]
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
                additions=additions_of(topic),
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
