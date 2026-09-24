"""The interview about one topic: run by the course's owner or editors on their own key, read by
anyone who may view the course. Every step runs as a job; the client polls it, then reads the
interview again. The additions it ends in are part of the topic (see the topics API)."""

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import StaleDataError

from myteacher.accounts.models import Account
from myteacher.api.courses import course_for, editable_course
from myteacher.api.deps import Db, Now, requires
from myteacher.api.interview import Answers, RoundOut, rounds_out
from myteacher.api.jobs import JobOut
from myteacher.assistant.service import paying_credential
from myteacher.courses import interview as interviews
from myteacher.courses import topic_interview as topic_interviews
from myteacher.courses import topics
from myteacher.courses.models import Course, Topic, TopicInterview
from myteacher.jobs import runner
from myteacher.persistence import InstanceSession
from myteacher.policy import is_teacher

router = APIRouter(
    prefix="/courses/{course_id}/topics/{topic_id}/interview", tags=["topic interview"]
)
Teacher = Annotated[Account, requires(is_teacher)]


class TopicInterviewOut(BaseModel):
    id: int
    topic_id: int
    state: str
    rounds: list[RoundOut]
    # Set once finished: what the additions now say, to the teacher.
    summary: str | None
    # The latest job working on the interview.
    job: JobOut | None


class Started(BaseModel):
    interview: TopicInterviewOut
    job: JobOut


def _out(db: InstanceSession, interview: TopicInterview) -> TopicInterviewOut:
    job = runner.get_job(db, interview.job_id) if interview.job_id else None
    return TopicInterviewOut(
        id=interview.id,
        topic_id=interview.topic_id,
        state=interview.state,
        rounds=rounds_out(interview.rounds),
        summary=interview.summary,
        job=JobOut.of(job) if job else None,
    )


def _topic(db: InstanceSession, course: Course, topic_id: int) -> Topic:
    topic = topics.get_topic(db, course, topic_id)
    if topic is None:
        raise HTTPException(status_code=404)
    return topic


def _active(db: InstanceSession, topic: Topic) -> TopicInterview:
    interview = topic_interviews.latest(db, topic)
    if interview is None or interview.state != "active":
        raise HTTPException(status_code=409, detail="no_active_interview")
    return interview


def _save(db: InstanceSession) -> None:
    """Write now, so that a concurrent change to the interview is refused rather than lost."""
    try:
        db.flush()
    except StaleDataError:
        raise HTTPException(status_code=409, detail="interview_changed") from None


def _busy(db: InstanceSession, interview: TopicInterview) -> bool:
    job = runner.get_job(db, interview.job_id) if interview.job_id else None
    return job is not None and job.state in ("queued", "running")


def _schedule(
    request: Request,
    background: BackgroundTasks,
    db: InstanceSession,
    interview: TopicInterview,
    actor: Account,
    now,
) -> Started:
    """Start the next step of the interview as a job paid by the actor's key."""
    if paying_credential(db, actor) is None:
        raise HTTPException(status_code=409, detail="no_provider_key")
    job = runner.create_job(
        db, topic_interviews.TASK_KIND, starter=actor, course_id=interview.course_id, now=now
    )
    interview.job_id = job.id
    _save(db)
    # Runs after the response, once this request's transaction has committed.
    background.add_task(runner.run, request.app.state.jobs, job.id, topic_interviews.next_step)
    return Started(interview=_out(db, interview), job=JobOut.of(job))


@router.get("")
def read_interview(
    course_id: int, topic_id: int, db: Db, actor: Teacher
) -> TopicInterviewOut | None:
    """The topic's latest interview, or null when there has been none."""
    topic = _topic(db, course_for(db, actor, course_id), topic_id)
    interview = topic_interviews.latest(db, topic)
    return _out(db, interview) if interview else None


@router.post("", status_code=202, responses={409: {"description": "Already running, or no key"}})
def start_interview(
    course_id: int,
    topic_id: int,
    request: Request,
    background: BackgroundTasks,
    db: Db,
    now: Now,
    actor: Teacher,
) -> Started:
    topic = _topic(db, editable_course(db, actor, course_id), topic_id)
    current = topic_interviews.latest(db, topic)
    if current is not None and current.state == "active":
        raise HTTPException(status_code=409, detail="interview_active")
    if paying_credential(db, actor) is None:
        raise HTTPException(status_code=409, detail="no_provider_key")
    try:
        interview = topic_interviews.start(db, topic, actor.id, now=now)
    except IntegrityError:
        # Another request started one meanwhile.
        raise HTTPException(status_code=409, detail="interview_active") from None
    return _schedule(request, background, db, interview, actor, now)


@router.post("/answers", status_code=202, responses={409: {"description": "No open round"}})
def answer_round(
    course_id: int,
    topic_id: int,
    body: Answers,
    request: Request,
    background: BackgroundTasks,
    db: Db,
    now: Now,
    actor: Teacher,
) -> Started:
    """Answer the open round; the assistant then asks the next one or returns the additions."""
    topic = _topic(db, editable_course(db, actor, course_id), topic_id)
    interview = topic_interviews.latest(db, topic)
    if interview is None or _busy(db, interview) or interviews.open_round(interview) is None:
        raise HTTPException(status_code=409, detail="no_open_round")
    try:
        interviews.record_answers(interview, [a.strip() for a in body.answers])
    except ValueError:
        raise HTTPException(status_code=422, detail="one_answer_per_question") from None
    return _schedule(request, background, db, interview, actor, now)


@router.post("/retry", status_code=202, responses={409: {"description": "Nothing failed"}})
def retry_step(
    course_id: int,
    topic_id: int,
    request: Request,
    background: BackgroundTasks,
    db: Db,
    now: Now,
    actor: Teacher,
) -> Started:
    """Run the step whose job failed once more, for example after fixing the key."""
    interview = _active(db, _topic(db, editable_course(db, actor, course_id), topic_id))
    job = runner.get_job(db, interview.job_id) if interview.job_id else None
    if job is None or job.state != "failed":
        raise HTTPException(status_code=409, detail="nothing_to_retry")
    return _schedule(request, background, db, interview, actor, now)


@router.post("/end", responses={409: {"description": "No active interview"}})
def end_interview(course_id: int, topic_id: int, db: Db, actor: Teacher) -> TopicInterviewOut:
    """Stop the interview early; the topic's additions stay as they are and editable."""
    interview = _active(db, _topic(db, editable_course(db, actor, course_id), topic_id))
    interviews.end(interview)
    _save(db)
    return _out(db, interview)
