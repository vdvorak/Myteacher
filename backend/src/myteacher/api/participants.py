"""Link runs from the outside (ADR 0012): joining through the join link without signing in, the
participant's personal link, and the lobby its teacher watches fill."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_serializer

from myteacher.accounts.models import Account
from myteacher.api.deps import Db, Now, current_account, ensure, requires
from myteacher.api.runs import CourseRef, RunOut, run_out, taught_run
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
    # The teacher closed joining; those who joined still come back through their personal link.
    closed: bool


class JoiningIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    open: bool


class RenameIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ParticipantName


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
        closed=not run.joining_open,
    )


@router.post(
    "/join", status_code=201, responses={409: {"description": "The run is full, or closed"}}
)
def join(body: JoinIn, db: Db, now: Now) -> Joined:
    """Join the run's lobby under a name, which need not be unique; the answer carries the
    personal link's token."""
    run = _run_to_join(db, body.token)
    if not run.joining_open:
        raise HTTPException(status_code=409, detail="joining_closed")
    joined = participants.join(db, run, body.name, now=now)
    if joined is None:
        raise HTTPException(status_code=409, detail="run_full")
    participant, token = joined
    return Joined(token=token, participant=_participant_out(db, participant))


@router.get("/participant")
def read_participant(db: Db, me: Me) -> ParticipantOut:
    """The participant the personal link belongs to, with their run."""
    return _participant_out(db, me)


def _link_run(db: InstanceSession, actor: Account, run_id: int) -> CourseRun:
    """A link run the actor teaches, or 404."""
    run = taught_run(db, actor, run_id)
    if run.mode != "link":
        raise HTTPException(status_code=404)
    return run


def _lobby_participant(db: InstanceSession, run: CourseRun, found: Participant) -> LobbyParticipant:
    name = participants.display_names(db, run).get(found.id, found.name)
    return LobbyParticipant(id=found.id, name=name, joined_at=found.joined_at)


@router.get("/runs/{run_id}/lobby")
def read_lobby(run_id: int, db: Db, actor: Teacher) -> Lobby:
    """Who is in the link run so far, for its teacher alone; a name typed twice is numbered."""
    run = _link_run(db, actor, run_id)
    assert run.capacity is not None
    named = participants.display_names(db, run)
    return Lobby(
        capacity=run.capacity,
        participants=[
            LobbyParticipant(id=p.id, name=named[p.id], joined_at=p.joined_at)
            for p in participants.participants_of(db, run)
        ],
    )


@router.put("/runs/{run_id}/joining")
def set_joining(run_id: int, body: JoiningIn, db: Db, actor: Teacher) -> RunOut:
    """Close joining once everyone is in, or open it again."""
    run = _link_run(db, actor, run_id)
    run.joining_open = body.open
    return run_out(db, run)


@router.post("/runs/{run_id}/join-link")
def replace_join_link(run_id: int, db: Db, actor: Teacher) -> RunOut:
    """A new join link, in case the old one spread; personal links keep working."""
    run = _link_run(db, actor, run_id)
    participants.replace_join_link(run)
    return run_out(db, run)


def _participant_or_404(db: InstanceSession, run: CourseRun, participant_id: int) -> Participant:
    found = participants.participant_of(db, run, participant_id)
    if found is None:
        raise HTTPException(status_code=404)
    return found


@router.patch("/runs/{run_id}/participants/{participant_id}")
def rename_participant(
    run_id: int, participant_id: int, body: RenameIn, db: Db, actor: Teacher
) -> LobbyParticipant:
    """Rename a participant, for example to tell two of the same name apart."""
    run = _link_run(db, actor, run_id)
    found = _participant_or_404(db, run, participant_id)
    found.name = body.name
    return _lobby_participant(db, run, found)


@router.delete("/runs/{run_id}/participants/{participant_id}", status_code=204)
def remove_participant(
    run_id: int, participant_id: int, db: Db, now: Now, actor: Teacher
) -> Response:
    """Remove a participant: their personal link stops working, and their answers stay here as
    a student's who left the run."""
    run = _link_run(db, actor, run_id)
    participants.remove(_participant_or_404(db, run, participant_id), now=now)
    return Response(status_code=204)
