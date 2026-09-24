"""Account operations, each working inside the instance its database session is scoped to."""

import hashlib
import secrets
from datetime import datetime, timedelta

from sqlalchemy import delete, select

from myteacher.accounts.models import (
    Account,
    AccountKind,
    AuditEvent,
    AuthSession,
    GuardianConsent,
)
from myteacher.accounts.passwords import check_password_strength, hash_password, verify_password
from myteacher.persistence import InstanceSession


def normalise_email(email: str) -> str:
    return email.strip().lower()


def check_email(email: str) -> str:
    email = normalise_email(email)
    local, _, domain = email.partition("@")
    if not local or "." not in domain or any(c.isspace() for c in email):
        raise ValueError(f"{email!r} is not an email address")
    return email


def find_account_by_email(db: InstanceSession, email: str) -> Account | None:
    return db.scalars(select(Account).where(Account.email == normalise_email(email))).first()


def get_account(db: InstanceSession, account_id: int) -> Account | None:
    return db.scalars(select(Account).where(Account.id == account_id)).first()


def record_event(
    db: InstanceSession,
    kind: str,
    *,
    at: datetime,
    actor: Account | None,
    subject: Account | None,
) -> None:
    db.add(
        AuditEvent(
            kind=kind,
            at=at,
            actor_id=actor.id if actor else None,
            subject_id=subject.id if subject else None,
        )
    )


def audit_events(db: InstanceSession) -> list[AuditEvent]:
    return list(db.scalars(select(AuditEvent).order_by(AuditEvent.id.desc())))


def create_account(
    db: InstanceSession,
    *,
    email: str,
    kind: AccountKind,
    now: datetime,
    password: str | None = None,
    is_admin: bool = False,
) -> Account:
    if password is not None:
        check_password_strength(password)
    account = Account(
        email=check_email(email),
        kind=kind,
        password_hash=hash_password(password) if password is not None else None,
        is_admin=is_admin,
        created_at=now,
    )
    db.add(account)
    db.flush()
    return account


def ensure_admin(
    db: InstanceSession, *, email: str, password: str, now: datetime
) -> Account | None:
    """Create the first admin; a no-op once the instance has one, so it is safe on every start."""
    if db.scalars(select(Account).where(Account.is_admin)).first() is not None:
        return None
    if find_account_by_email(db, email) is not None:
        raise ValueError(
            f"{normalise_email(email)} already belongs to an account that is not an admin"
        )
    admin = create_account(
        db, email=email, password=password, kind="teacher", is_admin=True, now=now
    )
    record_event(db, "admin_created", at=now, actor=None, subject=admin)
    return admin


def authenticate(db: InstanceSession, email: str, password: str) -> Account | None:
    """The account the credentials belong to, active or not; None for wrong credentials."""
    account = find_account_by_email(db, email)
    if not verify_password(account.password_hash if account else None, password):
        return None
    return account


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def open_auth_session(
    db: InstanceSession, account: Account, *, now: datetime, lifetime: timedelta
) -> str:
    """Start a session and return the token for the cookie; only its hash is stored."""
    token = secrets.token_urlsafe(32)
    db.add(
        AuthSession(
            token_hash=token_hash(token),
            account_id=account.id,
            created_at=now,
            expires_at=now + lifetime,
        )
    )
    return token


def resolve_auth_session(db: InstanceSession, token: str, *, now: datetime) -> Account | None:
    session = db.scalars(
        select(AuthSession).where(AuthSession.token_hash == token_hash(token))
    ).first()
    if session is None:
        return None
    if session.expires_at <= now:
        db.delete(session)
        return None
    account = get_account(db, session.account_id)
    return account if account is not None and account.active else None


def close_auth_session(db: InstanceSession, token: str) -> None:
    db.execute(delete(AuthSession).where(AuthSession.token_hash == token_hash(token)))


class LastActiveAdmin(Exception):
    """The change would leave the instance without an active admin."""


class EmailTaken(Exception):
    pass


class ConsentMissing(Exception):
    """A minor cannot be active until a guardian's consent is recorded."""


def has_guardian_consent(db: InstanceSession, student: Account) -> bool:
    found = db.scalars(
        select(GuardianConsent.id).where(GuardianConsent.student_id == student.id)
    ).first()
    return found is not None


def account_state(account: Account) -> str:
    if not account.active:
        return "inactive"
    return "invited" if account.password_hash is None else "active"


def list_teachers(db: InstanceSession) -> list[Account]:
    return list(
        db.scalars(select(Account).where(Account.kind == "teacher").order_by(Account.email))
    )


def list_students(db: InstanceSession) -> list[Account]:
    return list(
        db.scalars(
            select(Account).where(Account.kind == "student").order_by(Account.name, Account.email)
        )
    )


def create_invited_account(
    db: InstanceSession,
    *,
    email: str,
    kind: AccountKind,
    language: str,
    now: datetime,
    actor: Account,
    name: str | None = None,
) -> Account:
    if find_account_by_email(db, email) is not None:
        raise EmailTaken()
    account = create_account(db, email=email, kind=kind, now=now)
    account.language = language
    account.name = name
    record_event(db, "account_created", at=now, actor=actor, subject=account)
    return account


def change_teacher(
    db: InstanceSession,
    teacher: Account,
    *,
    actor: Account,
    now: datetime,
    active: bool | None = None,
    is_admin: bool | None = None,
) -> None:
    """Deactivate, reactivate, grant or revoke admin; the instance always keeps an active admin."""
    active = teacher.active if active is None else active
    is_admin = teacher.is_admin if is_admin is None else is_admin
    stays_active_admin = active and is_admin
    if teacher.active and teacher.is_admin and not stays_active_admin:
        others = db.scalars(
            # An admin who has not accepted their invitation cannot sign in, so does not count.
            select(Account.id).where(
                Account.is_admin,
                Account.active,
                Account.password_hash.is_not(None),
                Account.id != teacher.id,
            )
        ).first()
        if others is None:
            raise LastActiveAdmin()
    if is_admin != teacher.is_admin:
        teacher.is_admin = is_admin
        kind = "admin_granted" if is_admin else "admin_revoked"
        record_event(db, kind, at=now, actor=actor, subject=teacher)
    set_active(db, teacher, active, actor=actor, now=now)


def set_active(
    db: InstanceSession, account: Account, active: bool, *, actor: Account, now: datetime
) -> None:
    """Deactivate or reactivate; deactivation ends the account's sessions and keeps its data."""
    if active == account.active:
        return
    if active and account.is_minor and not has_guardian_consent(db, account):
        raise ConsentMissing()
    account.active = active
    if not active:
        close_all_auth_sessions(db, account)
    kind = "account_activated" if active else "account_deactivated"
    record_event(db, kind, at=now, actor=actor, subject=account)


def change_basics(
    db: InstanceSession,
    account: Account,
    *,
    actor: Account,
    now: datetime,
    name: str | None = None,
    email: str | None = None,
    language: str | None = None,
) -> None:
    """Change the name, email or language others know the account by; None keeps a field."""
    if email is not None:
        email = check_email(email)
        holder = find_account_by_email(db, email)
        if holder is not None and holder.id != account.id:
            raise EmailTaken()
    changes = {"name": name, "email": email, "language": language}
    changed = False
    for field, value in changes.items():
        if value is not None and value != getattr(account, field):
            setattr(account, field, value)
            changed = True
    if changed:
        record_event(db, "account_changed", at=now, actor=actor, subject=account)


def close_all_auth_sessions(db: InstanceSession, account: Account) -> None:
    db.execute(delete(AuthSession).where(AuthSession.account_id == account.id))
