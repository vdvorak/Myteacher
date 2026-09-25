from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from myteacher.accounts import service
from myteacher.accounts.models import Account, Theme, theme_of
from myteacher.api.deps import Actor, Db, ensure
from myteacher.mail.templates import Language
from myteacher.persistence import Instance, InstanceSession
from myteacher.policy import is_account_itself, is_teacher

router = APIRouter(prefix="/accounts", tags=["accounts"])

DigestTime = Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$", examples=["07:00"])]


class AccountSettings(BaseModel):
    language: Language | None
    theme: Theme
    # None for students, who get no digest.
    digest_time: DigestTime | None
    digest_time_is_default: bool


class AccountSettingsChange(BaseModel):
    """Only the fields present change; a null digest time returns to the instance default."""

    model_config = ConfigDict(extra="forbid")

    language: Language | None = None
    theme: Theme | None = None
    digest_time: DigestTime | None = None

    @field_validator("language", "theme")
    @classmethod
    def _cannot_be_unset(cls, value: str | None) -> str:
        # Validators skip defaults, so this only refuses an explicit null.
        if value is None:
            raise ValueError("can be changed but not unset")
        return value


def _own_account(db: InstanceSession, actor: Account, account_id: int) -> Account:
    ensure(is_account_itself(actor, account_id))
    account = service.get_account(db, account_id)
    if account is None:
        raise HTTPException(status_code=404)
    return account


def _settings_of(db: InstanceSession, account: Account) -> AccountSettings:
    if not is_teacher(account):
        return AccountSettings(
            language=account.language,
            theme=theme_of(account),
            digest_time=None,
            digest_time_is_default=False,
        )
    default = db.get_one(Instance, db.instance_id).default_digest_time
    return AccountSettings(
        language=account.language,
        theme=theme_of(account),
        digest_time=account.digest_time or default,
        digest_time_is_default=account.digest_time is None,
    )


@router.get("/{account_id}/settings")
def read_settings(account_id: int, db: Db, actor: Actor) -> AccountSettings:
    return _settings_of(db, _own_account(db, actor, account_id))


@router.patch("/{account_id}/settings")
def change_settings(
    account_id: int, change: AccountSettingsChange, db: Db, actor: Actor
) -> AccountSettings:
    account = _own_account(db, actor, account_id)
    if "digest_time" in change.model_fields_set:
        # The digest tells a teacher what waits for review; students have none.
        ensure(is_teacher(account))
    if "language" in change.model_fields_set:
        account.language = change.language
    if "theme" in change.model_fields_set:
        account.theme = None if change.theme == "system" else change.theme
    if "digest_time" in change.model_fields_set:
        account.digest_time = change.digest_time
    return _settings_of(db, account)
