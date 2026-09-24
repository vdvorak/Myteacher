"""Account operations, each working inside the instance its database session is scoped to."""

import hashlib
import secrets
from datetime import datetime, timedelta

from sqlalchemy import delete, select

from myteacher.accounts.models import Account, AccountKind, AuditEvent, AuthSession
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


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def open_auth_session(
    db: InstanceSession, account: Account, *, now: datetime, lifetime: timedelta
) -> str:
    """Start a session and return the token for the cookie; only its hash is stored."""
    token = secrets.token_urlsafe(32)
    db.add(
        AuthSession(
            token_hash=_token_hash(token),
            account_id=account.id,
            created_at=now,
            expires_at=now + lifetime,
        )
    )
    return token


def resolve_auth_session(db: InstanceSession, token: str, *, now: datetime) -> Account | None:
    session = db.scalars(
        select(AuthSession).where(AuthSession.token_hash == _token_hash(token))
    ).first()
    if session is None:
        return None
    if session.expires_at <= now:
        db.delete(session)
        return None
    account = get_account(db, session.account_id)
    return account if account is not None and account.active else None


def close_auth_session(db: InstanceSession, token: str) -> None:
    db.execute(delete(AuthSession).where(AuthSession.token_hash == _token_hash(token)))
