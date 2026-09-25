"""The run teacher assesses a release's open answers with the assistant, overrides any
assessment and publishes results to the students (#70)."""

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import AfterValidator, BaseModel, Field
from sqlalchemy import select

from myteacher.accounts.models import Account
from myteacher.api.attempts import AssessmentReview
from myteacher.api.deps import Db, Now, requires
from myteacher.api.jobs import JobOut
from myteacher.api.runs import StudentRef, taught_run
from myteacher.assistant.service import paying_credential
from myteacher.jobs import runner
from myteacher.lesson.schema import ExerciseAnswer, OpenExercise
from myteacher.persistence import InstanceSession
from myteacher.policy import is_teacher
from myteacher.runs import attempts, open_assessment, releases
from myteacher.runs.models import Assessment, Attempt, CourseRun, MaterialRelease

router = APIRouter(tags=["course runs"])
Teacher = Annotated[Account, requires(is_teacher)]


class AssessmentStarted(BaseModel):
    job: JobOut


class OverrideIn(BaseModel):
    score: Annotated[float, Field(ge=0, le=1)]
    reason: Annotated[str, AfterValidator(str.strip), Field(min_length=1, max_length=1000)]


class StudentView(BaseModel):
    """What the student sees of an assessment once results are published."""

    score: float | None
    feedback: str | None
    reason: str | None


class OpenAnswer(BaseModel):
    # The assessment's id, which an override names.
    id: int
    student: StudentRef
    exercise_id: str
    round: str
    prompt: str | None
    answer: ExerciseAnswer
    review: AssessmentReview
    # What the student will see once published; None while there is nothing to show.
    student_view: StudentView | None


class Published(BaseModel):
    # How many assessments the students see now that they did not before.
    published: int


def _release(db: InstanceSession, run: CourseRun, release_id: int) -> MaterialRelease:
    released = releases.get_release(db, run, release_id)
    if released is None:
        raise HTTPException(status_code=404)
    return released


@router.post(
    "/runs/{run_id}/releases/{release_id}/open-assessment",
    status_code=202,
    responses={409: {"description": "No key, nothing to assess, or a run going already"}},
)
def assess_open_answers(
    run_id: int,
    release_id: int,
    request: Request,
    background: BackgroundTasks,
    db: Db,
    now: Now,
    actor: Teacher,
) -> AssessmentStarted:
    """Start a job assessing every submitted open answer not assessed yet, on the run teacher's
    key, one call per answer."""
    run = taught_run(db, actor, run_id)
    released = _release(db, run, release_id)
    attempts.close_past_due_of(db, released, now)
    if paying_credential(db, actor) is None:
        raise HTTPException(status_code=409, detail="no_provider_key")
    if open_assessment.running(db, released):
        raise HTTPException(status_code=409, detail="assessment_running")
    if not open_assessment.waiting(db, released):
        raise HTTPException(status_code=409, detail="nothing_to_assess")
    job = runner.create_job(
        db, open_assessment.TASK_KIND, starter=actor, course_id=run.course_id, now=now
    )
    if not open_assessment.claim(db, released, job):
        # The job is not kept: refusing rolls this request back.
        raise HTTPException(status_code=409, detail="assessment_running")
    # Runs after the response, once this request's transaction has committed.
    background.add_task(
        runner.run, request.app.state.jobs, job.id, open_assessment.assessing(released.id)
    )
    return AssessmentStarted(job=JobOut.of(job))


@router.put("/runs/{run_id}/releases/{release_id}/assessments/{assessment_id}/override")
def override_assessment(
    run_id: int,
    release_id: int,
    assessment_id: int,
    body: OverrideIn,
    db: Db,
    now: Now,
    actor: Teacher,
) -> AssessmentReview:
    """Score any assessment of the release, closed or open, with a reason; the students see it
    once results are published."""
    run = taught_run(db, actor, run_id)
    released = _release(db, run, release_id)
    attempts.close_past_due_of(db, released, now)
    found = db.execute(
        select(Assessment, Attempt)
        .join(Attempt, Attempt.id == Assessment.attempt_id)
        .where(Assessment.id == assessment_id, Attempt.release_id == released.id)
    ).first()
    if found is None:
        raise HTTPException(status_code=404)
    row, attempt = found
    if attempt.submitted_at is None:
        # Results are of submitted attempts: an override here could never be published.
        raise HTTPException(status_code=409, detail="not_submitted")
    if attempt.retracted_at is not None:
        raise HTTPException(status_code=409, detail="attempt_retracted")
    open_assessment.override(db, row, score=body.score, reason=body.reason, teacher=actor, now=now)
    return AssessmentReview.of(row)


@router.post("/runs/{run_id}/releases/{release_id}/publication")
def publish_results(run_id: int, release_id: int, db: Db, now: Now, actor: Teacher) -> Published:
    """Show the students the assessments and overrides they have not seen yet."""
    run = taught_run(db, actor, run_id)
    released = _release(db, run, release_id)
    attempts.close_past_due_of(db, released, now)
    return Published(published=open_assessment.publish(db, released, now))


@router.get("/runs/{run_id}/releases/{release_id}/open-answers")
def list_open_answers(
    run_id: int, release_id: int, db: Db, now: Now, actor: Teacher
) -> list[OpenAnswer]:
    """The open answers of the attempts that count, to go through one at a time: the flagged
    ones first, then those waiting, then the assessed ones, each by student."""
    run = taught_run(db, actor, run_id)
    released = _release(db, run, release_id)
    attempts.close_past_due_of(db, released, now)
    lesson = attempts.lesson_of(db, released)
    students = {}
    listed = []
    rows = open_assessment.assessments_of(db, released)
    submitted = [db.get_one(Attempt, attempt_id) for attempt_id in {row.attempt_id for row in rows}]
    # The attempt that counts is each student's last submitted one.
    counting = {}
    for attempt in sorted(submitted, key=lambda a: a.number):
        counting[attempt.student_id] = attempt.id
    for row in rows:
        exercise = lesson.exercise(row.exercise_id)
        if not isinstance(exercise, OpenExercise) or row.attempt_id not in counting.values():
            continue
        attempt = db.get_one(Attempt, row.attempt_id)
        student = students.get(attempt.student_id) or db.get_one(Account, attempt.student_id)
        students[student.id] = student
        view = open_assessment.to_publish(row)
        listed.append(
            OpenAnswer(
                id=row.id,
                student=StudentRef(id=student.id, name=student.name or ""),
                exercise_id=row.exercise_id,
                round=row.round,
                prompt=getattr(exercise, "prompt", None) or getattr(exercise, "source_text", None),
                answer=attempts.answer_of(row),
                review=AssessmentReview.of(row),
                student_view=StudentView(**view) if view else None,
            )
        )

    def order(answer: OpenAnswer) -> tuple:
        review = answer.review
        flagged = review.flagged and review.score is None
        return (not flagged, review.score is not None, answer.student.name, answer.id)

    return sorted(listed, key=order)
