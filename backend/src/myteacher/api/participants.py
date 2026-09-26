"""Link runs from the outside (ADR 0012): joining through the join link without signing in, the
participant's personal link, and the lobby its teacher watches fill."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_serializer

from myteacher.accounts.models import Account
from myteacher.api.deps import Db, Now, current_account, ensure, requires
from myteacher.api.runs import CourseRef, taught_run
from myteacher.courses.models import Course
from myteacher.persistence import InstanceSession
from myteacher.policy import is_student, is_teacher
from myteacher.runs import participants
from myteacher.runs.learners import Learner
from myteacher.runs.models import CourseRun, Participant

router = APIRouter(tags=["link runs"])
Teacher = Annotated[Account, requires(is_teacher)]
# The header a participant's requests carry the token of their personal link in.
PARTICIPANT_HEADER = "X-Participant-Token"

ParticipantName = Annotated[str, AfterValidator(str.strip), Field(min_length=1, max_length=60)]


def _utc(at: datetime) -> str:
    return at.strftime("%Y-%m-%dT%H:%M:%SZ")


class JoinTokenIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str


class JoinIn(JoinTokenIn):
    name: ParticipantName


class JoinCheck(BaseModel):
    # So the browser finds a personal link it remembers for the run, whatever its join link.
    run_id: int
    run: str
    course: str
    full: bool


class LobbyParticipant(BaseModel):
    id: int
    name: str
    joined_at: datetime

    @field_serializer("joined_at")
    def _joined(self, at: datetime) -> str:
        return _utc(at)


class Lobby(BaseModel):
    capacity: int
    # In the order they joined.
    participants: list[LobbyParticipant]


class ParticipantOut(LobbyParticipant):
    run_id: int
    run: str
    course: CourseRef


class Joined(BaseModel):
    # The secret of the personal link; it is never shown again.
    token: str
    participant: ParticipantOut


def _run_to_join(db: InstanceSession, token: str) -> CourseRun:
    run = participants.run_by_join_token(db, token)
    if run is None:
        raise HTTPException(status_code=404, detail="unknown_link")
    return run


def _participant_out(db: InstanceSession, participant: Participant) -> ParticipantOut:
    run = db.get_one(CourseRun, participant.run_id)
    course = db.get_one(Course, run.course_id)
    return ParticipantOut(
        id=participant.id,
        name=participant.name,
        joined_at=participant.joined_at,
        run_id=run.id,
        run=run.name,
        course=CourseRef(id=course.id, name=course.name),
    )


def current_participant(
    db: Db, token: Annotated[str | None, Header(alias=PARTICIPANT_HEADER)] = None
) -> Participant:
    participant = participants.participant_by_token(db, token) if token else None
    if participant is None:
        raise HTTPException(status_code=401, detail="unknown_participant")
    return participant


Me = Annotated[Participant, Depends(current_participant)]


def current_learner(
    request: Request,
    db: Db,
    now: Now,
    token: Annotated[str | None, Header(alias=PARTICIPANT_HEADER)] = None,
) -> Learner:
    """Whoever works on releases: a participant by the token of their personal link, else the
    signed-in student."""
    if token is not None:
        return current_participant(db, token)
    actor = current_account(request, db, now)
    ensure(is_student(actor))
    return actor


LearnerActor = Annotated[Learner, Depends(current_learner)]


@router.post("/join/check")
def check_join_link(body: JoinTokenIn, db: Db) -> JoinCheck:
    """What the join link leads to, before anyone types a name."""
    run = _run_to_join(db, body.token)
    course = db.get_one(Course, run.course_id)
    assert run.capacity is not None
    return JoinCheck(
        run_id=run.id,
        run=run.name,
        course=course.name,
        full=participants.count(db, run) >= run.capacity,
    )


@router.post("/join", status_code=201, responses={409: {"description": "The run is full"}})
def join(body: JoinIn, db: Db, now: Now) -> Joined:
    """Join the run's lobby under a name, which need not be unique; the answer carries the
    personal link's token."""
    run = _run_to_join(db, body.token)
    joined = participants.join(db, run, body.name, now=now)
    if joined is None:
        raise HTTPException(status_code=409, detail="run_full")
    participant, token = joined
    return Joined(token=token, participant=_participant_out(db, participant))


@router.get("/participant")
def read_participant(db: Db, me: Me) -> ParticipantOut:
    """The participant the personal link belongs to, with their run."""
    return _participant_out(db, me)


@router.get("/runs/{run_id}/lobby")
def read_lobby(run_id: int, db: Db, actor: Teacher) -> Lobby:
    """Who joined the link run so far, for its teacher alone."""
    run = taught_run(db, actor, run_id)
    if run.capacity is None:
        raise HTTPException(status_code=404)
    return Lobby(
        capacity=run.capacity,
        participants=[
            LobbyParticipant(id=p.id, name=p.name, joined_at=p.joined_at)
            for p in participants.participants_of(db, run)
        ],
    )
