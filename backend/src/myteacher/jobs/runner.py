"""Background jobs run in-process (phase 1): the API creates a job and schedules its work, the
work runs after the response in its own database session, and the frontend polls the job.

Jobs are the only way assistant tasks run, so the browser never waits on a model call.
"""

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import Engine, select, update

from myteacher.accounts.models import Account
from myteacher.assistant.service import AssistantContext, AssistantFailed
from myteacher.jobs.models import Job
from myteacher.persistence import InstanceSession, open_session

if TYPE_CHECKING:
    from myteacher.courses.pages import PageFetcher

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class JobContext:
    engine: Engine
    instance_id: int
    assistant: AssistantContext
    # How source pages are fetched from the web.
    pages: "PageFetcher"


class JobFailed(Exception):
    """Work that ended for a reason the teacher can act on, such as a file with no text."""

    def __init__(self, kind: str):
        super().__init__(kind)
        self.kind = kind


# The work of a job: given its session, the job and the context, return the job's result.
Work = Callable[[InstanceSession, Job, JobContext], Awaitable[dict[str, Any] | None]]


def create_job(
    db: InstanceSession, kind: str, *, starter: Account, course_id: int | None, now: datetime
) -> Job:
    job = Job(
        account_id=starter.id,
        kind=kind,
        course_id=course_id,
        state="queued",
        progress="waiting",
        created_at=now,
    )
    db.add(job)
    db.flush()
    return job


def get_job(db: InstanceSession, job_id: int) -> Job | None:
    return db.scalars(select(Job).where(Job.id == job_id)).first()


async def run(
    ctx: JobContext, job_id: int, work: Work, *, progress: str = "asking_assistant"
) -> None:
    """Run `work` for the job and record how it ended. Never raises."""
    with open_session(ctx.engine, ctx.instance_id) as db:
        job = get_job(db, job_id)
        if job is None:
            return
        job.state = "running"
        job.progress = progress
        db.commit()
        try:
            job.result = await work(db, job, ctx)
            job.state = "succeeded"
        except AssistantFailed as failure:
            # Keep the generation record the failed call wrote, but nothing else of the work.
            db.commit()
            job.state = "failed"
            job.error_kind = failure.kind
            job.raw_output = failure.raw_output
        except JobFailed as failure:
            db.rollback()
            job.state = "failed"
            job.error_kind = failure.kind
        except Exception:
            logger.exception("job %s (%s) failed", job_id, job.kind)
            db.rollback()
            job.state = "failed"
            job.error_kind = "other"
        job.progress = None
        job.finished_at = ctx.assistant.clock()
        db.commit()


def fail_interrupted(db: InstanceSession, now: datetime) -> None:
    """Jobs still queued or running when the app starts were cut off by a restart."""
    db.execute(
        update(Job)
        .where(Job.state.in_(("queued", "running")))
        .values(state="failed", error_kind="interrupted", progress=None, finished_at=now)
    )
