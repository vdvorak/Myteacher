from datetime import datetime
from typing import Literal

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from myteacher import erasure
from myteacher.persistence import Base, InstanceOwned, UTCDateTime

AccountKind = Literal["teacher", "student"]


class Account(InstanceOwned, Base):
    """A person who signs in: a teacher (possibly an admin) or a student."""

    __tablename__ = "account"
    __table_args__ = (UniqueConstraint("instance_id", "email"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320))
    # The student's name as their teachers know it; None for teachers.
    name: Mapped[str | None] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20))
    # None until the account's invitation is accepted.
    password_hash: Mapped[str | None]
    is_admin: Mapped[bool] = mapped_column(default=False)
    # A minor's account stays inactive until a guardian's consent is recorded (ADR 0007).
    is_minor: Mapped[bool] = mapped_column(default=False)
    active: Mapped[bool] = mapped_column(default=True)
    # Interface language; None until chosen, and the interface follows the browser meanwhile.
    language: Mapped[str | None] = mapped_column(String(2))
    # "HH:MM" of the teacher's daily digest; None follows the instance default.
    digest_time: Mapped[str | None] = mapped_column(String(5))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
    # When an admin erased the student; the row stays, with placeholders, for statistics.
    erased_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class AuthSession(InstanceOwned, Base):
    """A signed-in browser. Only the hash of the cookie token is stored."""

    __tablename__ = "auth_session"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)


class AuditEvent(InstanceOwned, Base):
    """An append-only record of an account event: who did what to whom, and when.

    Course access events also name the course and the right."""

    __tablename__ = "audit_event"

    id: Mapped[int] = mapped_column(primary_key=True)
    # None when the system acted, for example the admin bootstrap at deploy time.
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"))
    subject_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"))
    kind: Mapped[str] = mapped_column(String(50))
    at: Mapped[datetime] = mapped_column(UTCDateTime)
    # The course an access event is about. No foreign key: the log outlives what it names.
    course_id: Mapped[int | None]
    # A short qualifier of the event, such as the right granted.
    detail: Mapped[str | None] = mapped_column(String(50))


class Invitation(InstanceOwned, Base):
    """A single-use, expiring link that lets an account set its first password.

    Only the hash of the token is stored. Issuing a new invitation revokes the open ones.
    """

    __tablename__ = "invitation"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class PasswordReset(InstanceOwned, Base):
    """A single-use, short-lived link to set a new password. Only the token's hash is stored."""

    __tablename__ = "password_reset"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class GuardianConsent(InstanceOwned, Base):
    """A teacher's attestation that a minor's legal guardian agreed to the account (ADR 0007).

    Recording consent again adds a row; the latest one is the student's consent.
    """

    __tablename__ = "guardian_consent"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("account.id", ondelete="CASCADE"))
    attested_by_id: Mapped[int] = mapped_column(ForeignKey("account.id"))
    recorded_at: Mapped[datetime] = mapped_column(UTCDateTime)
    note: Mapped[str | None] = mapped_column(String(1000))


# What erasure does to a student's account data. Audit events keep only account ids, so they stay.
erasure.register(erasure.Rule(table="auth_session", student_column="account_id"))
erasure.register(erasure.Rule(table="invitation", student_column="account_id"))
erasure.register(erasure.Rule(table="password_reset", student_column="account_id"))
erasure.register(erasure.Rule(table="guardian_consent", student_column="student_id"))
erasure.register(
    erasure.Rule(
        table="account",
        student_column="id",
        anonymise={
            "name": lambda student_id: f"Erased student {student_id}",
            # Unique, and in a domain that can never receive mail.
            "email": lambda student_id: f"erased-{student_id}@erased.invalid",
            "password_hash": None,
            "language": None,
            "digest_time": None,
            "is_minor": False,
            "active": False,
        },
    )
)
