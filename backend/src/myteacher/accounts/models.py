from datetime import datetime
from typing import Literal

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from myteacher.persistence import Base, InstanceOwned, UTCDateTime

AccountKind = Literal["teacher", "student"]


class Account(InstanceOwned, Base):
    """A person who signs in: a teacher (possibly an admin) or a student."""

    __tablename__ = "account"
    __table_args__ = (UniqueConstraint("instance_id", "email"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320))
    kind: Mapped[str] = mapped_column(String(20))
    # None until the account's invitation is accepted.
    password_hash: Mapped[str | None]
    is_admin: Mapped[bool] = mapped_column(default=False)
    active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)


class AuthSession(InstanceOwned, Base):
    """A signed-in browser. Only the hash of the cookie token is stored."""

    __tablename__ = "auth_session"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)


class AuditEvent(InstanceOwned, Base):
    """An append-only record of an account event: who did what to whom, and when."""

    __tablename__ = "audit_event"

    id: Mapped[int] = mapped_column(primary_key=True)
    # None when the system acted, for example the admin bootstrap at deploy time.
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"))
    subject_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"))
    kind: Mapped[str] = mapped_column(String(50))
    at: Mapped[datetime] = mapped_column(UTCDateTime)
