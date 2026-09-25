import logging
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import Engine

from myteacher.accounts import invitations, resets, service
from myteacher.accounts.invitations import InvitationState
from myteacher.accounts.models import Account, Theme, theme_of
from myteacher.accounts.passwords import MIN_PASSWORD_LENGTH
from myteacher.api.deps import SESSION_COOKIE, Actor, AppSettings, Db, MailSender, Now
from myteacher.mail import MailError, Sender
from myteacher.mail.store import current_config
from myteacher.mail.templates import Language, render
from myteacher.persistence import Clock, InstanceSession, open_session
from myteacher.policy import roles
from myteacher.secret_box import SecretBox
from myteacher.settings import Settings

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)


class SignIn(BaseModel):
    email: str
    password: str


class Me(BaseModel):
    id: int
    email: str
    # The student's name; None for teachers.
    name: str | None
    kind: Literal["teacher", "student"]
    roles: list[str]
    language: Language | None
    theme: Theme

    @classmethod
    def of(cls, account: Account) -> "Me":
        return cls(
            id=account.id,
            email=account.email,
            name=account.name,
            kind=account.kind,
            roles=roles(account),
            language=account.language,
            theme=theme_of(account),
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


# Password reset, for any account kind


class ResetRequest(BaseModel):
    email: str = Field(max_length=320)


class ResetToken(BaseModel):
    token: str


class ResetCheck(BaseModel):
    state: resets.ResetState


class ResetCompletion(BaseModel):
    token: str
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=1000)


def _reset_in_background(
    engine: Engine,
    instance_id: int,
    email: str,
    *,
    sender: Sender,
    secret_box: SecretBox,
    base_url: str,
    lifetime: timedelta,
    clock: Clock,
) -> None:
    """Issue and email a reset link after the answer went out, in a session of its own.

    Nothing about the account is looked at before answering, so neither the answer nor its
    timing tells whether the email belongs to an account.
    """
    with open_session(engine, instance_id) as db:
        account = service.find_account_by_email(db, email)
        if account is None or not account.active:
            return
        try:
            config = current_config(db, secret_box)
        except MailError as error:
            logger.warning("password reset for %s cannot be emailed: %s", account.email, error)
            return
        token = resets.issue(db, account, now=clock(), lifetime=lifetime)
        db.commit()
        message = render(
            "password_reset",
            account.language or "en",  # type: ignore[arg-type]
            to=account.email,
            link=f"{base_url.rstrip('/')}/reset-password#{token}",
            minutes=str(int(lifetime.total_seconds() // 60)),
        )
    try:
        sender.send(message, config)
    except MailError as error:
        logger.warning("password reset email to %s was not sent: %s", message.to, error)


@router.post("/password-reset/request", status_code=202)
def request_password_reset(
    body: ResetRequest,
    request: Request,
    background: BackgroundTasks,
    sender: MailSender,
    settings: AppSettings,
) -> dict[str, str]:
    """Email a reset link if the address belongs to an active account; the answer never says."""
    state = request.app.state
    background.add_task(
        _reset_in_background,
        state.engine,
        state.instance_id,
        body.email,
        sender=sender,
        secret_box=state.secret_box,
        base_url=settings.public_url or str(request.base_url),
        lifetime=settings.reset_lifetime,
        clock=state.clock,
    )
    return {"status": "accepted"}


@router.post("/password-reset/check")
def check_password_reset(body: ResetToken, db: Db, now: Now) -> ResetCheck:
    state, _ = resets.inspect(db, body.token, now=now)
    return ResetCheck(state=state)


@router.post(
    "/password-reset/complete",
    responses={
        403: {"description": "The account is inactive"},
        404: {"description": "No such reset link"},
        410: {"description": "The link was used, replaced or has expired"},
    },
)
def complete_password_reset(
    body: ResetCompletion,
    request: Request,
    response: Response,
    db: Db,
    now: Now,
    settings: AppSettings,
) -> Me:
    """Set the new password, end the account's other sessions and sign in."""
    try:
        account = resets.complete(db, body.token, body.password, now=now)
    except resets.ResetRefused as refused:
        status = 404 if refused.state == "unknown" else 410
        raise HTTPException(status_code=status, detail=f"reset_{refused.state}") from None
    except resets.AccountInactive:
        raise HTTPException(status_code=403, detail="account_inactive") from None
    start_session(request, response, db, account, now=now, settings=settings)
    return Me.of(account)
