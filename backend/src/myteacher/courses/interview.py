"""The teacher interview: rounds of numbered questions with recommended answers, then a patch
to the course brief. Each step is one assistant call, run as a job."""

from datetime import datetime
from typing import Annotated, Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import StaleDataError

from myteacher.accounts import service as accounts
from myteacher.assistant.service import Task, generate
from myteacher.courses import service as courses
from myteacher.courses.brief import BriefText, ExerciseTypes
from myteacher.courses.models import Course, Interview, TopicInterview
from myteacher.jobs.models import Job
from myteacher.jobs.runner import JobContext
from myteacher.lesson.schema import FeedbackMode
from myteacher.persistence import InstanceSession

TASK_KIND = "course_interview"
# After this many answered rounds the assistant must return the brief.
MAX_ROUNDS = 6

Text = Annotated[str, Field(min_length=1, max_length=1000)]


class NoOpenRound(Exception):
    pass


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Question(_Strict):
    question: Text
    recommended_answer: Text


class Round(_Strict):
    kind: Literal["round"]
    questions: Annotated[list[Question], Field(min_length=1, max_length=7)]


class BriefPatch(_Strict):
    """The fields the interview established; the ones left out stay as they are."""

    audience: BriefText = None
    level: BriefText = None
    goals: BriefText = None
    timeframe: BriefText = None
    preferred_exercise_types: ExerciseTypes | None = None
    forbidden_exercise_types: ExerciseTypes | None = None
    tone: BriefText = None
    feedback_mode: FeedbackMode | None = None
    retry_with_hint: bool | None = None
    second_round: bool | None = None
    notes: BriefText = None

    @model_validator(mode="after")
    def _no_type_both(self) -> Self:
        both = set(self.preferred_exercise_types or []) & set(self.forbidden_exercise_types or [])
        if both:
            raise ValueError(f"types both preferred and forbidden: {sorted(both)}")
        return self

    def changes(self) -> dict[str, Any]:
        # A field set to null by the model means "not established", not "clear it".
        return {k: v for k, v in self.model_dump(exclude_unset=True).items() if v is not None}


class BriefProposal(_Strict):
    kind: Literal["brief"]
    brief: BriefPatch
    # False when the teacher named no sources: content will then be generated unsourced.
    sources_offered: bool
    summary: Annotated[str, Field(min_length=1, max_length=2000)]


class Step(_Strict):
    step: Annotated[Round | BriefProposal, Field(discriminator="kind")]


class FinalStep(_Strict):
    """What the assistant may return once the interview has to finish."""

    step: BriefProposal


NEXT_STEP = Task(kind=TASK_KIND, output_type=Step, slot="strong")
FINAL_STEP = Task(kind=TASK_KIND, output_type=FinalStep, slot="strong")


def latest(db: InstanceSession, course: Course) -> Interview | None:
    return db.scalars(
        select(Interview).where(Interview.course_id == course.id).order_by(Interview.id.desc())
    ).first()


# The course interview and a topic interview run their rounds alike.
AnyInterview = Interview | TopicInterview


def open_round(interview: AnyInterview) -> dict[str, Any] | None:
    """The last round when it still waits for answers."""
    if interview.state != "active" or not interview.rounds:
        return None
    last = interview.rounds[-1]
    return last if last["answers"] is None else None


def start(db: InstanceSession, course: Course, starter_id: int, *, now: datetime) -> Interview:
    """Raises IntegrityError when another request started an interview meanwhile."""
    interview = Interview(
        course_id=course.id, state="active", rounds=[], started_by_id=starter_id, created_at=now
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


def record_answers(interview: AnyInterview, answers: list[str]) -> None:
    current = open_round(interview)
    if current is None:
        raise NoOpenRound()
    if len(answers) != len(current["questions"]):
        raise ValueError("one answer per question")
    # Assign a new list: the JSON column does not track changes inside it.
    interview.rounds = [*interview.rounds[:-1], {**current, "answers": answers}]


def end(interview: AnyInterview) -> None:
    interview.state = "ended"


def _inputs(course: Course, interview: Interview, must_finish: bool) -> dict[str, Any]:
    return {
        "course": {
            "name": course.name,
            "subject": course.subject,
            "taught_language": course.taught_language,
            "instruction_language": course.instruction_language,
        },
        "brief": courses.brief_of(course).model_dump(mode="json"),
        "transcript": interview.rounds,
        "must_finish": must_finish,
    }


def _apply(course: Course, patch: BriefPatch) -> None:
    changes = patch.changes()
    brief = courses.brief_of(course)
    # A type list from the interview wins: its types leave the other list.
    for chosen, other in (
        ("preferred_exercise_types", "forbidden_exercise_types"),
        ("forbidden_exercise_types", "preferred_exercise_types"),
    ):
        if chosen in changes and other not in changes:
            kept = [t for t in getattr(brief, other) if t not in changes[chosen]]
            if kept != getattr(brief, other):
                changes[other] = kept
    courses.change_brief(course, changes)


async def next_step(db: InstanceSession, job: Job, ctx: JobContext) -> dict[str, Any]:
    """The job's work: ask the assistant for the next round or the brief, and apply it."""
    interview = db.scalars(select(Interview).where(Interview.job_id == job.id)).one()
    course = courses.get_course(db, interview.course_id)
    teacher = accounts.get_account(db, job.account_id)
    assert course is not None and teacher is not None
    answered = sum(1 for r in interview.rounds if r["answers"] is not None)
    must_finish = answered >= MAX_ROUNDS
    output = await generate(
        ctx.assistant,
        db,
        FINAL_STEP if must_finish else NEXT_STEP,
        teacher=teacher,
        inputs=_inputs(course, interview, must_finish),
        course_id=course.id,
    )
    # The teacher may have changed the brief or ended the interview while the assistant was
    # thinking, and may do so again while this lands: apply to fresh rows, and once more if a
    # concurrent change wins the race.
    for attempt in range(2):
        db.refresh(interview)
        db.refresh(course.brief)
        if interview.state != "active":
            # Ended meanwhile: the answer is not used.
            return {"interview_id": interview.id}
        _land(course, interview, output.step)
        try:
            db.flush()
            break
        except StaleDataError:
            db.rollback()
            if attempt == 1:
                raise
    return {"interview_id": interview.id}


def _land(course: Course, interview: Interview, step: Round | BriefProposal) -> None:
    if isinstance(step, Round):
        interview.rounds = [
            *interview.rounds,
            {"questions": [q.model_dump() for q in step.questions], "answers": None},
        ]
    else:
        _apply(course, step.brief)
        interview.state = "finished"
        interview.sources_offered = step.sources_offered
        interview.summary = step.summary
