"""The teacher interview of a course: run by its owner or editors on their own key, read by
anyone who may view the course. Every step runs as a job; the client polls it, then reads the
interview again."""

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import StaleDataError

from myteacher.accounts.models import Account
from myteacher.api.courses import course_for, editable_course
from myteacher.api.deps import Db, Now, requires
from myteacher.api.jobs import JobOut
from myteacher.assistant.service import paying_credential
from myteacher.courses import interview as interviews
from myteacher.courses.models import Course, Interview
from myteacher.jobs import runner
from myteacher.persistence import InstanceSession
from myteacher.policy import is_teacher

router = APIRouter(prefix="/courses/{course_id}/interview", tags=["interview"])
Teacher = Annotated[Account, requires(is_teacher)]


class QuestionOut(BaseModel):
    number: int
    question: str
    recommended_answer: str


class RoundOut(BaseModel):
    number: int
    questions: list[QuestionOut]
    # None while the round waits for the teacher.
    answers: list[str] | None


class InterviewOut(BaseModel):
    id: int
    state: str
    rounds: list[RoundOut]
    # Set once finished: False means content will be generated without sources.
    sources_offered: bool | None
    summary: str | None
    # The latest job working on the interview.
    job: JobOut | None


class Started(BaseModel):
    interview: InterviewOut
    job: JobOut


class Answers(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # One per question of the open round, in order; an empty answer leaves a question open.
    answers: list[Annotated[str, Field(max_length=5000)]]


def _out(db: InstanceSession, interview: Interview) -> InterviewOut:
    job = runner.get_job(db, interview.job_id) if interview.job_id else None
    return InterviewOut(
        id=interview.id,
        state=interview.state,
        rounds=[
            RoundOut(
                number=n,
                questions=[
                    QuestionOut(number=q, **question)
                    for q, question in enumerate(r["questions"], 1)
                ],
                answers=r["answers"],
            )
            for n, r in enumerate(interview.rounds, 1)
        ],
        sources_offered=interview.sources_offered,
        summary=interview.summary,
        job=JobOut.of(job) if job else None,
    )


def _active(db: InstanceSession, course: Course) -> Interview:
    interview = interviews.latest(db, course)
    if interview is None or interview.state != "active":
        raise HTTPException(status_code=409, detail="no_active_interview")
    return interview


def _save(db: InstanceSession) -> None:
    """Write now, so that a concurrent change to the interview is refused rather than lost."""
    try:
        db.flush()
    except StaleDataError:
        raise HTTPException(status_code=409, detail="interview_changed") from None


def _busy(db: InstanceSession, interview: Interview) -> bool:
    job = runner.get_job(db, interview.job_id) if interview.job_id else None
    return job is not None and job.state in ("queued", "running")


def _schedule(
    request: Request,
    background: BackgroundTasks,
    db: InstanceSession,
    interview: Interview,
    actor: Account,
    now,
) -> Started:
    """Start the next step of the interview as a job paid by the actor's key."""
    if paying_credential(db, actor) is None:
        raise HTTPException(status_code=409, detail="no_provider_key")
    job = runner.create_job(
        db, interviews.TASK_KIND, starter=actor, course_id=interview.course_id, now=now
    )
    interview.job_id = job.id
    _save(db)
    # Runs after the response, once this request's transaction has committed.
    background.add_task(runner.run, request.app.state.jobs, job.id, interviews.next_step)
    return Started(interview=_out(db, interview), job=JobOut.of(job))


@router.get("")
def read_interview(course_id: int, db: Db, actor: Teacher) -> InterviewOut | None:
    """The course's latest interview, or null when there has been none."""
    interview = interviews.latest(db, course_for(db, actor, course_id))
    return _out(db, interview) if interview else None


@router.post("", status_code=202, responses={409: {"description": "Already running, or no key"}})
def start_interview(
    course_id: int, request: Request, background: BackgroundTasks, db: Db, now: Now, actor: Teacher
) -> Started:
    course = editable_course(db, actor, course_id)
    current = interviews.latest(db, course)
    if current is not None and current.state == "active":
        raise HTTPException(status_code=409, detail="interview_active")
    if paying_credential(db, actor) is None:
        raise HTTPException(status_code=409, detail="no_provider_key")
    try:
        interview = interviews.start(db, course, actor.id, now=now)
    except IntegrityError:
        # Another request started one meanwhile.
        raise HTTPException(status_code=409, detail="interview_active") from None
    return _schedule(request, background, db, interview, actor, now)


@router.post("/answers", status_code=202, responses={409: {"description": "No open round"}})
def answer_round(
    course_id: int,
    body: Answers,
    request: Request,
    background: BackgroundTasks,
    db: Db,
    now: Now,
    actor: Teacher,
) -> Started:
    """Answer the open round; the assistant then asks the next one or returns the brief."""
    course = editable_course(db, actor, course_id)
    interview = interviews.latest(db, course)
    if interview is None or _busy(db, interview) or interviews.open_round(interview) is None:
        raise HTTPException(status_code=409, detail="no_open_round")
    try:
        interviews.record_answers(interview, [a.strip() for a in body.answers])
    except ValueError:
        raise HTTPException(status_code=422, detail="one_answer_per_question") from None
    return _schedule(request, background, db, interview, actor, now)


@router.post("/retry", status_code=202, responses={409: {"description": "Nothing failed"}})
def retry_step(
    course_id: int, request: Request, background: BackgroundTasks, db: Db, now: Now, actor: Teacher
) -> Started:
    """Run the step whose job failed once more, for example after fixing the key."""
    course = editable_course(db, actor, course_id)
    interview = _active(db, course)
    job = runner.get_job(db, interview.job_id) if interview.job_id else None
    if job is None or job.state != "failed":
        raise HTTPException(status_code=409, detail="nothing_to_retry")
    return _schedule(request, background, db, interview, actor, now)


@router.post("/end", responses={409: {"description": "No active interview"}})
def end_interview(course_id: int, db: Db, actor: Teacher) -> InterviewOut:
    """Stop the interview early; the brief stays as it is and editable."""
    interview = _active(db, editable_course(db, actor, course_id))
    interviews.end(interview)
    _save(db)
    return _out(db, interview)
