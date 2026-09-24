"""Invitations: how an account created by someone else gets its first password."""

import secrets
from datetime import datetime, timedelta
from typing import Literal

from sqlalchemy import select, update

from myteacher.accounts import service
from myteacher.accounts.models import Account, Invitation
from myteacher.accounts.passwords import hash_password
from myteacher.mail import MailError, Sender
from myteacher.mail.store import deliver
from myteacher.mail.templates import render
from myteacher.persistence import InstanceSession

InvitationState = Literal["valid", "used", "revoked", "expired", "unknown"]


class InvitationRefused(Exception):
    def __init__(self, state: InvitationState):
        super().__init__(state)
        self.state = state


class AccountInactive(Exception):
    pass


def issue(db: InstanceSession, account: Account, *, now: datetime, lifetime: timedelta) -> str:
    """A new invitation link token for `account`; earlier open invitations stop working."""
    revoke_open(db, account, now=now)
    token = secrets.token_urlsafe(32)
    db.add(
        Invitation(
            account_id=account.id,
            token_hash=service.token_hash(token),
            created_at=now,
            expires_at=now + lifetime,
        )
    )
    return token


def revoke_open(db: InstanceSession, account: Account, *, now: datetime) -> None:
    db.execute(
        update(Invitation)
        .where(
            Invitation.account_id == account.id,
            Invitation.used_at.is_(None),
            Invitation.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )


def inspect(
    db: InstanceSession, token: str, *, now: datetime
) -> tuple[InvitationState, Invitation | None]:
    invitation = db.scalars(
        select(Invitation).where(Invitation.token_hash == service.token_hash(token))
    ).first()
    if invitation is None:
        return "unknown", None
    if invitation.used_at is not None:
        return "used", invitation
    if invitation.revoked_at is not None:
        return "revoked", invitation
    if invitation.expires_at <= now:
        return "expired", invitation
    return "valid", invitation


def accept(db: InstanceSession, token: str, password: str, *, now: datetime) -> Account:
    """Set the invited account's password and use the invitation up."""
    state, invitation = inspect(db, token, now=now)
    if state != "valid" or invitation is None:
        raise InvitationRefused(state)
    account = service.get_account(db, invitation.account_id)
    if account is None:
        raise InvitationRefused("unknown")
    if not account.active:
        raise AccountInactive()
    # Conditional, so that of two concurrent acceptances only one uses the invitation up.
    used = db.execute(
        update(Invitation)
        .where(
            Invitation.id == invitation.id,
            Invitation.used_at.is_(None),
            Invitation.revoked_at.is_(None),
        )
        .values(used_at=now)
        .execution_options(synchronize_session=False)
    )
    if used.rowcount != 1:  # type: ignore[attr-defined]
        raise InvitationRefused("used")
    account.password_hash = hash_password(password)
    service.record_event(db, "invitation_accepted", at=now, actor=account, subject=account)
    return account


def send(
    db: InstanceSession,
    sender: Sender,
    account: Account,
    *,
    base_url: str,
    lifetime: timedelta,
    now: datetime,
    actor: Account,
) -> str | None:
    """Issue a fresh invitation and email it; returns the mail error in plain words, if any."""
    # A failed delivery rolls back, so the previous link keeps working.
    savepoint = db.begin_nested()
    token = issue(db, account, now=now, lifetime=lifetime)
    # The token travels in the fragment, so it never reaches server or proxy logs.
    link = f"{base_url.rstrip('/')}/invitation#{token}"
    message = render(
        f"{account.kind}_invitation",
        account.language or "en",  # type: ignore[arg-type]
        to=account.email,
        link=link,
        days=str(lifetime.days),
    )
    try:
        deliver(db, sender, message)
    except MailError as error:
        savepoint.rollback()
        return str(error)
    savepoint.commit()
    service.record_event(db, "invitation_sent", at=now, actor=actor, subject=account)
    return None
