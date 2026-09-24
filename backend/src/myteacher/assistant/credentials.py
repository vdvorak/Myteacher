"""A teacher's provider credentials: an encrypted key and two model slots per provider."""

from datetime import datetime

from sqlalchemy import ForeignKey, String, UniqueConstraint, select
from sqlalchemy.orm import Mapped, mapped_column

from myteacher.accounts import service
from myteacher.accounts.models import Account
from myteacher.assistant.providers import ProviderInfo
from myteacher.persistence import Base, InstanceOwned, InstanceSession, UTCDateTime
from myteacher.secret_box import SecretBox

TAIL = 4
MIN_KEY_LENGTH = 8


class ProviderCredential(InstanceOwned, Base):
    __tablename__ = "provider_credential"
    __table_args__ = (UniqueConstraint("account_id", "provider"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id", ondelete="CASCADE"))
    provider: Mapped[str] = mapped_column(String(50))
    key_encrypted: Mapped[str]
    key_tail: Mapped[str] = mapped_column(String(TAIL))
    strong_model: Mapped[str] = mapped_column(String(200))
    fast_model: Mapped[str] = mapped_column(String(200))
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime)

    @property
    def masked_key(self) -> str:
        return f"…{self.key_tail}"


class KeyRequired(Exception):
    """A first save for a provider needs a key."""


def credentials_of(db: InstanceSession, account: Account) -> list[ProviderCredential]:
    return list(
        db.scalars(
            select(ProviderCredential)
            .where(ProviderCredential.account_id == account.id)
            .order_by(ProviderCredential.provider)
        )
    )


def credential(db: InstanceSession, account: Account, provider: str) -> ProviderCredential | None:
    return db.scalars(
        select(ProviderCredential).where(
            ProviderCredential.account_id == account.id, ProviderCredential.provider == provider
        )
    ).first()


def save(
    db: InstanceSession,
    account: Account,
    provider: ProviderInfo,
    *,
    api_key: str | None,
    strong_model: str | None,
    fast_model: str | None,
    secret_box: SecretBox,
    now: datetime,
) -> ProviderCredential:
    """Add, replace or re-slot a credential; without `api_key` the stored key stays."""
    row = credential(db, account, provider.id)
    if row is None:
        if api_key is None:
            raise KeyRequired()
        row = ProviderCredential(
            account_id=account.id,
            provider=provider.id,
            strong_model=provider.strong_model,
            fast_model=provider.fast_model,
        )
        db.add(row)
        event = "provider_key_added"
    else:
        event = "provider_key_replaced" if api_key is not None else None
    if api_key is not None:
        row.key_encrypted = secret_box.encrypt(api_key)
        row.key_tail = api_key[-TAIL:]
    row.strong_model = strong_model or row.strong_model
    row.fast_model = fast_model or row.fast_model
    row.updated_at = now
    if event:
        service.record_event(db, event, at=now, actor=account, subject=account)
    db.flush()
    return row


def remove(db: InstanceSession, row: ProviderCredential, account: Account, now: datetime) -> None:
    db.delete(row)
    service.record_event(db, "provider_key_removed", at=now, actor=account, subject=account)
