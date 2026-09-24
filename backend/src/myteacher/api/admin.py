from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_serializer

from myteacher import erasure
from myteacher.accounts import service
from myteacher.accounts.models import Account
from myteacher.api.deps import AppSettings, Box, Db, MailSender, Now, requires
from myteacher.api.invite import InvitationResult, ensure_invitable, send_invitation
from myteacher.mail import MailError, Security, SmtpConfig
from myteacher.mail.store import deliver, save_settings, stored_settings
from myteacher.mail.templates import Language, render
from myteacher.policy import is_admin

router = APIRouter(prefix="/admin", tags=["admin"])
Admin = Annotated[Account, requires(is_admin)]


class AuditEventOut(BaseModel):
    kind: str
    actor_id: int | None
    subject_id: int | None
    at: datetime

    @field_serializer("at")
    def _utc(self, at: datetime) -> str:
        return at.strftime("%Y-%m-%dT%H:%M:%SZ")


@router.get("/audit-events")
def list_audit_events(db: Db, _: Admin) -> list[AuditEventOut]:
    """The instance's account events, newest first."""
    return [
        AuditEventOut(kind=e.kind, actor_id=e.actor_id, subject_id=e.subject_id, at=e.at)
        for e in service.audit_events(db)
    ]


# SMTP settings

Email = Annotated[str, AfterValidator(service.check_email)]
Host = Annotated[str, AfterValidator(str.strip), Field(min_length=1, max_length=255)]


class SmtpSettingsOut(BaseModel):
    configured: bool
    host: str
    port: int
    security: Security
    username: str
    sender: str
    # The password itself is never returned.
    password_set: bool


class SmtpSettingsIn(BaseModel):
    host: Host
    port: int = Field(ge=1, le=65535)
    security: Security
    username: str = Field(max_length=255)
    # Omitted or null keeps the stored password; an empty string removes it.
    password: str | None = None
    sender: Email


class TestEmail(BaseModel):
    to: Email
    language: Language


class TestEmailResult(BaseModel):
    delivered: bool
    error: str | None


def _settings_out(db: Db) -> SmtpSettingsOut:
    row = stored_settings(db)
    if row is None:
        return SmtpSettingsOut(
            configured=False,
            host="",
            port=587,
            security="starttls",
            username="",
            sender="",
            password_set=False,
        )
    return SmtpSettingsOut(
        configured=True,
        host=row.host,
        port=row.port,
        security=row.security,
        username=row.username,
        sender=row.sender,
        password_set=row.password_encrypted is not None,
    )


@router.get("/smtp")
def read_smtp_settings(db: Db, _: Admin) -> SmtpSettingsOut:
    return _settings_out(db)


@router.put("/smtp")
def update_smtp_settings(
    body: SmtpSettingsIn, db: Db, admin: Admin, now: Now, box: Box
) -> SmtpSettingsOut:
    config = SmtpConfig(
        host=body.host,
        port=body.port,
        security=body.security,
        username=body.username.strip(),
        password=body.password,
        sender=body.sender,
    )
    save_settings(db, config, keep_password=body.password is None, now=now, secret_box=box)
    service.record_event(db, "smtp_settings_changed", at=now, actor=admin, subject=None)
    return _settings_out(db)


@router.post("/smtp/test")
def send_test_email(
    body: TestEmail, db: Db, sender: MailSender, box: Box, _: Admin
) -> TestEmailResult:
    try:
        deliver(db, sender, render("test_email", body.language, to=body.to), box)
    except MailError as error:
        return TestEmailResult(delivered=False, error=str(error))
    return TestEmailResult(delivered=True, error=None)


# Teachers


class TeacherOut(BaseModel):
    id: int
    email: str
    language: Language | None
    is_admin: bool
    state: Literal["invited", "active", "inactive"]

    @classmethod
    def of(cls, teacher: Account) -> "TeacherOut":
        return cls(
            id=teacher.id,
            email=teacher.email,
            language=teacher.language,  # type: ignore[arg-type]
            is_admin=teacher.is_admin,
            state=service.account_state(teacher),  # type: ignore[arg-type]
        )


class NewTeacher(BaseModel):
    email: Email
    language: Language


class CreatedTeacher(TeacherOut, InvitationResult):
    pass


class TeacherChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    active: bool | None = None
    is_admin: bool | None = None


def _teacher(db: Db, teacher_id: int) -> Account:
    teacher = service.get_account(db, teacher_id)
    if teacher is None or teacher.kind != "teacher":
        raise HTTPException(status_code=404)
    return teacher


@router.get("/teachers")
def list_teachers(db: Db, _: Admin) -> list[TeacherOut]:
    return [TeacherOut.of(teacher) for teacher in service.list_teachers(db)]


@router.post("/teachers", status_code=201, responses={409: {"description": "Email taken"}})
def create_teacher(
    body: NewTeacher,
    request: Request,
    db: Db,
    sender: MailSender,
    settings: AppSettings,
    now: Now,
    admin: Admin,
) -> CreatedTeacher:
    """Create a teacher account and email the invitation to set a password."""
    try:
        teacher = service.create_invited_account(
            db, email=body.email, kind="teacher", language=body.language, now=now, actor=admin
        )
    except service.EmailTaken:
        raise HTTPException(status_code=409, detail="email_taken") from None
    result = send_invitation(db, sender, teacher, request, settings, now, admin)
    return CreatedTeacher(**TeacherOut.of(teacher).model_dump(), **result.model_dump())


@router.post(
    "/teachers/{teacher_id}/invitation",
    responses={409: {"description": "Accepted already, or deactivated"}},
)
def resend_invitation(
    teacher_id: int,
    request: Request,
    db: Db,
    sender: MailSender,
    settings: AppSettings,
    now: Now,
    admin: Admin,
) -> InvitationResult:
    """Send a new invitation; the previous link stops working."""
    teacher = _teacher(db, teacher_id)
    ensure_invitable(teacher)
    return send_invitation(db, sender, teacher, request, settings, now, admin)


@router.patch("/teachers/{teacher_id}", responses={409: {"description": "Last active admin"}})
def change_teacher(
    teacher_id: int, change: TeacherChange, db: Db, now: Now, admin: Admin
) -> TeacherOut:
    """Deactivate or reactivate a teacher, or grant or revoke the admin role."""
    teacher = _teacher(db, teacher_id)
    try:
        service.change_teacher(
            db, teacher, actor=admin, now=now, active=change.active, is_admin=change.is_admin
        )
    except service.LastActiveAdmin:
        raise HTTPException(status_code=409, detail="last_active_admin") from None
    return TeacherOut.of(teacher)


# Erasure


class ErasureConfirmation(BaseModel):
    # The student's name, typed by the admin, so that erasure never happens by accident.
    confirmation: str = Field(max_length=200)


@router.post(
    "/students/{student_id}/erasure",
    status_code=204,
    responses={
        409: {"description": "The confirmation is not the student's name"},
        410: {"description": "Erased already"},
    },
)
def erase_student(
    student_id: int, body: ErasureConfirmation, db: Db, now: Now, admin: Admin
) -> None:
    """Physically remove the student's personal data, leaving placeholders (ADR 0007).

    Deactivation is the normal way to delete; this serves a legal erasure request.
    """
    student = service.get_account(db, student_id)
    if student is None or student.kind != "student":
        raise HTTPException(status_code=404)
    if student.erased_at is not None:
        raise HTTPException(status_code=410, detail="student_erased")
    if body.confirmation.strip() != (student.name or "").strip():
        raise HTTPException(status_code=409, detail="confirmation_mismatch")
    db.flush()
    erasure.erase(db, student.id)
    # The rows changed underneath the session; reload the account before marking it.
    db.expire(student)
    student.erased_at = now
    service.record_event(db, "student_erased", at=now, actor=admin, subject=student)
