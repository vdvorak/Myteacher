from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Request
from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from myteacher.accounts import service
from myteacher.accounts.models import Account
from myteacher.api.deps import Actor, Box, Db, Now, ensure
from myteacher.assistant import credentials
from myteacher.assistant.credentials import MIN_KEY_LENGTH, ProviderCredential
from myteacher.assistant.providers import PROVIDERS, KeyProblem, ProviderInfo, test_key
from myteacher.persistence import InstanceSession
from myteacher.policy import is_account_itself, is_teacher
from myteacher.secret_box import UndecryptableSecret

router = APIRouter(tags=["providers"])

ApiKey = Annotated[str, AfterValidator(str.strip), Field(min_length=MIN_KEY_LENGTH, max_length=500)]
ModelName = Annotated[str, AfterValidator(str.strip), Field(min_length=1, max_length=200)]


class Provider(BaseModel):
    id: str
    label: str
    strong_model: str
    fast_model: str


class Credential(BaseModel):
    provider: str
    # Only the last characters; the key itself never leaves the server.
    masked_key: str
    strong_model: str
    fast_model: str
    updated_at: datetime

    @classmethod
    def of(cls, row: ProviderCredential) -> "Credential":
        return cls(
            provider=row.provider,
            masked_key=row.masked_key,
            strong_model=row.strong_model,
            fast_model=row.fast_model,
            updated_at=row.updated_at,
        )


class CredentialChange(BaseModel):
    """Without `api_key` the stored key stays; slots left out keep their value."""

    model_config = ConfigDict(extra="forbid")

    api_key: ApiKey | None = None
    strong_model: ModelName | None = None
    fast_model: ModelName | None = None


class KeyTest(BaseModel):
    ok: bool
    error_kind: KeyProblem | None


def _own_teacher_account(db: InstanceSession, actor: Account, account_id: int) -> Account:
    ensure(is_teacher(actor) and is_account_itself(actor, account_id))
    account = service.get_account(db, account_id)
    if account is None:
        raise HTTPException(status_code=404)
    return account


def _provider(provider_id: str) -> ProviderInfo:
    provider = PROVIDERS.get(provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail="unknown_provider")
    return provider


@router.get("/providers")
def list_providers(_: Actor) -> list[Provider]:
    """The supported providers with their recommended model slots."""
    return [Provider(**vars(provider)) for provider in PROVIDERS.values()]


@router.get("/accounts/{account_id}/provider-credentials")
def list_credentials(account_id: int, db: Db, actor: Actor) -> list[Credential]:
    account = _own_teacher_account(db, actor, account_id)
    return [Credential.of(row) for row in credentials.credentials_of(db, account)]


@router.put("/accounts/{account_id}/provider-credentials/{provider_id}")
def save_credential(
    account_id: int,
    provider_id: str,
    change: CredentialChange,
    db: Db,
    actor: Actor,
    box: Box,
    now: Now,
) -> Credential:
    account = _own_teacher_account(db, actor, account_id)
    try:
        row = credentials.save(
            db,
            account,
            _provider(provider_id),
            api_key=change.api_key,
            strong_model=change.strong_model,
            fast_model=change.fast_model,
            secret_box=box,
            now=now,
        )
    except credentials.KeyRequired:
        raise HTTPException(status_code=422, detail="api_key_required") from None
    return Credential.of(row)


@router.delete("/accounts/{account_id}/provider-credentials/{provider_id}", status_code=204)
def remove_credential(account_id: int, provider_id: str, db: Db, actor: Actor, now: Now) -> None:
    account = _own_teacher_account(db, actor, account_id)
    row = credentials.credential(db, account, _provider(provider_id).id)
    if row is None:
        raise HTTPException(status_code=404)
    credentials.remove(db, row, account, now)


@router.post("/accounts/{account_id}/provider-credentials/{provider_id}/test")
async def test_credential(
    account_id: int, provider_id: str, request: Request, db: Db, actor: Actor, box: Box
) -> KeyTest:
    """A minimal call with the fast slot, reporting whether the key works."""
    account = _own_teacher_account(db, actor, account_id)
    row = credentials.credential(db, account, _provider(provider_id).id)
    if row is None:
        raise HTTPException(status_code=404)
    try:
        api_key = box.decrypt(row.key_encrypted)
    except UndecryptableSecret:
        # Stored under another instance secret: to the teacher it is a key that does not work.
        return KeyTest(ok=False, error_kind="authentication")
    problem = await test_key(request.app.state.model_factory, row.provider, row.fast_model, api_key)
    return KeyTest(ok=problem is None, error_kind=problem)
