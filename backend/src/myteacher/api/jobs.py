"""Jobs, polled by the frontend until they succeed or fail."""

from datetime import datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_serializer
from sqlalchemy import select

from myteacher.accounts.models import Account
from myteacher.api import courses as courses_api
from myteacher.api.deps import Db, Now, requires
from myteacher.courses import service as courses
from myteacher.courses.models import (
    ClassroomMaterial,
    ConceptMap,
    Course,
    ReferenceDocument,
    TopicInterview,
)
from myteacher.jobs import runner
from myteacher.jobs.models import Job, JobState
from myteacher.policy import is_teacher
from myteacher.runs.models import CourseRun, MaterialRelease

router = APIRouter(prefix="/jobs", tags=["jobs"])
Teacher = Annotated[Account, requires(is_teacher)]


class JobOut(BaseModel):
    id: int
    kind: str
    state: JobState
    # What the job is doing now: "waiting", "asking_assistant" or "extracting"; None once ended.
    progress: str | None
    result: dict[str, Any] | None
    # Why it failed: a provider problem, "invalid_output", "too_long" (the answer was cut off at
    # the output limit), "no_key", "interrupted", "other", or
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


# How far back the shell looks for the teacher's assistant work, and how much it shows.
RECENT = timedelta(days=1)
RECENT_LIMIT = 20


class JobPlace(BaseModel):
    """Where the job's result is: its course, and within it the topic or the run's release."""

    course_id: int | None
    topic_id: int | None
    run_id: int | None
    release_id: int | None


class RecentJob(JobOut):
    course_name: str | None
    place: JobPlace
    created_at: datetime

    @field_serializer("created_at")
    def _utc(self, at: datetime) -> str:
        return at.strftime("%Y-%m-%dT%H:%M:%SZ")


def _places(db: Db, jobs: list[Job]) -> dict[int, JobPlace]:
    """Where each job's result is; one a later job replaced points at its course only."""
    ids = [job.id for job in jobs]
    topics: dict[int, int] = {}
    # A running or failed job is the latest job of what it works on.
    for model in (TopicInterview, ConceptMap, ReferenceDocument, ClassroomMaterial):
        found = select(model.job_id, model.topic_id).where(model.job_id.in_(ids))
        topics.update({job_id: topic_id for job_id, topic_id in db.execute(found)})
    # A finished one names in its result what it produced, which may no longer point back at it.
    produced = {
        "concept_map_id": ConceptMap,
        "document_id": ReferenceDocument,
        "material_id": ClassroomMaterial,
    }
    for job in jobs:
        for key, model in produced.items():
            made = (job.result or {}).get(key)
            if job.id not in topics and isinstance(made, int) and (row := db.get(model, made)):
                topics[job.id] = row.topic_id
    assessed = select(MaterialRelease.assessment_job_id, MaterialRelease.run_id, MaterialRelease.id)
    releases = {
        job_id: (run_id, release_id)
        for job_id, run_id, release_id in db.execute(
            assessed.where(MaterialRelease.assessment_job_id.in_(ids))
        )
    }
    places = {}
    for job in jobs:
        run_id, release_id = releases.get(job.id, (None, None))
        course_id = job.course_id
        if course_id is None and run_id is not None:
            course_id = db.get_one(CourseRun, run_id).course_id
        places[job.id] = JobPlace(
            course_id=course_id, topic_id=topics.get(job.id), run_id=run_id, release_id=release_id
        )
    return places


@router.get("")
def list_recent_jobs(db: Db, now: Now, actor: Teacher) -> list[RecentJob]:
    """The assistant work the actor started in the last day, the newest first."""
    jobs = list(
        db.scalars(
            select(Job)
            .where(Job.account_id == actor.id, Job.created_at >= now - RECENT)
            .order_by(Job.created_at.desc(), Job.id.desc())
            .limit(RECENT_LIMIT)
        )
    )
    places = _places(db, jobs)
    courses_by_id = {
        place.course_id: db.get_one(Course, place.course_id).name
        for place in places.values()
        if place.course_id is not None
    }
    return [
        RecentJob(
            **JobOut.of(job).model_dump(),
            course_name=courses_by_id.get(places[job.id].course_id),
            place=places[job.id],
            created_at=job.created_at,
        )
        for job in jobs
    ]


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
