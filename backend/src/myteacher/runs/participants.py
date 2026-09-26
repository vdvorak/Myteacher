"""Participants of link runs (ADR 0012): people who join through the run's join link by typing
a name, and come back through their personal link."""

import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, insert, literal, select, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from myteacher.accounts.models import Account
from myteacher.accounts.service import token_hash
from myteacher.assistant.generations import GenerationRecord
from myteacher.jobs.models import Job
from myteacher.persistence import InstanceSession
from myteacher.runs.models import (
    Assessment,
    Attempt,
    AttemptDraft,
    CourseRun,
    MaterialRelease,
    Participant,
    ParticipantDevice,
)

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
    db: InstanceSession, run: CourseRun, name: str, *, now: datetime, device: str | None = None
) -> tuple[Participant, str] | None:
    """A new participant of the run with the token of their personal link, open on the device
    they joined on, or None when the run is full. The count and the insert are one statement,
    so two people joining at once never take the last place both."""
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
    if device is not None:
        open_on(db, participant, device, now=now)
    return participant, token


# More devices than this are not counted further, so a link opened over and over with made-up
# devices keeps no more rows; the teacher sees enough to ask.
MAX_DEVICES = 20


def open_on(db: InstanceSession, participant: Participant, device: str, *, now: datetime) -> None:
    """Move the participant's work to the device: from now on only it works on it (ADR 0012).
    The device is counted once, however often the work moves back to it."""
    participant.device = device
    counted = (
        select(func.count())
        .where(ParticipantDevice.participant_id == participant.id)
        .scalar_subquery()
    )
    row = select(
        literal(db.instance_id),
        literal(participant.id),
        literal(device),
        literal(now, ParticipantDevice.first_opened_at.type),
    ).where(counted < MAX_DEVICES)
    columns = ["instance_id", "participant_id", "device", "first_opened_at"]
    db.execute(sqlite_insert(ParticipantDevice).from_select(columns, row).on_conflict_do_nothing())


def works_on(participant: Participant, device: str | None) -> bool:
    """Whether the device may work on the participant's work: the one it was last opened on, or
    any while it was opened on none."""
    return participant.device is None or participant.device == device


def device_counts(db: InstanceSession, run: CourseRun) -> dict[int, int]:
    """How many devices each participant of the run opened their personal link on."""
    rows = db.execute(
        select(ParticipantDevice.participant_id, func.count())
        .join(Participant, Participant.id == ParticipantDevice.participant_id)
        .where(Participant.run_id == run.id)
        .group_by(ParticipantDevice.participant_id)
    )
    return {participant_id: count for participant_id, count in rows}


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


# Names and answers of a link run's participants are kept this long after its last release.
KEPT_FOR = timedelta(days=90)
_ANONYMOUS = {"cs": "Účastník {number}", "en": "Participant {number}"}


def erase(db: InstanceSession, run: CourseRun, *, now: datetime) -> None:
    """Delete what the run's participants gave (ADR 0012): each name becomes "Participant 1"
    in the teacher's language, their personal links stop working, and their answers lose
    anything written, as do the assistant's assessments of them and its generation records.
    Scores stay, so the run's results and counts stay readable. Joining closes for good.

    A teacher who set no language gets English names: the instance has no language of its own
    to fall back to, and the browser's is not known here."""
    if run.participants_erased_at is not None:
        return
    teacher = db.get_one(Account, run.teacher_id)
    anonymous = _ANONYMOUS["cs" if teacher.language == "cs" else "en"]
    everyone = participants_of(db, run, removed_too=True)
    for number, participant in enumerate(everyone, start=1):
        participant.name = anonymous.format(number=number)
        # A hash no token has: the personal link leads nowhere.
        participant.token_hash = f"erased-{participant.id}"
        participant.device = None
    ids = [participant.id for participant in everyone]
    # One browser names itself alike in every run; its traces would tie anonymous rows together.
    db.execute(delete(ParticipantDevice).where(ParticipantDevice.participant_id.in_(ids)))
    attempts = select(Attempt.id).where(Attempt.participant_id.in_(ids))
    db.execute(delete(AttemptDraft).where(AttemptDraft.attempt_id.in_(attempts)))
    for row in db.scalars(select(Assessment).where(Assessment.attempt_id.in_(attempts))):
        row.answer = _unwritten(row.answer)
        row.justification = None
        row.feedback = None
        if row.published is not None:
            row.published = {**row.published, "feedback": None}
    # Every call on their answers, failed ones included, which no assessment points to.
    db.execute(
        update(GenerationRecord)
        .where(GenerationRecord.participant_id.in_(ids))
        .values(inputs={}, output=None, raw_output=None)
        .execution_options(synchronize_session=False)
    )
    # What a failed assessment job kept of the model's answer may quote theirs. A job names only
    # its course and teacher, so those of the run's other runs of the course lose it too.
    db.execute(
        update(Job)
        .where(
            Job.kind == "open_assessment",
            Job.course_id == run.course_id,
            Job.account_id == run.teacher_id,
        )
        .values(raw_output=None)
        .execution_options(synchronize_session=False)
    )
    run.joining_open = False
    run.participants_erased_at = now


def _unwritten(answer: dict) -> dict:
    """The answer without anything written: free text, gaps, cells and a custom exercise's
    value go, the shape stays, so it still validates and the results still show it."""
    blank = dict(answer)
    if "text" in blank:
        blank["text"] = ""
    for key in ("gaps", "cells"):
        if isinstance(blank.get(key), dict):
            blank[key] = dict.fromkeys(blank[key], "")
    if blank.get("type") == "custom":
        blank["value"] = None
    return blank


def due_for_erasure(db: InstanceSession, now: datetime) -> list[CourseRun]:
    """The link runs whose participants' data is kept no longer: 90 days after the last
    release, or after the run started when it released nothing."""
    last = (
        select(MaterialRelease.run_id, func.max(MaterialRelease.released_at).label("at"))
        .group_by(MaterialRelease.run_id)
        .subquery()
    )
    found = db.execute(
        select(CourseRun, last.c.at)
        .outerjoin(last, last.c.run_id == CourseRun.id)
        .where(CourseRun.mode == "link", CourseRun.participants_erased_at.is_(None))
    ).tuples()
    due = []
    for run, released_at in found:
        # The subquery's column is naive in SQLite; the run's own dates are aware.
        since = released_at.replace(tzinfo=UTC) if released_at is not None else run.created_at
        if now - since >= KEPT_FOR:
            due.append(run)
    return due


def sweep(db: InstanceSession, now: datetime) -> int:
    """Erase every link run that is due; returns how many."""
    due = due_for_erasure(db, now)
    for run in due:
        erase(db, run, now=now)
    return len(due)
