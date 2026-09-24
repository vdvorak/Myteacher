from datetime import datetime
from typing import Annotated

from fastapi import APIRouter
from pydantic import AfterValidator, BaseModel, Field, field_serializer

from myteacher.accounts import service
from myteacher.accounts.models import Account
from myteacher.api.deps import Db, MailSender, Now, requires
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
        password_set=row.password is not None,
    )


@router.get("/smtp")
def read_smtp_settings(db: Db, _: Admin) -> SmtpSettingsOut:
    return _settings_out(db)


@router.put("/smtp")
def update_smtp_settings(body: SmtpSettingsIn, db: Db, admin: Admin, now: Now) -> SmtpSettingsOut:
    config = SmtpConfig(
        host=body.host,
        port=body.port,
        security=body.security,
        username=body.username.strip(),
        password=body.password,
        sender=body.sender,
    )
    save_settings(db, config, keep_password=body.password is None, now=now)
    service.record_event(db, "smtp_settings_changed", at=now, actor=admin, subject=None)
    return _settings_out(db)


@router.post("/smtp/test")
def send_test_email(body: TestEmail, db: Db, sender: MailSender, _: Admin) -> TestEmailResult:
    try:
        deliver(db, sender, render("test_email", body.language, to=body.to))
    except MailError as error:
        return TestEmailResult(delivered=False, error=str(error))
    return TestEmailResult(delivered=True, error=None)
