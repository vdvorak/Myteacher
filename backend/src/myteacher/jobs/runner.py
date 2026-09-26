"""Background jobs run in-process (phase 1): the API creates a job and schedules its work, the
work runs after the response in its own database session, and the frontend polls the job.

Jobs are the only way assistant tasks run, so the browser never waits on a model call.
"""

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from functools import partial
from typing import TYPE_CHECKING, Any

import anyio
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


async def run_together(ctx: JobContext, jobs: list[tuple[int, Work]]) -> None:
    """Run several jobs side by side, each as `run` does, so that none waits for the others.
    Their work commits before every assistant call, so no transaction spans the waiting."""
    async with anyio.create_task_group() as group:
        for job_id, work in jobs:
            group.start_soon(run, ctx, job_id, work)


async def run_after(
    ctx: JobContext, first: list[tuple[int, Work]], job_id: int, work: Work, *, first_progress: str
) -> None:
    """Run the jobs of `first` side by side, then the job that needs their results. When one of
    them failed, the job fails for the same reason without running; when one was superseded and
    so did not do its work, as "superseded". Never raises."""
    async with anyio.create_task_group() as group:
        for first_id, first_work in first:
            group.start_soon(partial(run, ctx, first_id, first_work, progress=first_progress))
    with open_session(ctx.engine, ctx.instance_id) as db:
        done = [j for j in (get_job(db, first_id) for first_id, _ in first) if j is not None]
        failed = next((j.error_kind for j in done if j.state == "failed"), None)
        if failed is None and any((j.result or {}).get("superseded") for j in done):
            failed = "superseded"
        job = get_job(db, job_id)
        if failed is not None and job is not None:
            job.state = "failed"
            job.error_kind = failed
            job.progress = None
            job.finished_at = ctx.assistant.clock()
            db.commit()
        if failed is not None:
            return
    await run(ctx, job_id, work)


def fail_interrupted(db: InstanceSession, now: datetime) -> None:
    """Jobs still queued or running when the app starts were cut off by a restart."""
    db.execute(
        update(Job)
        .where(Job.state.in_(("queued", "running")))
        .values(state="failed", error_kind="interrupted", progress=None, finished_at=now)
    )
