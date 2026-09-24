"""Jobs, polled by the frontend until they succeed or fail."""

from typing import Annotated, Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from myteacher.accounts.models import Account
from myteacher.api import courses as courses_api
from myteacher.api.deps import Db, requires
from myteacher.courses import service as courses
from myteacher.jobs import runner
from myteacher.jobs.models import Job, JobState
from myteacher.policy import is_teacher

router = APIRouter(prefix="/jobs", tags=["jobs"])
Teacher = Annotated[Account, requires(is_teacher)]


class JobOut(BaseModel):
    id: int
    kind: str
    state: JobState
    # What the job is doing now: "waiting", "asking_assistant" or "extracting"; None once ended.
    progress: str | None
    result: dict[str, Any] | None
    # Why it failed: a provider problem, "invalid_output", "no_key", "interrupted", "other", or
    # for an extraction "no_text" or "unreadable_file", and for a web page also "unreachable",
    # "page_error", "not_a_page", "too_large" or "blocked_address".
    error_kind: str | None
    # The model's answer when it did not validate.
    raw_output: str | None

    @classmethod
    def of(cls, job: Job) -> "JobOut":
        return cls(
            id=job.id,
            kind=job.kind,
            state=job.state,  # type: ignore[arg-type]
            progress=job.progress,
            result=job.result,
            error_kind=job.error_kind,
            raw_output=job.raw_output,
        )


@router.get("/{job_id}")
def read_job(job_id: int, db: Db, actor: Teacher) -> JobOut:
    """The job, for the teacher who started it or anyone who may view its course."""
    job = runner.get_job(db, job_id)
    if job is None:
        raise HTTPException(status_code=404)
    if job.account_id != actor.id:
        course = courses.get_course(db, job.course_id) if job.course_id else None
        if course is None or not courses_api.can_view_course(actor, course):
            raise HTTPException(status_code=404)
    return JobOut.of(job)
