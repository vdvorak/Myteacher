"""Course runs: started from a course by its owner or an editor, then seen and changed by the
run's teacher alone (ADR 0008). Every change answers with the whole run."""

from datetime import UTC, datetime
from typing import Annotated, Literal, Self

from fastapi import APIRouter, HTTPException
from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_serializer,
    model_validator,
)
from sqlalchemy import select

from myteacher.accounts import consent
from myteacher.accounts.consent import StudentState
from myteacher.accounts.models import Account
from myteacher.api.classes import ClassSummary, class_or_404, student_or_404
from myteacher.api.courses import course_for, editable_course
from myteacher.api.deps import Db, Now, requires
from myteacher.courses import materials
from myteacher.courses import service as courses
from myteacher.courses.models import ClassroomMaterial, ClassroomMaterialVersion, Course, Topic
from myteacher.lesson.schema import FeedbackMode
from myteacher.persistence import InstanceSession
from myteacher.policy import can_teach_run, is_teacher
from myteacher.runs import attempts, open_assessment, releases
from myteacher.runs import service as runs
from myteacher.runs.models import CourseRun, MaterialRelease

router = APIRouter(tags=["course runs"])
Teacher = Annotated[Account, requires(is_teacher)]

RunName = Annotated[str, AfterValidator(str.strip), Field(min_length=1, max_length=200)]


class RunSummary(BaseModel):
    id: int
    name: str
    roster_size: int


class CourseRef(BaseModel):
    id: int
    name: str


class LatestRelease(BaseModel):
    id: int
    title: str
    released_at: datetime
    # How many of its recipients submitted an attempt that counts, of how many.
    submitted: int
    total: int

    @field_serializer("released_at")
    def _utc(self, at: datetime) -> str:
        return at.strftime("%Y-%m-%dT%H:%M:%SZ")


class TaughtRun(BaseModel):
    id: int
    name: str
    course: CourseRef
    roster_size: int
    # The last release not retracted; None before the first.
    latest_release: LatestRelease | None


class EnrolledStudent(BaseModel):
    id: int
    name: str
    email: str
    state: StudentState


class RosterStudent(BaseModel):
    id: int
    name: str
    email: str
    # Enrolled on their own, not only through a class.
    direct: bool
    # The enrolled classes they are in, by name.
    classes: list[str]


class RunOut(BaseModel):
    id: int
    name: str
    course: CourseRef
    teacher_id: int
    created_at: datetime
    # The enrolled classes by name, with their current sizes.
    classes: list[ClassSummary]
    # The students enrolled directly, by name, whatever the state of their account.
    students: list[EnrolledStudent]
    # Every student of the run now: from the live class membership and the direct enrolments,
    # without deactivated students or minors awaiting consent.
    roster: list[RosterStudent]

    @field_serializer("created_at")
    def _utc(self, at: datetime) -> str:
        return at.strftime("%Y-%m-%dT%H:%M:%SZ")


class RunIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: RunName


class ReleasableMaterial(BaseModel):
    id: int
    topic: str
    # Of the latest version.
    title: str
    # The version numbers, newest first.
    versions: list[int]
    # The students the material was made for, to preselect.
    target_student_ids: list[int]


class StudentRef(BaseModel):
    id: int
    name: str


class ReleaseSettings(BaseModel):
    feedback_mode: FeedbackMode = "immediate"
    due_at: AwareDatetime | None = None
    # After the due date: accept and mark late, or refuse.
    late_submissions: Literal["accept", "refuse"] = "accept"
    # One attempt, or repeated ones where the last submitted counts.
    attempts: Literal["one", "repeated"] = "one"
    show_solutions: bool = True


class ReleaseIn(ReleaseSettings):
    model_config = ConfigDict(extra="forbid")

    material_id: int
    # The version's number; it is frozen at release.
    version: int
    # The whole roster, including students who join later, or the chosen students of it.
    audience: Literal["run", "chosen"] = "run"
    student_ids: list[int] | None = None

    @model_validator(mode="after")
    def _students_only_when_chosen(self) -> Self:
        if (self.audience == "chosen") != (self.student_ids is not None):
            raise ValueError("student_ids are given exactly when the audience is chosen")
        return self


class ReleaseOut(ReleaseSettings):
    id: int
    material_id: int
    # Of the released version.
    title: str
    topic: str
    topic_id: int
    version: int
    audience: Literal["run", "chosen"]
    # The chosen students by name; empty for a release to the whole run.
    students: list[StudentRef]
    released_by_id: int
    released_at: datetime
    # Set once the teacher retracted it, with the reason the students were told.
    retracted_at: datetime | None = None
    retraction_reason: str | None = None

    @field_serializer("released_at", "due_at", "retracted_at")
    def _utc(self, at: datetime | None) -> str | None:
        return at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ") if at else None


def taught_run(db: InstanceSession, actor: Account, run_id: int) -> CourseRun:
    """The run, or 404 for one the actor does not teach, so its existence does not leak."""
    run = runs.get_run(db, run_id)
    course = courses.get_course(db, run.course_id) if run is not None else None
    if run is None or course is None or not can_teach_run(actor, run, course):
        raise HTTPException(status_code=404)
    return run


def _out(db: InstanceSession, run: CourseRun) -> RunOut:
    course = courses.get_course(db, run.course_id)
    assert course is not None, "a course with runs is never deleted"
    consents = consent.latest_consents(db)
    return RunOut(
        id=run.id,
        name=run.name,
        course=CourseRef(id=course.id, name=course.name),
        teacher_id=run.teacher_id,
        created_at=run.created_at,
        classes=[
            ClassSummary(id=klass.id, name=klass.name, member_count=count)
            for klass, count in runs.enrolled_classes(db, run)
        ],
        students=[
            EnrolledStudent(
                id=student.id,
                name=student.name or "",
                email=student.email,
                state=consent.student_state(student, consents.get(student.id)),
            )
            for student in runs.enrolled_students(db, run)
        ],
        roster=[
            RosterStudent(
                id=entry.student.id,
                name=entry.student.name or "",
                email=entry.student.email,
                direct=entry.direct,
                classes=entry.classes,
            )
            for entry in runs.roster(db, run)
        ],
    )


@router.get("/courses/{course_id}/runs")
def list_runs(course_id: int, db: Db, actor: Teacher) -> list[RunSummary]:
    """The runs of the course the actor teaches, by name."""
    course = course_for(db, actor, course_id)
    found = runs.runs_of(db, course.id, actor)
    sizes = runs.roster_sizes(db, found)
    return [RunSummary(id=run.id, name=run.name, roster_size=sizes[run.id]) for run in found]


def runs_taught(db: InstanceSession, actor: Account) -> dict[CourseRun, Course]:
    """Every run the actor teaches, with its course; a run of a course they can no longer see is
    theirs no longer."""
    taught = {run: db.get_one(Course, run.course_id) for run in runs.runs_taught_by(db, actor)}
    return {run: course for run, course in taught.items() if can_teach_run(actor, run, course)}


@router.get("/runs")
def list_taught_runs(db: Db, actor: Teacher) -> list[TaughtRun]:
    """Every run the actor teaches, across courses, by course and then by name."""
    taught = runs_taught(db, actor)
    course_of = {run.id: course for run, course in taught.items()}
    found = list(taught)
    rosters = {run.id: [entry.student for entry in runs.roster(db, run)] for run in found}
    latest = releases.latest_releases(db, found)

    def latest_of(run: CourseRun) -> LatestRelease | None:
        if run.id not in latest:
            return None
        released, title = latest[run.id]
        submitted, total = releases.submitted_of(db, run, released, rosters[run.id])
        return LatestRelease(
            id=released.id,
            title=title,
            released_at=released.released_at,
            submitted=submitted,
            total=total,
        )

    listed = [
        TaughtRun(
            id=run.id,
            name=run.name,
            course=CourseRef(id=run.course_id, name=course_of[run.id].name),
            roster_size=len(rosters[run.id]),
            latest_release=latest_of(run),
        )
        for run in found
    ]
    return sorted(listed, key=lambda run: (run.course.name, run.name, run.id))


@router.post("/courses/{course_id}/runs", status_code=201)
def start_run(course_id: int, body: RunIn, db: Db, now: Now, actor: Teacher) -> RunOut:
    """A new run of the course taught by the actor, who must be its owner or an editor."""
    course = editable_course(db, actor, course_id)
    return _out(db, runs.start_run(db, course.id, actor, body.name, now=now))


@router.get("/runs/{run_id}")
def read_run(run_id: int, db: Db, actor: Teacher) -> RunOut:
    return _out(db, taught_run(db, actor, run_id))


@router.patch("/runs/{run_id}")
def rename_run(run_id: int, body: RunIn, db: Db, actor: Teacher) -> RunOut:
    run = taught_run(db, actor, run_id)
    run.name = body.name
    return _out(db, run)


@router.put("/runs/{run_id}/classes/{class_id}")
def enrol_class(run_id: int, class_id: int, db: Db, actor: Teacher) -> RunOut:
    """Enrol a class; its students are the run's for as long as they are in it."""
    run = taught_run(db, actor, run_id)
    runs.enrol_class(db, run, class_or_404(db, class_id))
    return _out(db, run)


@router.delete("/runs/{run_id}/classes/{class_id}")
def unenrol_class(run_id: int, class_id: int, db: Db, actor: Teacher) -> RunOut:
    run = taught_run(db, actor, run_id)
    runs.unenrol_class(db, run, class_or_404(db, class_id))
    return _out(db, run)


@router.put("/runs/{run_id}/students/{student_id}")
def enrol_student(run_id: int, student_id: int, db: Db, actor: Teacher) -> RunOut:
    run = taught_run(db, actor, run_id)
    runs.enrol_student(db, run, student_or_404(db, student_id))
    return _out(db, run)


@router.delete("/runs/{run_id}/students/{student_id}")
def unenrol_student(run_id: int, student_id: int, db: Db, actor: Teacher) -> RunOut:
    run = taught_run(db, actor, run_id)
    runs.unenrol_student(db, run, student_or_404(db, student_id))
    return _out(db, run)


def release_out(db: InstanceSession, released: MaterialRelease) -> ReleaseOut:
    version = db.get_one(ClassroomMaterialVersion, released.version_id)
    material = db.get_one(ClassroomMaterial, released.material_id)
    topic = db.get_one(Topic, material.topic_id)
    return ReleaseOut(
        id=released.id,
        material_id=released.material_id,
        title=version.lesson["title"],
        topic=topic.name,
        topic_id=topic.id,
        version=version.number,
        audience=released.audience,  # type: ignore[arg-type]
        students=[
            StudentRef(id=student.id, name=student.name or "")
            for student in releases.chosen_students(db, released)
        ],
        feedback_mode=released.feedback_mode,  # type: ignore[arg-type]
        due_at=released.due_at,
        late_submissions=released.late_submissions,  # type: ignore[arg-type]
        attempts=released.attempts,  # type: ignore[arg-type]
        show_solutions=released.show_solutions,
        released_by_id=released.released_by_id,
        released_at=released.released_at,
        retracted_at=released.retracted_at,
        retraction_reason=released.retraction_reason,
    )


@router.get("/runs/{run_id}/materials")
def releasable_materials(run_id: int, db: Db, actor: Teacher) -> list[ReleasableMaterial]:
    """The classroom material of the run's course that can be released, in topic order."""
    run = taught_run(db, actor, run_id)
    return [
        ReleasableMaterial(
            id=material.id,
            topic=topic.name,
            title=versions[0].lesson["title"],
            versions=[version.number for version in versions],
            target_student_ids=materials.targets_of(db, material),
        )
        for material, topic, versions in releases.releasable(db, run)
    ]


class ListedRelease(ReleaseOut):
    # How many of its recipients submitted an attempt that counts, of how many.
    submitted: int
    total: int
    # Open answers waiting for an assessment.
    waiting: int
    # The recipients who did not submit by the due date, once it passed.
    overdue_student_ids: list[int]


@router.get("/runs/{run_id}/releases")
def list_releases(run_id: int, db: Db, now: Now, actor: Teacher) -> list[ListedRelease]:
    """The run's releases, the first released first, each with how far its students got."""
    run = taught_run(db, actor, run_id)
    found = releases.releases_of(db, run)
    roster = [entry.student for entry in runs.roster(db, run)]
    waiting = open_assessment.waiting_counts(db, [released.id for released in found])
    listed = []
    for released in found:
        # An attempt left open at a refusing due date is submitted by whatever reads it first.
        attempts.close_past_due_of(db, released, now)
        recipients = {s.id for s in releases.recipients(db, run, released, roster)}
        submitted = recipients & releases.submitters(db, released)
        overdue = (
            released.due_at is not None and now > released.due_at and released.retracted_at is None
        )
        listed.append(
            ListedRelease(
                **release_out(db, released).model_dump(),
                submitted=len(submitted),
                total=len(recipients),
                waiting=waiting.get(released.id, 0),
                overdue_student_ids=sorted(recipients - submitted) if overdue else [],
            )
        )
    return listed


class MaterialReleased(BaseModel):
    run_id: int
    run_name: str
    release_id: int
    version: int
    released_at: datetime

    @field_serializer("released_at")
    def _utc(self, at: datetime) -> str:
        return at.strftime("%Y-%m-%dT%H:%M:%SZ")


@router.get("/courses/{course_id}/topics/{topic_id}/classroom-materials/{material_id}/releases")
def material_releases(
    course_id: int, topic_id: int, material_id: int, db: Db, actor: Teacher
) -> list[MaterialReleased]:
    """The releases of the material not retracted, in the runs the actor teaches."""
    course = course_for(db, actor, course_id)
    material = db.get(ClassroomMaterial, material_id)
    topic = db.get(Topic, material.topic_id) if material else None
    if material is None or topic is None or topic.id != topic_id or topic.course_id != course.id:
        raise HTTPException(status_code=404)
    taught = {run.id: run for run in runs_taught(db, actor)}
    found = db.execute(
        select(MaterialRelease, ClassroomMaterialVersion.number)
        .join(ClassroomMaterialVersion, ClassroomMaterialVersion.id == MaterialRelease.version_id)
        .where(
            MaterialRelease.material_id == material.id,
            MaterialRelease.run_id.in_(taught),
            MaterialRelease.retracted_at.is_(None),
        )
        .order_by(MaterialRelease.released_at, MaterialRelease.id)
    ).tuples()
    return [
        MaterialReleased(
            run_id=released.run_id,
            run_name=taught[released.run_id].name,
            release_id=released.id,
            version=number,
            released_at=released.released_at,
        )
        for released, number in found
    ]


@router.post(
    "/runs/{run_id}/releases",
    status_code=201,
    responses={422: {"description": "Unknown material or version, a student not in the run"}},
)
def release_material(run_id: int, body: ReleaseIn, db: Db, now: Now, actor: Teacher) -> ReleaseOut:
    """Release a version of a classroom material of the run's course; it never changes after."""
    run = taught_run(db, actor, run_id)
    try:
        released = releases.release(
            db,
            run,
            material_id=body.material_id,
            version=body.version,
            student_ids=body.student_ids,
            settings=releases.Settings(
                **body.model_dump(include=set(ReleaseSettings.model_fields))
            ),
            teacher=actor,
            now=now,
        )
    except releases.UnknownMaterial:
        raise HTTPException(status_code=422, detail="unknown_material") from None
    except releases.UnknownVersion:
        raise HTTPException(status_code=422, detail="unknown_version") from None
    except releases.NotInRun:
        raise HTTPException(status_code=422, detail="not_in_run") from None
    except releases.DueInThePast:
        raise HTTPException(status_code=422, detail="due_in_the_past") from None
    return release_out(db, released)


@router.get("/runs/{run_id}/releases/{release_id}/recipients")
def release_recipients(run_id: int, release_id: int, db: Db, actor: Teacher) -> list[StudentRef]:
    """Who has the release now, by name: its audience as the roster stands today."""
    run = taught_run(db, actor, run_id)
    released = releases.get_release(db, run, release_id)
    if released is None:
        raise HTTPException(status_code=404)
    return [
        StudentRef(id=student.id, name=student.name or "")
        for student in releases.recipients(db, run, released)
    ]
