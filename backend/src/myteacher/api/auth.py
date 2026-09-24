from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from myteacher.accounts import invitations, service
from myteacher.accounts.invitations import InvitationState
from myteacher.accounts.models import Account
from myteacher.accounts.passwords import MIN_PASSWORD_LENGTH
from myteacher.api.deps import SESSION_COOKIE, Actor, AppSettings, Db, Now
from myteacher.mail.templates import Language
from myteacher.persistence import InstanceSession
from myteacher.policy import roles
from myteacher.settings import Settings

router = APIRouter(prefix="/auth", tags=["auth"])


class SignIn(BaseModel):
    email: str
    password: str


class Me(BaseModel):
    id: int
    email: str
    kind: Literal["teacher", "student"]
    roles: list[str]
    language: Language | None

    @classmethod
    def of(cls, account: Account) -> "Me":
        return cls(
            id=account.id,
            email=account.email,
            kind=account.kind,
            roles=roles(account),
            language=account.language,
        )


@router.post(
    "/sign-in",
    responses={
        401: {"description": "Wrong email or password"},
        403: {"description": "The account is inactive"},
    },
)
def sign_in(
    credentials: SignIn,
    request: Request,
    response: Response,
    db: Db,
    now: Now,
    settings: AppSettings,
) -> Me:
    account = service.authenticate(db, credentials.email, credentials.password)
    if account is None:
        # One answer for an unknown email and a wrong password alike.
        raise HTTPException(status_code=401, detail="invalid_credentials")
    if not account.active:
        # Said only after the password matched, so it reveals nothing to a stranger.
        raise HTTPException(status_code=403, detail="account_inactive")
    start_session(request, response, db, account, now=now, settings=settings)
    return Me.of(account)


def start_session(
    request: Request,
    response: Response,
    db: InstanceSession,
    account: Account,
    *,
    now: datetime,
    settings: Settings,
) -> None:
    """Sign `account` in: a new server-side session behind an HTTP-only cookie."""
    previous = request.cookies.get(SESSION_COOKIE)
    if previous:
        service.close_auth_session(db, previous)
    token = service.open_auth_session(db, account, now=now, lifetime=settings.session_lifetime)
    service.record_event(db, "signed_in", at=now, actor=account, subject=account)
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(settings.session_lifetime.total_seconds()),
        path="/",
        httponly=True,
        samesite="lax",
        secure=settings.secure_cookies,
    )


@router.post("/sign-out", status_code=204)
def sign_out(request: Request, response: Response, actor: Actor, db: Db, now: Now) -> None:
    service.close_auth_session(db, request.cookies[SESSION_COOKIE])
    service.record_event(db, "signed_out", at=now, actor=actor, subject=actor)
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/me")
def who_am_i(actor: Actor) -> Me:
    return Me.of(actor)


# Invitations, shared by teachers and students


class InvitationToken(BaseModel):
    token: str


class InvitationCheck(BaseModel):
    state: InvitationState
    # Only for a valid invitation, so a stale link reveals nothing.
    email: str | None


class InvitationAcceptance(BaseModel):
    token: str
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=1000)


@router.post("/invitations/check")
def check_invitation(body: InvitationToken, db: Db, now: Now) -> InvitationCheck:
    state, invitation = invitations.inspect(db, body.token, now=now)
    account = service.get_account(db, invitation.account_id) if invitation else None
    return InvitationCheck(
        state=state, email=account.email if state == "valid" and account else None
    )


@router.post(
    "/invitations/accept",
    responses={
        403: {"description": "The account is inactive"},
        404: {"description": "No such invitation"},
        410: {"description": "The invitation was used, revoked or has expired"},
    },
)
def accept_invitation(
    body: InvitationAcceptance,
    request: Request,
    response: Response,
    db: Db,
    now: Now,
    settings: AppSettings,
) -> Me:
    """Set the first password and sign in."""
    try:
        account = invitations.accept(db, body.token, body.password, now=now)
    except invitations.InvitationRefused as refused:
        status = 404 if refused.state == "unknown" else 410
        raise HTTPException(status_code=status, detail=f"invitation_{refused.state}") from None
    except invitations.AccountInactive:
        raise HTTPException(status_code=403, detail="account_inactive") from None
    start_session(request, response, db, account, now=now, settings=settings)
    return Me.of(account)
