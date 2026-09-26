"""Participants of link runs (ADR 0012): people who join through the run's join link by typing
a name, and come back through their personal link."""

import secrets
from datetime import datetime

from sqlalchemy import func, insert, literal, select

from myteacher.accounts.service import token_hash
from myteacher.persistence import InstanceSession
from myteacher.runs.models import CourseRun, Participant

DEFAULT_CAPACITY = 30
MAX_CAPACITY = 200


def new_join_token() -> str:
    return secrets.token_urlsafe(16)


def run_by_join_token(db: InstanceSession, join_token: str) -> CourseRun | None:
    return db.scalars(
        select(CourseRun).where(CourseRun.mode == "link", CourseRun.join_token == join_token)
    ).first()


def participant_by_token(db: InstanceSession, token: str) -> Participant | None:
    return db.scalars(
        select(Participant).where(Participant.token_hash == token_hash(token))
    ).first()


def participants_of(db: InstanceSession, run: CourseRun) -> list[Participant]:
    """In the order they joined."""
    return list(
        db.scalars(
            select(Participant)
            .where(Participant.run_id == run.id)
            .order_by(Participant.joined_at, Participant.id)
        )
    )


def count(db: InstanceSession, run: CourseRun) -> int:
    return db.scalar(select(func.count()).where(Participant.run_id == run.id)) or 0


def join(
    db: InstanceSession, run: CourseRun, name: str, *, now: datetime
) -> tuple[Participant, str] | None:
    """A new participant of the run with the token of their personal link, or None when the run
    is full. The count and the insert are one statement, so two people joining at once never
    take the last place both."""
    assert run.capacity is not None, "only a link run takes participants"
    token = secrets.token_urlsafe(32)
    taken = select(func.count()).where(Participant.run_id == run.id).scalar_subquery()
    row = select(
        literal(db.instance_id),
        literal(run.id),
        literal(name),
        literal(token_hash(token)),
        literal(now, Participant.joined_at.type),
    ).where(taken < run.capacity)
    columns = ["instance_id", "run_id", "name", "token_hash", "joined_at"]
    inserted = db.execute(insert(Participant).from_select(columns, row))
    if inserted.rowcount == 0:
        return None
    participant = participant_by_token(db, token)
    assert participant is not None
    return participant, token
