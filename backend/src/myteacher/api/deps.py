"""Request dependencies shared by the routers: the database session, the clock and the actor."""

from collections.abc import Iterator
from datetime import datetime
from typing import Annotated

from fastapi import Depends, HTTPException, Request

from myteacher.accounts import service
from myteacher.accounts.models import Account
from myteacher.mail import Sender
from myteacher.persistence import InstanceSession, open_session
from myteacher.policy import Predicate
from myteacher.secret_box import SecretBox
from myteacher.settings import Settings

SESSION_COOKIE = "myteacher_session"


def get_db(request: Request) -> Iterator[InstanceSession]:
    state = request.app.state
    with open_session(state.engine, state.instance_id) as db:
        yield db
        db.commit()


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_now(request: Request) -> datetime:
    return request.app.state.clock()


# Function scope: the commit happens before the response is sent, so a client is never told
# about a write that has not landed.
def get_sender(request: Request) -> Sender:
    return request.app.state.sender


def get_secret_box(request: Request) -> SecretBox:
    return request.app.state.secret_box


Db = Annotated[InstanceSession, Depends(get_db, scope="function")]
AppSettings = Annotated[Settings, Depends(get_settings)]
Now = Annotated[datetime, Depends(get_now)]
MailSender = Annotated[Sender, Depends(get_sender)]
Box = Annotated[SecretBox, Depends(get_secret_box)]


def current_account(request: Request, db: Db, now: Now) -> Account:
    token = request.cookies.get(SESSION_COOKIE)
    account = service.resolve_auth_session(db, token, now=now) if token else None
    if account is None:
        # An expired session is deleted while resolving it, so commit before refusing.
        db.commit()
        raise HTTPException(status_code=401, detail="not_signed_in")
    return account


Actor = Annotated[Account, Depends(current_account)]


def requires(predicate: Predicate):
    """A dependency that yields the actor when `predicate` holds for them, else refuses with 403."""

    def dependency(actor: Actor) -> Account:
        ensure(predicate(actor))
        return actor

    return Depends(dependency)


def ensure(allowed: bool) -> None:
    if not allowed:
        raise HTTPException(status_code=403, detail="forbidden")
