"""Classroom material of a topic: generated and regenerated on an editor's key from the approved
concept map, edited, targeted and discarded by the course's owner and editors, read and previewed
by anyone who may view the course. Generation runs as a job; the client polls it, then reads the
material again. Material is answered with its latest version: the lesson as it reaches the page,
without solutions, and its answer key apart.
"""

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_serializer

from myteacher.accounts.models import Account
from myteacher.api.courses import course_for, editable_course
from myteacher.api.deps import Db, Now, requires
from myteacher.api.jobs import JobOut
from myteacher.assistant import generations
from myteacher.assistant.service import paying_credential
from myteacher.courses import concepts, materials, topics
from myteacher.courses.materials import Content
from myteacher.courses.models import ClassroomMaterial, Course, Topic
from myteacher.jobs import runner
from myteacher.lesson.assessment import AnswerMismatch, answer_key, assess
from myteacher.lesson.schema import (
    AnswerKey,
    AssessmentOutcome,
    ExerciseAnswer,
    LessonDocument,
    LessonPublic,
    SecondRound,
    SecondRoundRequest,
    exercise_to_public,
    to_public,
)
from myteacher.lesson.second_round import UnknownExercise, second_round
from myteacher.persistence import InstanceSession
from myteacher.policy import is_teacher

router = APIRouter(
    prefix="/courses/{course_id}/topics/{topic_id}/classroom-materials",
    tags=["classroom material"],
)
Teacher = Annotated[Account, requires(is_teacher)]

Instruction = Annotated[str, AfterValidator(str.strip), Field(min_length=1, max_length=2000)]


class MaterialOut(BaseModel):
    id: int
    # Of the latest version; None until the first one was generated.
    title: str | None
    version: int | None
    created_at: datetime
    # Whether the teacher kept or wrote the latest version; a new draft is not reviewed yet.
    reviewed: bool
    # The latest generation job, until its result landed.
    job: JobOut | None
    # Stored for planning; they do not change what is generated yet.
    target_student_ids: list[int]

    @field_serializer("created_at")
    def _utc(self, at: datetime) -> str:
        return at.strftime("%Y-%m-%dT%H:%M:%SZ")


class VersionOut(BaseModel):
    number: int
    # The instruction it was regenerated with.
    instruction: str | None
    # The number of the version it came from.
    previous: int | None
    # False for the teacher's edits.
    generated: bool
    created_at: datetime

    @field_serializer("created_at")
    def _utc(self, at: datetime) -> str:
        return at.strftime("%Y-%m-%dT%H:%M:%SZ")


class MaterialDetail(MaterialOut):
    lesson: LessonPublic | None
    answer_key: AnswerKey | None
    versions: list[VersionOut]


class Started(BaseModel):
    material: MaterialOut
    job: JobOut


class MaterialIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_student_ids: list[int] = []
    # What the teacher asks of the first version, such as the number or types of exercises.
    instruction: Instruction | None = None


class Regeneration(BaseModel):
    model_config = ConfigDict(extra="forbid")

    instruction: Instruction
    # The version the teacher saw; a newer one refuses the regeneration.
    based_on: int


class Edit(Content):
    # The version the teacher edited; a newer one refuses the edit.
    based_on: int


class Targets(BaseModel):
    model_config = ConfigDict(extra="forbid")

    student_ids: list[int]


class Reaction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Edits, regenerations and discards are recorded by those actions themselves.
    kind: Literal["kept"]


def _summary(db: InstanceSession, material: ClassroomMaterial) -> dict:
    job = runner.get_job(db, material.job_id) if material.job_id else None
    version = materials.latest_version(db, material)
    return {
        "id": material.id,
        "title": version.lesson["title"] if version else None,
        "version": version.number if version else None,
        "reviewed": version is not None and generations.reviewed(db, version.generation_id),
        "created_at": material.created_at,
        "job": JobOut.of(job) if job else None,
        "target_student_ids": materials.targets_of(db, material),
    }


def _detail(db: InstanceSession, material: ClassroomMaterial) -> MaterialDetail:
    versions = materials.versions_of(db, material)
    numbers = {v.id: v.number for v in versions}
    lesson = materials.lesson_of(versions[-1]) if versions else None
    return MaterialDetail(
        **_summary(db, material),
        lesson=to_public(lesson) if lesson else None,
        answer_key=answer_key(lesson) if lesson else None,
        versions=[
            VersionOut(
                number=v.number,
                instruction=v.instruction,
                previous=numbers.get(v.previous_version_id) if v.previous_version_id else None,
                generated=v.generation_id is not None,
                created_at=v.created_at,
            )
            for v in versions
        ],
    )


def _topic(db: InstanceSession, course: Course, topic_id: int) -> Topic:
    topic = topics.get_topic(db, course, topic_id)
    if topic is None:
        raise HTTPException(status_code=404)
    return topic


def _material(db: InstanceSession, topic: Topic, material_id: int) -> ClassroomMaterial:
    material = materials.get_material(db, topic, material_id)
    if material is None:
        raise HTTPException(status_code=404)
    return material


def _editable(
    db: InstanceSession, actor: Account, course_id: int, topic_id: int, material_id: int
) -> tuple[Course, ClassroomMaterial]:
    course = editable_course(db, actor, course_id)
    return course, _material(db, _topic(db, course, topic_id), material_id)


def _lesson(db: InstanceSession, material: ClassroomMaterial) -> LessonDocument:
    version = materials.latest_version(db, material)
    if version is None:
        raise HTTPException(status_code=404)
    return materials.lesson_of(version)


def _map_approved(db: InstanceSession, topic_id: int, course: Course) -> None:
    concept_map = concepts.map_of(db, _topic(db, course, topic_id))
    if concept_map is None or concept_map.state != "approved":
        raise HTTPException(status_code=409, detail="map_not_approved")


def _busy(db: InstanceSession, material: ClassroomMaterial) -> bool:
    job = runner.get_job(db, material.job_id) if material.job_id else None
    return job is not None and job.state in ("queued", "running")


def _targets(db: InstanceSession, material: ClassroomMaterial, student_ids: list[int]) -> None:
    try:
        materials.set_targets(db, material, student_ids)
    except materials.UnknownStudent:
        raise HTTPException(status_code=422, detail="unknown_student") from None


def _schedule(
    request: Request,
    background: BackgroundTasks,
    db: InstanceSession,
    material: ClassroomMaterial,
    actor: Account,
    now: datetime,
    **work,
) -> Started:
    if paying_credential(db, actor) is None:
        raise HTTPException(status_code=409, detail="no_provider_key")
    job = runner.create_job(
        db, materials.TASK_KIND, starter=actor, course_id=material.course_id, now=now
    )
    material.job_id = job.id
    db.flush()
    # Runs after the response, once this request's transaction has committed.
    background.add_task(
        runner.run, request.app.state.jobs, job.id, materials.generation(material.id, **work)
    )
    return Started(material=MaterialOut(**_summary(db, material)), job=JobOut.of(job))


@router.get("")
def list_materials(course_id: int, topic_id: int, db: Db, actor: Teacher) -> list[MaterialOut]:
    """The topic's material in the order it was generated, without its content."""
    topic = _topic(db, course_for(db, actor, course_id), topic_id)
    return [MaterialOut(**_summary(db, m)) for m in materials.materials_of(db, topic)]


@router.post(
    "",
    status_code=202,
    responses={409: {"description": "The concept map is not approved, or no provider key"}},
)
def generate_material(
    course_id: int,
    topic_id: int,
    body: MaterialIn,
    request: Request,
    background: BackgroundTasks,
    db: Db,
    now: Now,
    actor: Teacher,
) -> Started:
    """Let the assistant write exercises for the topic, optionally for chosen students and by
    the teacher's instruction."""
    course = editable_course(db, actor, course_id)
    topic = _topic(db, course, topic_id)
    _map_approved(db, topic_id, course)
    if paying_credential(db, actor) is None:
        raise HTTPException(status_code=409, detail="no_provider_key")
    material = materials.start(db, topic, actor, now=now, instruction=body.instruction)
    _targets(db, material, body.target_student_ids)
    return _schedule(request, background, db, material, actor, now)


@router.get("/{material_id}")
def read_material(
    course_id: int, topic_id: int, material_id: int, db: Db, actor: Teacher
) -> MaterialDetail:
    course = course_for(db, actor, course_id)
    return _detail(db, _material(db, _topic(db, course, topic_id), material_id))


@router.post(
    "/{material_id}/retry", status_code=202, responses={409: {"description": "Nothing failed"}}
)
def retry_material(
    course_id: int,
    topic_id: int,
    material_id: int,
    request: Request,
    background: BackgroundTasks,
    db: Db,
    now: Now,
    actor: Teacher,
) -> Started:
    """Generate once more material whose first generation failed."""
    course, material = _editable(db, actor, course_id, topic_id, material_id)
    job = runner.get_job(db, material.job_id) if material.job_id else None
    if materials.latest_version(db, material) is not None or job is None or job.state != "failed":
        raise HTTPException(status_code=409, detail="nothing_to_retry")
    _map_approved(db, topic_id, course)
    return _schedule(request, background, db, material, actor, now)


@router.post(
    "/{material_id}/regeneration",
    status_code=202,
    responses={409: {"description": "Running, a newer version was saved, or no provider key"}},
)
def regenerate_material(
    course_id: int,
    topic_id: int,
    material_id: int,
    body: Regeneration,
    request: Request,
    background: BackgroundTasks,
    db: Db,
    now: Now,
    actor: Teacher,
) -> Started:
    """Let the assistant rework the version the teacher saw by their instruction; the result is a
    new version linked to the instruction and to that version."""
    course, material = _editable(db, actor, course_id, topic_id, material_id)
    if _busy(db, material):
        raise HTTPException(status_code=409, detail="generation_running")
    _map_approved(db, topic_id, course)
    latest = materials.latest_version(db, material)
    if latest is None or latest.number != body.based_on:
        raise HTTPException(status_code=409, detail="material_changed")
    started = _schedule(
        request,
        background,
        db,
        material,
        actor,
        now,
        based_on=latest.number,
        instruction=body.instruction,
    )
    materials.react(
        db, latest, "regenerated", actor, now=now, detail={"instruction": body.instruction}
    )
    return started


@router.post(
    "/{material_id}/versions",
    status_code=201,
    responses={409: {"description": "Not generated yet, or a newer version was saved"}},
)
def edit_material(
    course_id: int,
    topic_id: int,
    material_id: int,
    body: Edit,
    db: Db,
    now: Now,
    actor: Teacher,
) -> MaterialDetail:
    """Save the teacher's lesson as a new version; the edit is recorded against the generation."""
    course, material = _editable(db, actor, course_id, topic_id, material_id)
    if _busy(db, material):
        # The running generation would land over the edit.
        raise HTTPException(status_code=409, detail="generation_running")
    content = Content.model_validate(body.model_dump(exclude={"based_on"}))
    try:
        materials.edit(db, course, material, content, actor, based_on=body.based_on, now=now)
    except materials.MaterialChanged:
        raise HTTPException(status_code=409, detail="material_changed") from None
    materials.clear_failure(db, material)
    return _detail(db, material)


@router.put("/{material_id}/targets")
def change_targets(
    course_id: int,
    topic_id: int,
    material_id: int,
    body: Targets,
    db: Db,
    actor: Teacher,
) -> MaterialDetail:
    """Choose the students the material is for; it does not change the material yet."""
    _, material = _editable(db, actor, course_id, topic_id, material_id)
    _targets(db, material, body.student_ids)
    return _detail(db, material)


@router.post("/{material_id}/reactions", status_code=204)
def react(
    course_id: int,
    topic_id: int,
    material_id: int,
    body: Reaction,
    db: Db,
    now: Now,
    actor: Teacher,
) -> Response:
    """Record that the teacher keeps the material as it is."""
    _, material = _editable(db, actor, course_id, topic_id, material_id)
    materials.react(db, materials.latest_version(db, material), body.kind, actor, now=now)
    materials.clear_failure(db, material)
    return Response(status_code=204)


@router.delete("/{material_id}", status_code=204)
def discard_material(
    course_id: int, topic_id: int, material_id: int, db: Db, now: Now, actor: Teacher
) -> Response:
    """Discard the material; the discard is recorded against the generation."""
    _, material = _editable(db, actor, course_id, topic_id, material_id)
    materials.discard(db, material, actor, now=now)
    return Response(status_code=204)


# Trying the exercises on the preview, as in class


@router.post("/{material_id}/exercises/{exercise_id}/assessment", response_model=AssessmentOutcome)
def assess_answer(
    course_id: int,
    topic_id: int,
    material_id: int,
    exercise_id: str,
    answer: ExerciseAnswer,
    db: Db,
    actor: Teacher,
    reveal: bool = True,
) -> AssessmentOutcome:
    course = course_for(db, actor, course_id)
    lesson = _lesson(db, _material(db, _topic(db, course, topic_id), material_id))
    exercise = lesson.exercise(exercise_id)
    if exercise is None:
        raise HTTPException(status_code=404, detail="exercise not found")
    try:
        return assess(exercise, answer, language=lesson.language, reveal=reveal)
    except AnswerMismatch as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post("/{material_id}/second-round", response_model=SecondRound)
def get_second_round(
    course_id: int,
    topic_id: int,
    material_id: int,
    body: SecondRoundRequest,
    db: Db,
    actor: Teacher,
) -> SecondRound:
    course = course_for(db, actor, course_id)
    lesson = _lesson(db, _material(db, _topic(db, course, topic_id), material_id))
    try:
        repeats = second_round(lesson, body.failed_exercise_ids, body.seed)
    except UnknownExercise as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return SecondRound(exercises=[exercise_to_public(exercise) for exercise in repeats])
