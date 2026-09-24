"""Topics of a course, read by anyone who may see the course and changed by its editors.

Every change answers with the whole ordered list, so the client never guesses an order."""

from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator

from myteacher.accounts.models import Account
from myteacher.api.courses import course_for, editable_course
from myteacher.api.deps import Db, Now, requires
from myteacher.courses import topics
from myteacher.courses.models import Course, Topic
from myteacher.persistence import InstanceSession
from myteacher.policy import is_teacher

router = APIRouter(prefix="/courses/{course_id}/topics", tags=["topics"])
Teacher = Annotated[Account, requires(is_teacher)]

TopicName = Annotated[str, AfterValidator(str.strip), Field(min_length=1, max_length=200)]


class TopicOut(BaseModel):
    id: int
    name: str
    position: int
    diagnostic_wanted: bool


class TopicIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: TopicName


class TopicChange(BaseModel):
    """Only the fields present change; none of them can be unset."""

    model_config = ConfigDict(extra="forbid")

    name: TopicName | None = None
    diagnostic_wanted: bool | None = None

    @field_validator("name", "diagnostic_wanted")
    @classmethod
    def _cannot_be_unset(cls, value: object) -> object:
        # Validators skip defaults, so this only refuses an explicit null.
        if value is None:
            raise ValueError("can be changed but not unset")
        return value


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
    for field in body.model_fields_set:
        setattr(topic, field, getattr(body, field))
    return _listed(db, course)


@router.delete("/{topic_id}")
def remove_topic(course_id: int, topic_id: int, db: Db, actor: Teacher) -> list[TopicOut]:
    course = editable_course(db, actor, course_id)
    topics.remove_topic(db, course, _topic(db, course, topic_id))
    return _listed(db, course)
