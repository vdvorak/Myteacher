"""The instance's SMTP settings and delivery through them."""

from datetime import datetime

from sqlalchemy import String, UniqueConstraint, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, mapped_column

from myteacher.mail import MailError, Message, Sender, SmtpConfig
from myteacher.persistence import Base, InstanceOwned, InstanceSession, UTCDateTime, utc_now


class SmtpSettings(InstanceOwned, Base):
    """One row per instance; absent until the admin saves settings."""

    __tablename__ = "smtp_settings"
    __table_args__ = (UniqueConstraint("instance_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    host: Mapped[str] = mapped_column(String(255))
    port: Mapped[int]
    security: Mapped[str] = mapped_column(String(10))
    username: Mapped[str] = mapped_column(String(255))
    # Plain text for now; encrypted with the instance secret once #26 introduces it.
    password: Mapped[str | None]
    sender: Mapped[str] = mapped_column(String(320))
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime)


def stored_settings(db: InstanceSession) -> SmtpSettings | None:
    return db.scalars(select(SmtpSettings)).first()


def save_settings(
    db: InstanceSession, config: SmtpConfig, *, keep_password: bool, now: datetime
) -> SmtpSettings:
    """Store `config`; with `keep_password` the stored password stays and config's is ignored."""
    row = stored_settings(db) or _first_row(db)
    row.host, row.port, row.security = config.host, config.port, config.security
    row.username, row.sender, row.updated_at = config.username, config.sender, now
    if not keep_password:
        row.password = config.password or None
    db.flush()
    return row


def _first_row(db: InstanceSession) -> SmtpSettings:
    """Insert the instance's row, or take the one a concurrent first save inserted meanwhile."""
    row = SmtpSettings(
        host="", port=587, security="none", username="", sender="", updated_at=utc_now()
    )
    try:
        with db.begin_nested():
            db.add(row)
    except IntegrityError:
        existing = stored_settings(db)
        assert existing is not None
        return existing
    return row


def current_config(db: InstanceSession) -> SmtpConfig:
    row = stored_settings(db)
    if row is None:
        raise MailError("Email is not configured yet. An admin has to enter the SMTP settings.")
    return SmtpConfig(
        host=row.host,
        port=row.port,
        security=row.security,  # type: ignore[arg-type]
        username=row.username,
        password=row.password,
        sender=row.sender,
    )


def deliver(db: InstanceSession, sender: Sender, message: Message) -> None:
    sender.send(message, current_config(db))
