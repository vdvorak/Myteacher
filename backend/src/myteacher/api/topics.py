"""Topics of a course, read by anyone who may see the course and changed by its editors.

Every change answers with the whole ordered list, so the client never guesses an order."""

from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator

from myteacher.accounts.models import Account
from myteacher.api.courses import course_for, editable_course
from myteacher.api.deps import Db, Now, requires
from myteacher.courses import topic_interview, topics
from myteacher.courses.models import Course, Topic
from myteacher.courses.topic_interview import AdditionText
from myteacher.persistence import InstanceSession
from myteacher.policy import is_teacher

router = APIRouter(prefix="/courses/{course_id}/topics", tags=["topics"])
Teacher = Annotated[Account, requires(is_teacher)]

TopicName = Annotated[str, AfterValidator(str.strip), Field(min_length=1, max_length=200)]


class AdditionsOut(BaseModel):
    goals: str | None
    prior_knowledge: str | None
    emphasis: str | None
    notes: str | None


class DiagnosticOfferOut(BaseModel):
    # Why the assistant offers a diagnostic lesson for the topic.
    reason: str
    # "accepted" or "declined"; None while the offer waits for the teacher.
    answer: str | None


class TopicOut(BaseModel):
    id: int
    name: str
    position: int
    diagnostic_wanted: bool
    # What the topic adds to the course brief.
    additions: AdditionsOut
    diagnostic_offer: DiagnosticOfferOut | None


class TopicIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: TopicName


class AdditionsChange(BaseModel):
    """Only the fields present change; null or blank clears one."""

    model_config = ConfigDict(extra="forbid")

    goals: AdditionText = None
    prior_knowledge: AdditionText = None
    emphasis: AdditionText = None
    notes: AdditionText = None


class TopicChange(BaseModel):
    """Only the fields present change; none of them can be unset."""

    model_config = ConfigDict(extra="forbid")

    name: TopicName | None = None
    diagnostic_wanted: bool | None = None
    additions: AdditionsChange | None = None

    @field_validator("name", "diagnostic_wanted", "additions")
    @classmethod
    def _cannot_be_unset(cls, value: object) -> object:
        # Validators skip defaults, so this only refuses an explicit null.
        if value is None:
            raise ValueError("can be changed but not unset")
        return value


class OfferAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accept: bool


class TopicOrder(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Every topic of the course, each once, in the new order.
    topic_ids: list[int]


def _listed(db: InstanceSession, course: Course) -> list[TopicOut]:
    return [
        TopicOut(
            id=topic.id,
            name=topic.name,
            position=topic.position,
            diagnostic_wanted=topic.diagnostic_wanted,
            additions=AdditionsOut(**topic_interview.additions_of(topic)),
            diagnostic_offer=DiagnosticOfferOut(
                reason=topic.diagnostic_offer, answer=topic.diagnostic_offer_answer
            )
            if topic.diagnostic_offer
            else None,
        )
        for topic in topics.topics_of(db, course)
    ]


def _topic(db: InstanceSession, course: Course, topic_id: int) -> Topic:
    topic = topics.get_topic(db, course, topic_id)
    if topic is None:
        raise HTTPException(status_code=404)
    return topic


@router.get("")
def list_topics(course_id: int, db: Db, actor: Teacher) -> list[TopicOut]:
    return _listed(db, course_for(db, actor, course_id))


@router.post("", status_code=201)
def add_topic(course_id: int, body: TopicIn, db: Db, now: Now, actor: Teacher) -> list[TopicOut]:
    """Add a topic at the end of the course."""
    course = editable_course(db, actor, course_id)
    topics.add_topic(db, course, body.name, now=now)
    return _listed(db, course)


@router.put("/order", responses={409: {"description": "Not every topic, each once"}})
def reorder_topics(course_id: int, body: TopicOrder, db: Db, actor: Teacher) -> list[TopicOut]:
    course = editable_course(db, actor, course_id)
    try:
        topics.reorder(db, course, body.topic_ids)
    except topics.OrderMismatch:
        # Typically a client that has not seen a topic added or removed meanwhile.
        raise HTTPException(status_code=409, detail="order_mismatch") from None
    return _listed(db, course)


@router.patch("/{topic_id}")
def change_topic(
    course_id: int, topic_id: int, body: TopicChange, db: Db, actor: Teacher
) -> list[TopicOut]:
    course = editable_course(db, actor, course_id)
    topic = _topic(db, course, topic_id)
    for field in body.model_fields_set - {"additions"}:
        setattr(topic, field, getattr(body, field))
    if "diagnostic_wanted" in body.model_fields_set:
        topics.settle_offer(topic)
    if body.additions is not None:
        additions = body.additions
        topic_interview.set_additions(
            topic, {field: getattr(additions, field) for field in additions.model_fields_set}
        )
    return _listed(db, course)


@router.post("/{topic_id}/diagnostic-offer", responses={409: {"description": "No open offer"}})
def answer_diagnostic_offer(
    course_id: int, topic_id: int, body: OfferAnswer, db: Db, actor: Teacher
) -> list[TopicOut]:
    """Accept the assistant's offer of a diagnostic lesson, which sets the topic's flag, or
    decline it, which leaves the flag as it is."""
    course = editable_course(db, actor, course_id)
    topic = _topic(db, course, topic_id)
    if topic.diagnostic_offer is None or topic.diagnostic_offer_answer is not None:
        raise HTTPException(status_code=409, detail="no_open_offer")
    topic.diagnostic_offer_answer = "accepted" if body.accept else "declined"
    if body.accept:
        topic.diagnostic_wanted = True
    return _listed(db, course)


@router.delete("/{topic_id}")
def remove_topic(course_id: int, topic_id: int, db: Db, actor: Teacher) -> list[TopicOut]:
    course = editable_course(db, actor, course_id)
    topics.remove_topic(db, course, _topic(db, course, topic_id))
    return _listed(db, course)
