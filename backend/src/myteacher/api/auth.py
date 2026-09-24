from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from myteacher.accounts import service
from myteacher.accounts.models import Account
from myteacher.api.deps import SESSION_COOKIE, Actor, AppSettings, Db, Now
from myteacher.mail.templates import Language
from myteacher.policy import roles

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
    return Me.of(account)


@router.post("/sign-out", status_code=204)
def sign_out(request: Request, response: Response, actor: Actor, db: Db, now: Now) -> None:
    service.close_auth_session(db, request.cookies[SESSION_COOKIE])
    service.record_event(db, "signed_out", at=now, actor=actor, subject=actor)
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/me")
def who_am_i(actor: Actor) -> Me:
    return Me.of(actor)
