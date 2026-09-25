"""The topic interview: a few rounds like the course interview, inheriting the course brief, so
that the teacher adds only what is specific to the topic. It ends in additions stored on the
topic, which the topic's concept map proposal reads with the brief."""

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import StaleDataError

from myteacher.accounts import service as accounts
from myteacher.assistant.service import Task, generate
from myteacher.courses import service as courses
from myteacher.courses.interview import Round
from myteacher.courses.models import Course, Topic, TopicInterview
from myteacher.courses.topics import topics_of
from myteacher.jobs.models import Job
from myteacher.jobs.runner import JobContext
from myteacher.persistence import InstanceSession

TASK_KIND = "topic_interview"
# Short: the course interview already established the brief.
MAX_ROUNDS = 3

ADDITIONS = ("goals", "prior_knowledge", "emphasis", "notes")


def _blank_is_none(text: str | None) -> str | None:
    return (text.strip() or None) if text is not None else None


AdditionText = Annotated[str | None, Field(max_length=2000), AfterValidator(_blank_is_none)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Additions(_Strict):
    """What the topic adds to the brief; a field left out or null stays as it is."""

    goals: AdditionText = Field(None, description="What students should be able to do after it.")
    prior_knowledge: AdditionText = Field(None, description="What students already know of it.")
    emphasis: AdditionText = Field(None, description="What to stress, limit or leave out.")
    notes: AdditionText = None

    def changes(self) -> dict[str, str]:
        return {k: v for k, v in self.model_dump(exclude_unset=True).items() if v is not None}


class AdditionsProposal(_Strict):
    kind: Literal["additions"]
    additions: Additions
    summary: Annotated[str, Field(min_length=1, max_length=2000)]


class Step(_Strict):
    step: Annotated[Round | AdditionsProposal, Field(discriminator="kind")]


class FinalStep(_Strict):
    step: AdditionsProposal


NEXT_STEP = Task(kind=TASK_KIND, output_type=Step, slot="strong")
FINAL_STEP = Task(kind=TASK_KIND, output_type=FinalStep, slot="strong")


def additions_of(topic: Topic) -> dict[str, str | None]:
    return {name: getattr(topic, name) for name in ADDITIONS}


def set_additions(topic: Topic, changes: dict[str, str | None]) -> None:
    for name, value in changes.items():
        assert name in ADDITIONS
        setattr(topic, name, value)


def latest(db: InstanceSession, topic: Topic) -> TopicInterview | None:
    return db.scalars(
        select(TopicInterview)
        .where(TopicInterview.topic_id == topic.id)
        .order_by(TopicInterview.id.desc())
    ).first()


def start(db: InstanceSession, topic: Topic, starter_id: int, *, now: datetime) -> TopicInterview:
    """Raises IntegrityError when another request started an interview meanwhile."""
    interview = TopicInterview(
        course_id=topic.course_id,
        topic_id=topic.id,
        state="active",
        rounds=[],
        started_by_id=starter_id,
        created_at=now,
    )
    savepoint = db.begin_nested()
    db.add(interview)
    try:
        db.flush()
    except IntegrityError:
        savepoint.rollback()
        raise
    savepoint.commit()
    return interview


def topic_inputs(topic: Topic) -> dict[str, Any]:
    """The topic as the assistant reads it: only the additions it has."""
    return {
        "name": topic.name,
        "position": topic.position,
        "additions": {k: v for k, v in additions_of(topic).items() if v is not None},
    }


def _inputs(
    db: InstanceSession, course: Course, topic: Topic, interview: TopicInterview, must_finish: bool
) -> dict[str, Any]:
    return {
        "course": {
            "name": course.name,
            "subject": course.subject,
            "taught_language": course.taught_language,
            "instruction_language": course.instruction_language,
        },
        "brief": courses.brief_of(course).model_dump(mode="json"),
        "topics": [t.name for t in topics_of(db, course)],
        "topic": topic_inputs(topic),
        "transcript": interview.rounds,
        "must_finish": must_finish,
    }


async def next_step(db: InstanceSession, job: Job, ctx: JobContext) -> dict[str, Any]:
    """The job's work: ask the assistant for the next round or the additions, and apply them."""
    interview = db.scalars(select(TopicInterview).where(TopicInterview.job_id == job.id)).first()
    if interview is None:
        # The topic, and with it the interview, was removed before the job ran.
        return {"superseded": True}
    course = courses.get_course(db, interview.course_id)
    topic = db.get_one(Topic, interview.topic_id)
    teacher = accounts.get_account(db, job.account_id)
    assert course is not None and teacher is not None
    answered = sum(1 for r in interview.rounds if r["answers"] is not None)
    must_finish = answered >= MAX_ROUNDS
    output = await generate(
        ctx.assistant,
        db,
        FINAL_STEP if must_finish else NEXT_STEP,
        teacher=teacher,
        inputs=_inputs(db, course, topic, interview, must_finish),
        course_id=course.id,
    )
    # The teacher may have ended the interview, changed the additions or removed the topic while
    # the assistant was thinking: land on fresh rows, and once more if a concurrent change wins.
    for attempt in range(2):
        fresh = db.get(TopicInterview, interview.id, populate_existing=True)
        if fresh is None or fresh.state != "active" or fresh.job_id != job.id:
            return {"superseded": True}
        db.refresh(topic)
        _land(topic, fresh, output.step)
        try:
            db.flush()
            break
        except StaleDataError:
            db.rollback()
            if attempt == 1:
                raise
    return {"interview_id": interview.id, "finished": fresh.state == "finished"}


def _land(topic: Topic, interview: TopicInterview, step: Round | AdditionsProposal) -> None:
    if isinstance(step, Round):
        interview.rounds = [
            *interview.rounds,
            {"questions": [q.model_dump() for q in step.questions], "answers": None},
        ]
    else:
        set_additions(topic, step.additions.changes())
        interview.state = "finished"
        interview.summary = step.summary
