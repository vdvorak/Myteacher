"""The results of a release for the run teacher alone (#69): students × exercises from the
attempts that count, a summary per exercise, and each student's attempts with every assessment."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Response
from pydantic import AfterValidator, BaseModel, Field, field_serializer

from myteacher.accounts.models import Account
from myteacher.api.attempts import AttemptOut, attempt_out
from myteacher.api.deps import Db, Now, requires
from myteacher.api.runs import ReleaseOut, release_out, taught_run
from myteacher.lesson.catalog import COMPONENT_CATALOG
from myteacher.persistence import InstanceSession
from myteacher.policy import is_teacher
from myteacher.runs import attempts, learners, open_assessment, releases
from myteacher.runs import results as outcomes
from myteacher.runs.models import CourseRun, MaterialRelease
from myteacher.runs.results import Cell

router = APIRouter(tags=["course runs"])
Teacher = Annotated[Account, requires(is_teacher)]


class ExerciseSummary(BaseModel):
    id: str
    type: str
    # The exercise's prompt, or a translation's source text.
    prompt: str | None
    # How many counted attempts got it right, wrong, left it waiting for the teacher or empty.
    right: int
    wrong: int
    open: int
    unanswered: int


class StudentResult(BaseModel):
    id: int
    name: str
    # Still one of the release's recipients.
    in_run: bool
    state: str
    # The attempt that counts was submitted late.
    late: bool
    attempts: int
    # By exercise id, from the attempt that counts; empty without one.
    cells: dict[str, Cell]


class OpenAnswers(BaseModel):
    # Open answers of submitted attempts not yet assessed, flagged ones included.
    waiting: int
    # Assessed by the assistant.
    assessed: int
    # The assistant's output did not fit; the teacher assesses them.
    flagged: int
    # Assessments and overrides the students have not been shown yet.
    unpublished: int


class ReleaseResults(BaseModel):
    release: ReleaseOut
    open_answers: OpenAnswers
    # The first pass's exercises in lesson order.
    exercises: list[ExerciseSummary]
    # By name.
    students: list[StudentResult]


class StudentRef(BaseModel):
    id: int
    name: str
    in_run: bool


class TeacherAttempt(AttemptOut):
    # The last submitted attempt, which is the one that counts.
    counts: bool
    # Set once retracted: the answers stay here but count for nothing.
    retracted_at: datetime | None
    retraction_reason: str | None

    @field_serializer("retracted_at")
    def _utc_retracted(self, at: datetime | None) -> str | None:
        return at.isoformat().replace("+00:00", "Z") if at is not None else None


class RetractionIn(BaseModel):
    # What the student is told.
    reason: Annotated[str, AfterValidator(str.strip), Field(min_length=1, max_length=1000)]


class StudentAttempts(BaseModel):
    student: StudentRef
    # The latest first, each with every assessment and its solution.
    attempts: list[TeacherAttempt]


def _release_or_404(db: InstanceSession, run: CourseRun, release_id: int) -> MaterialRelease:
    released = releases.get_release(db, run, release_id)
    if released is None:
        raise HTTPException(status_code=404)
    return released


@router.get("/runs/{run_id}/releases/{release_id}/results")
def release_results(
    run_id: int, release_id: int, db: Db, now: Now, actor: Teacher
) -> ReleaseResults:
    run = taught_run(db, actor, run_id)
    released = _release_or_404(db, run, release_id)
    found = outcomes.results(db, run, released, now)
    name = learners.names(db, run)
    lesson = attempts.lesson_of(db, released)
    exercises = []
    # The exercises the students answer: those of the catalog, as the cells have them.
    for exercise in lesson.exercises():
        if exercise.type not in COMPONENT_CATALOG:
            continue
        cells = [result.cells[exercise.id] for result in found if exercise.id in result.cells]
        prompt = getattr(exercise, "prompt", None) or getattr(exercise, "source_text", None)
        exercises.append(
            ExerciseSummary(
                id=exercise.id,
                type=exercise.type,
                prompt=prompt,
                right=cells.count("right"),
                wrong=cells.count("wrong"),
                open=cells.count("open"),
                unanswered=cells.count("unanswered"),
            )
        )
    every = open_assessment.assessments_of(db, released)
    return ReleaseResults(
        release=release_out(db, released),
        open_answers=OpenAnswers(
            waiting=len(open_assessment.waiting(db, released)),
            assessed=sum(row.assistant_score is not None for row in every),
            flagged=sum(
                row.assistant_failed and row.assistant_score is None and row.override_score is None
                for row in every
            ),
            unpublished=sum(open_assessment.unpublished(row) for row in every),
        ),
        exercises=exercises,
        students=[
            StudentResult(
                id=result.student.id,
                name=name(result.student),
                in_run=result.in_run,
                state=result.standing.state,
                late=result.standing.counting.late if result.standing.counting else False,
                attempts=len(result.attempts),
                cells=result.cells,
            )
            for result in found
        ],
    )


@router.get("/runs/{run_id}/releases/{release_id}/results/{student_id}")
def student_results(
    run_id: int, release_id: int, student_id: int, db: Db, now: Now, actor: Teacher
) -> StudentAttempts:
    run = taught_run(db, actor, run_id)
    released = _release_or_404(db, run, release_id)
    student = next((s for s in outcomes.students_of(db, run, released) if s.id == student_id), None)
    if student is None:
        raise HTTPException(status_code=404)
    standing = attempts.standing(db, released, student, now)
    in_run = any(learners.same(s, student) for s in releases.recipients(db, run, released))
    name = learners.names(db, run)
    return StudentAttempts(
        student=StudentRef(id=student.id, name=name(student), in_run=in_run),
        attempts=[
            TeacherAttempt(
                **attempt_out(db, attempt, released, teacher=True).model_dump(),
                counts=standing.counting is not None and attempt.id == standing.counting.id,
                retracted_at=attempt.retracted_at,
                retraction_reason=attempt.retraction_reason,
            )
            for attempt in reversed(attempts.attempts_of(db, released, student))
        ],
    )


@router.post(
    "/runs/{run_id}/releases/{release_id}/students/{student_id}/retraction", status_code=204
)
def retract_attempt(
    run_id: int,
    release_id: int,
    student_id: int,
    body: RetractionIn,
    db: Db,
    now: Now,
    actor: Teacher,
) -> Response:
    """Retract the student's attempt being worked on, or else the one that counts: its answers
    stay here but count for nothing, the student is told why and may start a new one."""
    run = taught_run(db, actor, run_id)
    released = _release_or_404(db, run, release_id)
    student = next((s for s in outcomes.students_of(db, run, released) if s.id == student_id), None)
    if student is None:
        raise HTTPException(status_code=404)
    try:
        attempts.retract_attempt(db, released, student, reason=body.reason, teacher=actor, now=now)
    except attempts.ReleaseRetracted:
        raise HTTPException(status_code=409, detail="release_retracted") from None
    except attempts.NothingToRetract:
        raise HTTPException(status_code=409, detail="nothing_to_retract") from None
    return Response(status_code=204)


@router.post("/runs/{run_id}/releases/{release_id}/retraction")
def retract_release(
    run_id: int, release_id: int, body: RetractionIn, db: Db, now: Now, actor: Teacher
) -> ReleaseOut:
    """Take the release from its students and retract every attempt at it; the answers stay
    here. A corrected material is released anew."""
    run = taught_run(db, actor, run_id)
    released = _release_or_404(db, run, release_id)
    try:
        attempts.retract_release(db, released, reason=body.reason, teacher=actor, now=now)
    except attempts.ReleaseRetracted:
        raise HTTPException(status_code=409, detail="release_retracted") from None
    return release_out(db, released)
