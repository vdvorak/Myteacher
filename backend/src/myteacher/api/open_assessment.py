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
from myteacher.api.runs import taught_run
from myteacher.assistant.service import paying_credential
from myteacher.jobs import runner
from myteacher.persistence import InstanceSession
from myteacher.policy import is_teacher
from myteacher.runs import open_assessment, releases
from myteacher.runs.models import Assessment, Attempt, CourseRun, MaterialRelease

router = APIRouter(tags=["course runs"])
Teacher = Annotated[Account, requires(is_teacher)]


class AssessmentStarted(BaseModel):
    job: JobOut


class OverrideIn(BaseModel):
    score: Annotated[float, Field(ge=0, le=1)]
    reason: Annotated[str, AfterValidator(str.strip), Field(min_length=1, max_length=1000)]


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
    open_assessment.override(db, row, score=body.score, reason=body.reason, teacher=actor, now=now)
    return AssessmentReview.of(row)


@router.post("/runs/{run_id}/releases/{release_id}/publication")
def publish_results(run_id: int, release_id: int, db: Db, actor: Teacher) -> Published:
    """Show the students the assessments and overrides they have not seen yet."""
    run = taught_run(db, actor, run_id)
    return Published(published=open_assessment.publish(db, _release(db, run, release_id)))
