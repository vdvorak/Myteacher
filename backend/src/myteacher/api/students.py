"""Students, maintained by any teacher on the instance: students belong to it, not to a teacher."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Request
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_serializer, field_validator

from myteacher.accounts import consent, invitations, service
from myteacher.accounts.consent import StudentState
from myteacher.accounts.models import Account, GuardianConsent
from myteacher.api.deps import AppSettings, Db, MailSender, Now, requires
from myteacher.api.invite import InvitationResult, ensure_invitable, send_invitation
from myteacher.mail.templates import Language
from myteacher.persistence import InstanceSession
from myteacher.policy import is_teacher

router = APIRouter(prefix="/students", tags=["students"])
Teacher = Annotated[Account, requires(is_teacher)]

Email = Annotated[str, AfterValidator(service.check_email)]
Name = Annotated[str, AfterValidator(str.strip), Field(min_length=1, max_length=200)]


class ConsentOut(BaseModel):
    attested_by_id: int
    attested_by_email: str
    recorded_at: datetime
    note: str | None

    @field_serializer("recorded_at")
    def _utc(self, at: datetime) -> str:
        return at.strftime("%Y-%m-%dT%H:%M:%SZ")


class StudentOut(BaseModel):
    id: int
    name: str
    email: str
    language: Language | None
    minor: bool
    # The latest guardian consent recorded; None when there is none.
    consent: ConsentOut | None
    state: StudentState

    @classmethod
    def of(
        cls, db: InstanceSession, student: Account, recorded: GuardianConsent | None
    ) -> "StudentOut":
        attester = service.get_account(db, recorded.attested_by_id) if recorded else None
        return cls(
            id=student.id,
            name=student.name or "",
            email=student.email,
            language=student.language,  # type: ignore[arg-type]
            minor=student.is_minor,
            consent=ConsentOut(
                attested_by_id=recorded.attested_by_id,
                attested_by_email=attester.email if attester else "",
                recorded_at=recorded.recorded_at,
                note=recorded.note,
            )
            if recorded
            else None,
            state=consent.student_state(student, recorded),
        )


def _out(db: InstanceSession, student: Account) -> StudentOut:
    return StudentOut.of(db, student, consent.latest_consent(db, student))


class NewStudent(BaseModel):
    name: Name
    email: Email
    language: Language
    # A minor starts inactive and uninvited until a guardian's consent is recorded.
    minor: bool = False


class CreatedStudent(StudentOut, InvitationResult):
    pass


class StudentChange(BaseModel):
    """Only the fields present change; none of them can be unset."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    email: Email | None = None
    language: Language | None = None
    minor: bool | None = None
    active: bool | None = None

    @field_validator("name", "email", "language", "minor", "active")
    @classmethod
    def _cannot_be_unset(cls, value: object) -> object:
        # Validators skip defaults, so this only refuses an explicit null.
        if value is None:
            raise ValueError("can be changed but not unset")
        return value


class ConsentIn(BaseModel):
    """The teacher attests the consent by recording it; the note says where it is kept."""

    model_config = ConfigDict(extra="forbid")

    note: Annotated[str, AfterValidator(str.strip), Field(max_length=1000)] | None = None


def _student(db: InstanceSession, student_id: int) -> Account:
    student = service.get_account(db, student_id)
    if student is None or student.kind != "student":
        raise HTTPException(status_code=404)
    return student


def _not_accepted(student: Account) -> None:
    if student.password_hash is not None:
        raise HTTPException(status_code=409, detail="already_accepted")


def _revoke(db: InstanceSession, student: Account, *, now: datetime, actor: Account) -> None:
    if invitations.revoke_open(db, student, now=now):
        service.record_event(db, "invitation_revoked", at=now, actor=actor, subject=student)


@router.get("")
def list_students(db: Db, _: Teacher) -> list[StudentOut]:
    """Every student on the instance, by name."""
    consents = consent.latest_consents(db)
    return [StudentOut.of(db, s, consents.get(s.id)) for s in service.list_students(db)]


@router.post("", status_code=201, responses={409: {"description": "Email taken"}})
def create_student(
    body: NewStudent,
    request: Request,
    db: Db,
    sender: MailSender,
    settings: AppSettings,
    now: Now,
    teacher: Teacher,
) -> CreatedStudent:
    """Create a student account and email the invitation to set a password.

    A minor gets no invitation until consent is recorded and the account activated.
    """
    try:
        student = service.create_invited_account(
            db,
            email=body.email,
            kind="student",
            name=body.name,
            language=body.language,
            now=now,
            actor=teacher,
        )
    except service.EmailTaken:
        raise HTTPException(status_code=409, detail="email_taken") from None
    if body.minor:
        consent.mark_new_minor(db, student, actor=teacher, now=now)
        result = InvitationResult(invitation_sent=False, error=None)
    else:
        result = send_invitation(db, sender, student, request, settings, now, teacher)
    return CreatedStudent(**_out(db, student).model_dump(), **result.model_dump())


@router.get("/{student_id}")
def read_student(student_id: int, db: Db, _: Teacher) -> StudentOut:
    return _out(db, _student(db, student_id))


@router.patch(
    "/{student_id}",
    responses={409: {"description": "Email taken, or activating a minor without consent"}},
)
def change_student(
    student_id: int, change: StudentChange, db: Db, now: Now, teacher: Teacher
) -> StudentOut:
    """Edit the student's basics, mark a minor, or deactivate or reactivate; history stays.

    Marking an active student as a minor without consent deactivates them until it is recorded.
    """
    student = _student(db, student_id)
    previous_email = student.email
    try:
        service.change_basics(
            db,
            student,
            actor=teacher,
            now=now,
            name=change.name,
            email=change.email,
            language=change.language,
        )
    except service.EmailTaken:
        raise HTTPException(status_code=409, detail="email_taken") from None
    if student.email != previous_email and student.password_hash is None:
        # A corrected address means the link went to the wrong person; it must not work.
        _revoke(db, student, now=now, actor=teacher)
    if change.minor is not None:
        consent.set_minor(db, student, change.minor, actor=teacher, now=now)
    if change.active is not None:
        try:
            service.set_active(db, student, change.active, actor=teacher, now=now)
        except service.ConsentMissing:
            # The whole request rolls back, so nothing of it lands.
            raise HTTPException(status_code=409, detail="consent_missing") from None
    return _out(db, student)


@router.post(
    "/{student_id}/invitation",
    responses={409: {"description": "Accepted already, deactivated, or awaiting consent"}},
)
def resend_invitation(
    student_id: int,
    request: Request,
    db: Db,
    sender: MailSender,
    settings: AppSettings,
    now: Now,
    teacher: Teacher,
) -> InvitationResult:
    """Send a new invitation; the previous link stops working."""
    student = _student(db, student_id)
    if consent.student_state(student, consent.latest_consent(db, student)) == "awaiting_consent":
        raise HTTPException(status_code=409, detail="consent_missing")
    ensure_invitable(student)
    return send_invitation(db, sender, student, request, settings, now, teacher)


@router.delete(
    "/{student_id}/invitation", status_code=204, responses={409: {"description": "Accepted"}}
)
def revoke_invitation(student_id: int, db: Db, now: Now, teacher: Teacher) -> None:
    """Void the student's invitation link, for example when it was sent to the wrong person."""
    student = _student(db, student_id)
    _not_accepted(student)
    _revoke(db, student, now=now, actor=teacher)


@router.post("/{student_id}/consent", responses={409: {"description": "Not a minor"}})
def record_consent(
    student_id: int, body: ConsentIn, db: Db, now: Now, teacher: Teacher
) -> StudentOut:
    """Record a guardian's consent for a minor, attested by the signed-in teacher.

    The student stays as they are; activating them is a separate step.
    """
    student = _student(db, student_id)
    try:
        consent.record_consent(db, student, actor=teacher, now=now, note=body.note or None)
    except consent.NotAMinor:
        raise HTTPException(status_code=409, detail="not_a_minor") from None
    return _out(db, student)
