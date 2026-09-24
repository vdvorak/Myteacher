"""Students, maintained by any teacher on the instance: students belong to it, not to a teacher."""

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator

from myteacher.accounts import invitations, service
from myteacher.accounts.models import Account
from myteacher.api.deps import AppSettings, Db, MailSender, Now, requires
from myteacher.api.invite import InvitationResult, ensure_invitable, send_invitation
from myteacher.mail.templates import Language
from myteacher.persistence import InstanceSession
from myteacher.policy import is_teacher

router = APIRouter(prefix="/students", tags=["students"])
Teacher = Annotated[Account, requires(is_teacher)]

Email = Annotated[str, AfterValidator(service.check_email)]
Name = Annotated[str, AfterValidator(str.strip), Field(min_length=1, max_length=200)]


class StudentOut(BaseModel):
    id: int
    name: str
    email: str
    language: Language | None
    state: Literal["invited", "active", "inactive"]

    @classmethod
    def of(cls, student: Account) -> "StudentOut":
        return cls(
            id=student.id,
            name=student.name or "",
            email=student.email,
            language=student.language,  # type: ignore[arg-type]
            state=service.account_state(student),  # type: ignore[arg-type]
        )


class NewStudent(BaseModel):
    name: Name
    email: Email
    language: Language


class CreatedStudent(StudentOut, InvitationResult):
    pass


class StudentChange(BaseModel):
    """Only the fields present change; none of them can be unset."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    email: Email | None = None
    language: Language | None = None
    active: bool | None = None

    @field_validator("name", "email", "language", "active")
    @classmethod
    def _cannot_be_unset(cls, value: object) -> object:
        # Validators skip defaults, so this only refuses an explicit null.
        if value is None:
            raise ValueError("can be changed but not unset")
        return value


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
    return [StudentOut.of(student) for student in service.list_students(db)]


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
    """Create a student account and email the invitation to set a password."""
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
    result = send_invitation(db, sender, student, request, settings, now, teacher)
    return CreatedStudent(**StudentOut.of(student).model_dump(), **result.model_dump())


@router.get("/{student_id}")
def read_student(student_id: int, db: Db, _: Teacher) -> StudentOut:
    return StudentOut.of(_student(db, student_id))


@router.patch("/{student_id}", responses={409: {"description": "Email taken"}})
def change_student(
    student_id: int, change: StudentChange, db: Db, now: Now, teacher: Teacher
) -> StudentOut:
    """Edit the student's basics, or deactivate or reactivate them; their history stays."""
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
    if change.active is not None:
        service.set_active(db, student, change.active, actor=teacher, now=now)
    return StudentOut.of(student)


@router.post(
    "/{student_id}/invitation", responses={409: {"description": "Accepted already, or deactivated"}}
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
