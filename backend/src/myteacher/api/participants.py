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
# The header naming the device a participant's request comes from: an identifier the browser
# made up, as their work is open on one device at a time.
DEVICE_HEADER = "X-Participant-Device"

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


class Named(BaseModel):
    id: int
    name: str
    joined_at: datetime

    @field_serializer("joined_at")
    def _joined(self, at: datetime) -> str:
        return _utc(at)


class LobbyParticipant(Named):
    # How many devices they opened their personal link on; more than one may be a link passed on.
    devices: int


class Lobby(BaseModel):
    capacity: int
    # In the order they joined.
    participants: list[LobbyParticipant]


class ParticipantOut(Named):
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


Device = Annotated[str | None, Header(alias=DEVICE_HEADER, min_length=1, max_length=64)]


def participant_by_link(
    db: Db, token: Annotated[str | None, Header(alias=PARTICIPANT_HEADER)] = None
) -> Participant:
    """The participant by their personal link, on whichever device."""
    participant = participants.participant_by_token(db, token) if token else None
    if participant is None:
        raise HTTPException(status_code=401, detail="unknown_participant")
    return participant


def current_participant(db: Db, token: str | None, device: str | None) -> Participant:
    """The participant by their personal link, on the device their work is open on; another
    device is refused, so what it did not save yet does not overwrite newer work."""
    participant = participant_by_link(db, token)
    if not participants.works_on(participant, device):
        raise HTTPException(status_code=409, detail="other_device")
    return participant


# Who the personal link belongs to, for any device: it tells the device it was opened on
# before whose work moved away.
Me = Annotated[Participant, Depends(participant_by_link)]


def current_learner(
    request: Request,
    db: Db,
    now: Now,
    token: Annotated[str | None, Header(alias=PARTICIPANT_HEADER)] = None,
    device: Device = None,
) -> Learner:
    """Whoever works on releases: a participant by the token of their personal link, else the
    signed-in student."""
    if token is not None:
        return current_participant(db, token, device)
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
def join(body: JoinIn, db: Db, now: Now, device: Device = None) -> Joined:
    """Join the run's lobby under a name, which need not be unique; the answer carries the
    personal link's token, open on the device that joined."""
    run = _run_to_join(db, body.token)
    if not run.joining_open:
        raise HTTPException(status_code=409, detail="joining_closed")
    joined = participants.join(db, run, body.name, now=now, device=device)
    if joined is None:
        raise HTTPException(status_code=409, detail="run_full")
    participant, token = joined
    return Joined(token=token, participant=_participant_out(db, participant))


@router.get("/participant")
def read_participant(db: Db, me: Me) -> ParticipantOut:
    """The participant the personal link belongs to, with their run, on any device; opening
    the link moves the work to a device."""
    return _participant_out(db, me)


@router.post("/participant/open")
def open_personal_link(
    db: Db,
    now: Now,
    device: Annotated[str, Header(alias=DEVICE_HEADER, min_length=1, max_length=64)],
    token: Annotated[str | None, Header(alias=PARTICIPANT_HEADER)] = None,
) -> ParticipantOut:
    """Open the personal link on this device: the participant's work moves here, and the
    device it was open on before is refused from its next request."""
    participant = participant_by_link(db, token)
    participants.open_on(db, participant, device, now=now)
    return _participant_out(db, participant)


def _link_run(db: InstanceSession, actor: Account, run_id: int) -> CourseRun:
    """A link run the actor teaches, or 404."""
    run = taught_run(db, actor, run_id)
    if run.mode != "link":
        raise HTTPException(status_code=404)
    return run


def _lobby_participant(db: InstanceSession, run: CourseRun, found: Participant) -> LobbyParticipant:
    name = participants.display_names(db, run).get(found.id, found.name)
    devices = participants.device_counts(db, run).get(found.id, 0)
    return LobbyParticipant(id=found.id, name=name, joined_at=found.joined_at, devices=devices)


@router.get("/runs/{run_id}/lobby")
def read_lobby(run_id: int, db: Db, actor: Teacher) -> Lobby:
    """Who is in the link run so far, for its teacher alone; a name typed twice is numbered."""
    run = _link_run(db, actor, run_id)
    assert run.capacity is not None
    named = participants.display_names(db, run)
    devices = participants.device_counts(db, run)
    return Lobby(
        capacity=run.capacity,
        participants=[
            LobbyParticipant(
                id=p.id, name=named[p.id], joined_at=p.joined_at, devices=devices.get(p.id, 0)
            )
            for p in participants.participants_of(db, run)
        ],
    )


@router.delete("/runs/{run_id}/participant-data")
def erase_participant_data(run_id: int, db: Db, now: Now, actor: Teacher) -> RunOut:
    """Delete the participants' names and answers now, rather than 90 days after the last
    release; the run, its releases and its results stay, with anonymous rows."""
    run = _link_run(db, actor, run_id)
    participants.erase(db, run, now=now)
    return run_out(db, run)


@router.put("/runs/{run_id}/joining")
def set_joining(run_id: int, body: JoiningIn, db: Db, actor: Teacher) -> RunOut:
    """Close joining once everyone is in, or open it again."""
    run = _link_run(db, actor, run_id)
    if body.open and run.participants_erased_at is not None:
        # Newcomers' data would outlive the erasure, which is not done twice.
        raise HTTPException(status_code=409, detail="participants_erased")
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
