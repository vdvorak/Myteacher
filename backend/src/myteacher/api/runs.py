"""Course runs: started from a course by its owner or an editor, then seen and changed by the
run's teacher alone (ADR 0008). Every change answers with the whole run."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_serializer

from myteacher.accounts import consent
from myteacher.accounts.consent import StudentState
from myteacher.accounts.models import Account
from myteacher.api.classes import ClassSummary, class_or_404, student_or_404
from myteacher.api.courses import course_for, editable_course
from myteacher.api.deps import Db, Now, requires
from myteacher.courses import service as courses
from myteacher.persistence import InstanceSession
from myteacher.policy import can_teach_run, is_teacher
from myteacher.runs import service as runs
from myteacher.runs.models import CourseRun

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
