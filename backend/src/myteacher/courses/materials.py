"""Classroom material: exercises for a topic that the teacher projects or prints, written by the
assistant from the approved concept map, the brief, the topic's additions and the sources, or
transcribed faithfully from one source, such as a scanned test, with its answer key read from
another source or proposed by the assistant.

Material is a lesson document bound to no student, using the exercise types of lessons; its answer
key prints on a page of its own. The generated document is version 1. Regenerating with an
instruction and editing each add a version linked to the one it came from. The teacher's
reactions (kept, edited, regenerated with an instruction, discarded) are recorded against the
generation behind the version they are about (ADR 0010). Chosen target students are stored but,
until concept states exist, change nothing.
"""

from datetime import datetime
from typing import Annotated, Any, Self

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError

from myteacher.accounts.models import Account
from myteacher.accounts.service import get_account, list_students
from myteacher.assistant.generations import GenerationReaction, ReactionKind
from myteacher.assistant.service import Task, generate_recorded
from myteacher.courses import concepts
from myteacher.courses import service as courses
from myteacher.courses.documents import source_input, source_inputs
from myteacher.courses.models import (
    ClassroomMaterial,
    ClassroomMaterialTarget,
    ClassroomMaterialVersion,
    ComponentNeed,
    Course,
    Source,
    Topic,
)
from myteacher.courses.sources import sources_of
from myteacher.courses.topic_interview import topic_inputs
from myteacher.jobs.models import Job
from myteacher.jobs.runner import JobContext, JobFailed, Work
from myteacher.lesson.catalog import COMPONENT_CATALOG
from myteacher.lesson.schema import (
    Exercise,
    ExplanationBlock,
    Identifier,
    LessonBlock,
    LessonDocument,
    NotExercise,
    PaperOnlyBlock,
    PassageBlock,
)
from myteacher.persistence import InstanceSession

TASK_KIND = "classroom_material"
TRANSCRIPTION_KIND = "classroom_material_transcription"

Instruction = Annotated[str, Field(min_length=1, max_length=2000)]


# Generated material has no paper-only exercises: it is written for the catalog from the start.
GeneratedBlock = Annotated[ExplanationBlock | PassageBlock | Exercise, Field(discriminator="type")]


class _Material(BaseModel):
    """A title and the lesson's blocks, which each kind of content below declares."""

    model_config = ConfigDict(extra="forbid")

    title: Annotated[str, Field(min_length=1, max_length=200)]

    @model_validator(mode="after")
    def _a_lesson_of_catalog_types(self) -> Self:
        blocks = self.blocks  # type: ignore[attr-defined]
        outside = {
            b.type
            for b in blocks
            if not isinstance(b, NotExercise) and b.type not in COMPONENT_CATALOG
        }
        if outside:
            raise ValueError(f"exercise types outside the catalog: {sorted(outside)}")
        # The lesson's own rules: unique ids, passages before the exercises about them.
        try:
            LessonDocument(
                id="check",
                title=self.title,
                language="en",
                feedback_mode="at_the_end",
                blocks=blocks,
            )
        except ValidationError as error:
            raise ValueError(error.errors()[0]["msg"]) from None
        return self


class Content(_Material):
    """What the assistant writes when generating: exercises of the catalog only."""

    blocks: Annotated[list[GeneratedBlock], Field(min_length=1, max_length=60)]


class ContentWithPaperOnly(_Material):
    """What an edit sends: material that may have paper-only exercises, as transcribed material
    does."""

    blocks: Annotated[list[LessonBlock], Field(min_length=1, max_length=60)]


class NeededType(BaseModel):
    """What a paper-only exercise would need to become an exercise: an entry of the component
    backlog."""

    model_config = ConfigDict(extra="forbid")

    block_id: Identifier
    need: Annotated[str, Field(min_length=1, max_length=1000)]


class Transcribed(ContentWithPaperOnly):
    """What the assistant writes when transcribing a source: the material, the exercises whose
    answers it proposed because no answer key gave them, and what each paper-only exercise
    would need to become an exercise."""

    proposed_answers: Annotated[list[Identifier], Field(max_length=60)] = []
    component_needs: Annotated[list[NeededType], Field(max_length=60)] = []

    @model_validator(mode="after")
    def _proposals_and_needs_name_their_blocks(self) -> Self:
        exercises = {b.id for b in self.blocks if not isinstance(b, NotExercise)}
        unknown = set(self.proposed_answers) - exercises
        if unknown:
            raise ValueError(f"proposed_answers name no exercise: {sorted(unknown)}")
        paper_only = [b.id for b in self.blocks if isinstance(b, PaperOnlyBlock)]
        needed = [n.block_id for n in self.component_needs]
        if sorted(needed) != sorted(paper_only):
            raise ValueError("component_needs must name each paper_only block once")
        return self


class MaterialChanged(Exception):
    """A newer version was saved since the one the change started from."""


class UnknownStudent(Exception):
    """A chosen target is not a student of the instance."""


# Reading


def materials_of(db: InstanceSession, topic: Topic) -> list[ClassroomMaterial]:
    return list(
        db.scalars(
            select(ClassroomMaterial)
            .where(ClassroomMaterial.topic_id == topic.id, ClassroomMaterial.discarded_at.is_(None))
            .order_by(ClassroomMaterial.id)
        )
    )


def get_material(db: InstanceSession, topic: Topic, material_id: int) -> ClassroomMaterial | None:
    return db.scalars(
        select(ClassroomMaterial).where(
            ClassroomMaterial.id == material_id,
            ClassroomMaterial.topic_id == topic.id,
            ClassroomMaterial.discarded_at.is_(None),
        )
    ).first()


def versions_of(db: InstanceSession, material: ClassroomMaterial) -> list[ClassroomMaterialVersion]:
    return list(
        db.scalars(
            select(ClassroomMaterialVersion)
            .where(ClassroomMaterialVersion.material_id == material.id)
            .order_by(ClassroomMaterialVersion.number)
        )
    )


def latest_version(
    db: InstanceSession, material: ClassroomMaterial
) -> ClassroomMaterialVersion | None:
    return db.scalars(
        select(ClassroomMaterialVersion)
        .where(ClassroomMaterialVersion.material_id == material.id)
        .order_by(ClassroomMaterialVersion.number.desc())
    ).first()


def lesson_of(version: ClassroomMaterialVersion) -> LessonDocument:
    return LessonDocument.model_validate(version.lesson)


def targets_of(db: InstanceSession, material: ClassroomMaterial) -> list[int]:
    return list(
        db.scalars(
            select(ClassroomMaterialTarget.student_id)
            .where(ClassroomMaterialTarget.material_id == material.id)
            .order_by(ClassroomMaterialTarget.student_id)
        )
    )


# Changing


def start(
    db: InstanceSession,
    topic: Topic,
    creator: Account,
    *,
    now: datetime,
    instruction: str | None = None,
    source: Source | None = None,
    key_source: Source | None = None,
    source_pages: list[int] | None = None,
    key_pages: list[int] | None = None,
):
    """New material for the topic, its first version to follow `instruction` when given, or to
    be transcribed from `source` with the answer key in `key_source`, from the pages given of
    each or else the whole file."""
    material = ClassroomMaterial(
        course_id=topic.course_id,
        topic_id=topic.id,
        created_by_id=creator.id,
        created_at=now,
        instruction=instruction,
        transcribed=source is not None,
        source_id=source.id if source else None,
        key_source_id=key_source.id if key_source else None,
        source_pages=source_pages,
        key_pages=key_pages,
    )
    db.add(material)
    db.flush()
    return material


def set_targets(db: InstanceSession, material: ClassroomMaterial, student_ids: list[int]) -> None:
    """Raises `UnknownStudent` unless every id is a current student of the instance."""
    chosen = set(student_ids)
    students = {s.id for s in list_students(db)}
    if not chosen <= students:
        raise UnknownStudent()
    db.execute(
        delete(ClassroomMaterialTarget).where(ClassroomMaterialTarget.material_id == material.id)
    )
    db.add_all(
        ClassroomMaterialTarget(material_id=material.id, student_id=student_id)
        for student_id in sorted(chosen)
    )
    db.flush()


def _add_version(
    db: InstanceSession,
    material: ClassroomMaterial,
    course: Course,
    content: _Material,
    *,
    previous: ClassroomMaterialVersion | None,
    instruction: str | None,
    author_id: int,
    generation_id: int | None,
    now: datetime,
) -> ClassroomMaterialVersion:
    """Raises IntegrityError when a concurrent change took the next number first."""
    number = (
        db.scalar(
            select(func.max(ClassroomMaterialVersion.number)).where(
                ClassroomMaterialVersion.material_id == material.id
            )
        )
        or 0
    ) + 1
    lesson = LessonDocument(
        id=f"material-{material.id}-{number}",
        title=content.title,
        language=course.taught_language or course.instruction_language,
        feedback_mode=courses.brief_of(course).feedback_mode,
        blocks=content.blocks,
    )
    version = ClassroomMaterialVersion(
        material_id=material.id,
        number=number,
        lesson=lesson.model_dump(mode="json", exclude_none=False),
        instruction=instruction,
        previous_version_id=previous.id if previous else None,
        generation_id=generation_id,
        author_id=author_id,
        created_at=now,
        proposed_answers=(
            content.proposed_answers or None if isinstance(content, Transcribed) else None
        ),
    )
    savepoint = db.begin_nested()
    db.add(version)
    try:
        db.flush()
    except IntegrityError:
        savepoint.rollback()
        raise
    savepoint.commit()
    return version


def _generation_behind(db: InstanceSession, version: ClassroomMaterialVersion | None) -> int | None:
    """The generation that wrote the version or, for an edit, the version it was edited from."""
    while version is not None:
        if version.generation_id is not None:
            return version.generation_id
        version = (
            db.get(ClassroomMaterialVersion, version.previous_version_id)
            if version.previous_version_id
            else None
        )
    return None


def react(
    db: InstanceSession,
    version: ClassroomMaterialVersion | None,
    kind: ReactionKind,
    teacher: Account,
    *,
    now: datetime,
    detail: dict[str, Any] | None = None,
) -> None:
    """Record the teacher's reaction to the version against the generation behind it."""
    generation_id = _generation_behind(db, version)
    if kind == "kept" and version is not None and version.generation_id is None:
        # Keeping the teacher's own edit says nothing more about the generation.
        return
    if generation_id is None or version is None:
        return
    db.add(
        GenerationReaction(
            generation_id=generation_id,
            kind=kind,
            account_id=teacher.id,
            detail={"version": version.number, **(detail or {})},
            created_at=now,
        )
    )


def edit(
    db: InstanceSession,
    course: Course,
    material: ClassroomMaterial,
    content: ContentWithPaperOnly,
    editor: Account,
    *,
    based_on: int,
    now: datetime,
) -> ClassroomMaterialVersion:
    """Add the teacher's lesson as a new version of the one it was based on; raises
    `MaterialChanged` when that is no longer the latest version."""
    latest = latest_version(db, material)
    if latest is None or latest.number != based_on:
        raise MaterialChanged()
    try:
        version = _add_version(
            db,
            material,
            course,
            content,
            previous=latest,
            instruction=None,
            author_id=editor.id,
            generation_id=None,
            now=now,
        )
    except IntegrityError:
        raise MaterialChanged() from None
    react(db, version, "edited", editor, now=now)
    return version


def clear_failure(db: InstanceSession, material: ClassroomMaterial) -> None:
    """Forget a failed generation once the teacher moved on from it by keeping or editing."""
    job = db.get(Job, material.job_id) if material.job_id else None
    if job is not None and job.state == "failed":
        material.job_id = None


def discard(db: InstanceSession, material: ClassroomMaterial, teacher: Account, *, now: datetime):
    material.discarded_at = now
    react(db, latest_version(db, material), "discarded", teacher, now=now)


# The component backlog


def _record_needs(
    db: InstanceSession,
    material: ClassroomMaterial,
    content: Transcribed,
    generation_id: int | None,
    now: datetime,
) -> None:
    """Add the paper-only exercises of the material to the backlog, each once however often the
    material is reworked."""
    recorded = set(
        db.scalars(select(ComponentNeed.block_id).where(ComponentNeed.material_id == material.id))
    )
    prompts = {b.id: b.prompt for b in content.blocks if isinstance(b, PaperOnlyBlock)}
    db.add_all(
        ComponentNeed(
            course_id=material.course_id,
            material_id=material.id,
            block_id=need.block_id,
            prompt=prompts[need.block_id],
            need=need.need,
            generation_id=generation_id,
            created_at=now,
        )
        for need in content.component_needs
        if need.block_id not in recorded
    )


def component_backlog(db: InstanceSession) -> list[ComponentNeed]:
    return list(db.scalars(select(ComponentNeed).order_by(ComponentNeed.id.desc())))


# The generation job


def _inputs(
    db: InstanceSession,
    course: Course,
    topic: Topic,
    previous: ClassroomMaterialVersion | None,
    instruction: str | None,
) -> dict[str, Any]:
    concept_map = concepts.map_of(db, topic)
    current = concepts.concepts_of(db, concept_map) if concept_map else []
    graph = concepts.graph_of(db, concept_map) if concept_map else {}
    names = {c.id: c.name for c in current}
    inputs: dict[str, Any] = {
        "course": {
            "name": course.name,
            "subject": course.subject,
            "taught_language": course.taught_language,
            "instruction_language": course.instruction_language,
        },
        "brief": courses.brief_of(course).model_dump(mode="json"),
        "topic": topic_inputs(topic),
        "concepts": [
            {
                "name": c.name,
                "description": c.description,
                "prerequisites": [names[p] for p in sorted(graph.get(c.id, ())) if p in names],
            }
            for c in current
        ],
        "sources": source_inputs(sources_of(db, course)),
    }
    if previous is not None:
        lesson = previous.lesson
        inputs["previous"] = {"title": lesson["title"], "blocks": lesson["blocks"]}
    if instruction is not None:
        inputs["instruction"] = instruction
    return inputs


def _transcription_inputs(
    db: InstanceSession,
    course: Course,
    material: ClassroomMaterial,
    previous: ClassroomMaterialVersion | None,
    instruction: str | None,
) -> dict[str, Any]:
    source = db.get(Source, material.source_id) if material.source_id else None
    key = db.get(Source, material.key_source_id) if material.key_source_id else None
    inputs: dict[str, Any] = {
        "course": {
            "name": course.name,
            "subject": course.subject,
            "taught_language": course.taught_language,
            "instruction_language": course.instruction_language,
        },
    }
    for part, read, pages in (
        ("source", source, material.source_pages),
        ("answer_key", key, material.key_pages),
    ):
        if read is None:
            continue
        inputs[part] = source_input(read, pages=pages)
        if pages is not None and not inputs[part]["text"].strip():
            # The chosen pages were read, by OCR too, and hold no text.
            raise JobFailed("nothing_read")
    if previous is not None:
        lesson = previous.lesson
        inputs["previous"] = {"title": lesson["title"], "blocks": lesson["blocks"]}
    if instruction is not None:
        inputs["instruction"] = instruction
    return inputs


# A lesson with its exercises and answer key is long: code, passages, a dozen exercises. The
# request is not streamed, so the limit stays one the model writes within the timeout.
GENERATE = Task(TASK_KIND, Content, slot="strong", timeout_s=600, max_tokens=20_000)
TRANSCRIBE = Task(TRANSCRIPTION_KIND, Transcribed, slot="strong", timeout_s=600, max_tokens=20_000)


def generation(
    material_id: int, *, based_on: int | None = None, instruction: str | None = None
) -> Work:
    """The work of a generation job: the first version, following the instruction it was asked
    for with, or a regeneration of version `based_on` by `instruction`."""

    async def work(db: InstanceSession, job: Job, ctx: JobContext) -> dict[str, Any]:
        material = db.get(ClassroomMaterial, material_id)
        if material is None or material.job_id != job.id or material.discarded_at is not None:
            return {"superseded": True}
        topic = db.get_one(Topic, material.topic_id)
        course = courses.get_course(db, material.course_id)
        teacher = get_account(db, job.account_id)
        assert course is not None and teacher is not None
        asked = instruction if based_on is not None else material.instruction
        previous = (
            db.scalars(
                select(ClassroomMaterialVersion).where(
                    ClassroomMaterialVersion.material_id == material.id,
                    ClassroomMaterialVersion.number == based_on,
                )
            ).one()
            if based_on is not None
            else None
        )
        if material.transcribed:
            task, inputs = TRANSCRIBE, _transcription_inputs(db, course, material, previous, asked)
        else:
            task, inputs = GENERATE, _inputs(db, course, topic, previous, asked)
        content, generation_id = await generate_recorded(
            ctx.assistant, db, task, teacher=teacher, inputs=inputs, course_id=course.id
        )
        # Claim the material for this result, once, unless it was discarded or asked again
        # meanwhile.
        claimed = db.execute(
            update(ClassroomMaterial)
            .where(
                ClassroomMaterial.id == material_id,
                ClassroomMaterial.job_id == job.id,
                ClassroomMaterial.discarded_at.is_(None),
            )
            .values(job_id=None)
            .execution_options(synchronize_session=False)
        )
        if claimed.rowcount != 1:  # type: ignore[attr-defined]
            return {"superseded": True}
        db.refresh(material)
        now = ctx.assistant.clock()
        # An edit saved meanwhile takes a number of its own; the regeneration still comes from
        # `previous`. Once more if a concurrent edit takes the same number first.
        for attempt in range(2):
            try:
                version = _add_version(
                    db,
                    material,
                    course,
                    content,
                    previous=previous,
                    instruction=asked,
                    author_id=teacher.id,
                    generation_id=generation_id,
                    now=now,
                )
                break
            except IntegrityError:
                if attempt == 1:
                    raise
        if isinstance(content, Transcribed):
            _record_needs(db, material, content, generation_id, now)
        return {"material_id": material_id, "version": version.number}

    return work
