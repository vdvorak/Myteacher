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
    """The participant the personal link belongs to, unless the teacher removed them."""
    return db.scalars(
        select(Participant).where(
            Participant.token_hash == token_hash(token), Participant.removed_at.is_(None)
        )
    ).first()


def participant_of(db: InstanceSession, run: CourseRun, participant_id: int) -> Participant | None:
    """A participant still in the run."""
    return db.scalars(
        select(Participant).where(
            Participant.id == participant_id,
            Participant.run_id == run.id,
            Participant.removed_at.is_(None),
        )
    ).first()


def participants_of(
    db: InstanceSession, run: CourseRun, *, removed_too: bool = False
) -> list[Participant]:
    """Those in the run, or also those the teacher removed, in the order they joined."""
    found = select(Participant).where(Participant.run_id == run.id)
    if not removed_too:
        found = found.where(Participant.removed_at.is_(None))
    return list(db.scalars(found.order_by(Participant.joined_at, Participant.id)))


def _in_run(run: CourseRun):
    return (Participant.run_id == run.id, Participant.removed_at.is_(None))


def count(db: InstanceSession, run: CourseRun) -> int:
    """How many are in the run; a removed participant frees their place."""
    return db.scalar(select(func.count()).where(*_in_run(run))) or 0


def replace_join_link(run: CourseRun) -> None:
    """The old join link stops working for newcomers; personal links keep working."""
    run.join_token = new_join_token()


def remove(participant: Participant, *, now: datetime) -> None:
    participant.removed_at = now


def join(
    db: InstanceSession, run: CourseRun, name: str, *, now: datetime
) -> tuple[Participant, str] | None:
    """A new participant of the run with the token of their personal link, or None when the run
    is full. The count and the insert are one statement, so two people joining at once never
    take the last place both."""
    assert run.capacity is not None, "only a link run takes participants"
    token = secrets.token_urlsafe(32)
    taken = select(func.count()).where(*_in_run(run)).scalar_subquery()
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


def display_names(db: InstanceSession, run: CourseRun) -> dict[int, str]:
    """Each participant's name as the teacher sees it: a name typed by more than one participant
    in the run is numbered in the order they joined, "Jan Novák (2)". A removed participant keeps
    the name they typed, as results mark them as no longer in the run, and does not number those
    who stay."""
    found = participants_of(db, run)
    named = {p.id: p.name for p in participants_of(db, run, removed_too=True)}
    counts: dict[str, int] = {}
    for participant in found:
        counts[participant.name] = counts.get(participant.name, 0) + 1
    seen: dict[str, int] = {}
    for participant in found:
        if counts[participant.name] == 1:
            named[participant.id] = participant.name
            continue
        seen[participant.name] = seen.get(participant.name, 0) + 1
        named[participant.id] = f"{participant.name} ({seen[participant.name]})"
    return named
