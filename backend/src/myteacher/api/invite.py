"""Emailing an invitation from an API request, shared by the teacher and student routers."""

from datetime import datetime

from fastapi import HTTPException, Request
from pydantic import BaseModel

from myteacher.accounts import invitations
from myteacher.accounts.models import Account
from myteacher.mail import Sender
from myteacher.persistence import InstanceSession
from myteacher.settings import Settings


class InvitationResult(BaseModel):
    invitation_sent: bool
    error: str | None


def ensure_invitable(account: Account) -> None:
    """Refuse to invite an account that has accepted already or is deactivated."""
    if account.password_hash is not None:
        raise HTTPException(status_code=409, detail="already_accepted")
    if not account.active:
        # The link would be refused at acceptance anyway, so no email goes out.
        raise HTTPException(status_code=409, detail="account_inactive")


def send_invitation(
    db: InstanceSession,
    sender: Sender,
    account: Account,
    request: Request,
    settings: Settings,
    now: datetime,
    actor: Account,
) -> InvitationResult:
    error = invitations.send(
        db,
        sender,
        account,
        secret_box=request.app.state.secret_box,
        base_url=settings.public_url or str(request.base_url),
        lifetime=settings.invitation_lifetime,
        now=now,
        actor=actor,
    )
    return InvitationResult(invitation_sent=error is None, error=error)
