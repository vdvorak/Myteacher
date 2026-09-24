"""Password resets by email, for any account kind."""

import secrets
from datetime import datetime, timedelta
from typing import Literal

from sqlalchemy import select, update

from myteacher.accounts import invitations, service
from myteacher.accounts.models import Account, PasswordReset
from myteacher.accounts.passwords import hash_password
from myteacher.persistence import InstanceSession

ResetState = Literal["valid", "used", "revoked", "expired", "unknown"]


class ResetRefused(Exception):
    def __init__(self, state: ResetState):
        super().__init__(state)
        self.state = state


class AccountInactive(Exception):
    pass


def issue(db: InstanceSession, account: Account, *, now: datetime, lifetime: timedelta) -> str:
    """A new reset link token for `account`.

    Earlier links keep working until they expire or one of them is used, so repeated requests
    by someone else cannot break the link the account holder is about to open.
    """
    token = secrets.token_urlsafe(32)
    db.add(
        PasswordReset(
            account_id=account.id,
            token_hash=service.token_hash(token),
            created_at=now,
            expires_at=now + lifetime,
        )
    )
    service.record_event(db, "password_reset_requested", at=now, actor=None, subject=account)
    return token


def inspect(
    db: InstanceSession, token: str, *, now: datetime
) -> tuple[ResetState, PasswordReset | None]:
    reset = db.scalars(
        select(PasswordReset).where(PasswordReset.token_hash == service.token_hash(token))
    ).first()
    if reset is None:
        return "unknown", None
    if reset.used_at is not None:
        return "used", reset
    if reset.revoked_at is not None:
        return "revoked", reset
    if reset.expires_at <= now:
        return "expired", reset
    return "valid", reset


def complete(db: InstanceSession, token: str, password: str, *, now: datetime) -> Account:
    """Set the new password, use the link up and end every session of the account."""
    state, reset = inspect(db, token, now=now)
    if state != "valid" or reset is None:
        raise ResetRefused(state)
    account = service.get_account(db, reset.account_id)
    if account is None:
        raise ResetRefused("unknown")
    if not account.active:
        raise AccountInactive()
    # Conditional, so that of two concurrent completions only one uses the link up.
    used = db.execute(
        update(PasswordReset)
        .where(
            PasswordReset.id == reset.id,
            PasswordReset.used_at.is_(None),
            PasswordReset.revoked_at.is_(None),
        )
        .values(used_at=now)
        .execution_options(synchronize_session=False)
    )
    if used.rowcount != 1:  # type: ignore[attr-defined]
        raise ResetRefused("used")
    db.execute(
        update(PasswordReset)
        .where(
            PasswordReset.account_id == account.id,
            PasswordReset.used_at.is_(None),
            PasswordReset.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    # An invited account that reset its way in must not be taken over by the old invitation.
    invitations.revoke_open(db, account, now=now)
    account.password_hash = hash_password(password)
    service.close_all_auth_sessions(db, account)
    service.record_event(db, "password_reset", at=now, actor=account, subject=account)
    return account
