"""The ordered topics of a course. Positions are kept 0-based and without gaps."""

from datetime import datetime

from sqlalchemy import func, select

from myteacher.courses.models import (
    ClassroomMaterial,
    Concept,
    ConceptMap,
    Course,
    ReferenceDocument,
    Topic,
)
from myteacher.persistence import InstanceSession


class OrderMismatch(Exception):
    """The new order does not name every topic of the course exactly once."""


def progress_of(db: InstanceSession, course: Course) -> dict[int, tuple[str, int, int]]:
    """How far each topic's preparation got: its concept map ("none", "draft" or "approved"),
    and how many reference documents and classroom materials it holds."""
    ids = select(Topic.id).where(Topic.course_id == course.id)
    current = (
        select(func.count())
        .where(Concept.concept_map_id == ConceptMap.id, Concept.retired_at.is_(None))
        .scalar_subquery()
    )
    held_maps = select(ConceptMap.topic_id, ConceptMap.state, current).where(
        ConceptMap.topic_id.in_(ids)
    )
    # A map with no concepts yet, say while the first proposal runs, is no map to approve.
    maps = {topic_id: state for topic_id, state, concepts in db.execute(held_maps) if concepts}

    def counts(model: type[ReferenceDocument] | type[ClassroomMaterial]) -> dict[int, int]:
        held = (
            select(model.topic_id, func.count())
            .where(model.topic_id.in_(ids), model.discarded_at.is_(None))
            .group_by(model.topic_id)
        )
        return {topic_id: count for topic_id, count in db.execute(held)}

    documents, materials = counts(ReferenceDocument), counts(ClassroomMaterial)
    return {
        topic_id: (
            maps.get(topic_id, "none"),
            documents.get(topic_id, 0),
            materials.get(topic_id, 0),
        )
        for topic_id in db.scalars(ids)
    }


def topics_of(db: InstanceSession, course: Course) -> list[Topic]:
    return list(
        db.scalars(
            select(Topic).where(Topic.course_id == course.id).order_by(Topic.position, Topic.id)
        )
    )


def get_topic(db: InstanceSession, course: Course, topic_id: int) -> Topic | None:
    return db.scalars(
        select(Topic).where(Topic.id == topic_id, Topic.course_id == course.id)
    ).first()


def add_topic(db: InstanceSession, course: Course, name: str, *, now: datetime) -> Topic:
    last = db.scalar(select(func.max(Topic.position)).where(Topic.course_id == course.id))
    topic = Topic(
        course_id=course.id,
        name=name,
        position=0 if last is None else last + 1,
        created_at=now,
    )
    db.add(topic)
    db.flush()
    return topic


def _renumber(topics: list[Topic]) -> None:
    for position, topic in enumerate(topics):
        topic.position = position


def reorder(db: InstanceSession, course: Course, topic_ids: list[int]) -> None:
    current = {topic.id: topic for topic in topics_of(db, course)}
    if len(topic_ids) != len(current) or set(topic_ids) != set(current):
        raise OrderMismatch()
    _renumber([current[topic_id] for topic_id in topic_ids])


def remove_topic(db: InstanceSession, course: Course, topic: Topic) -> None:
    db.delete(topic)
    db.flush()
    _renumber(topics_of(db, course))


def settle_offer(topic: Topic) -> None:
    """After the teacher set the diagnostic flag by hand, the assistant's offer says what the flag
    says: ticking it accepts an open offer, and an answered offer follows the flag."""
    if topic.diagnostic_offer is None:
        return
    if topic.diagnostic_wanted or topic.diagnostic_offer_answer is not None:
        topic.diagnostic_offer_answer = "accepted" if topic.diagnostic_wanted else "declined"
