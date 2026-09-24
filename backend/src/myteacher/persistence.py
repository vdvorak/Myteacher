"""Persistence: every row belongs to an instance and every query is scoped to it (ADR 0003).

A database session carries the instance it works for in `session.info`. Reads, updates and
deletes of instance-owned tables are filtered to that instance automatically, and new rows are
stamped with it, so no query can forget the scope. A session without an instance fails loudly.
"""

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import DateTime, Engine, ForeignKey, String, create_engine, event, select
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    ORMExecuteState,
    Session,
    mapped_column,
    with_loader_criteria,
)
from sqlalchemy.types import TypeDecorator

Clock = Callable[[], datetime]


def utc_now() -> datetime:
    return datetime.now(UTC)


class UTCDateTime(TypeDecorator[datetime]):
    """Aware UTC datetimes in Python, naive UTC in SQLite, which has no time zones."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Any) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("datetimes must be timezone-aware")
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect: Any) -> datetime | None:
        return None if value is None else value.replace(tzinfo=UTC)


class Base(DeclarativeBase):
    pass


class Instance(Base):
    __tablename__ = "instance"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str]
    default_digest_time: Mapped[str] = mapped_column(String(5))


class InstanceOwned:
    """Mixin for every table except `instance` itself."""

    instance_id: Mapped[int] = mapped_column(ForeignKey("instance.id"), index=True)


class UnscopedQuery(RuntimeError):
    """A query ran in a session that does not know its instance."""


class InstanceSession(Session):
    @property
    def instance_id(self) -> int:
        instance_id = self.info.get("instance_id")
        if instance_id is None:
            raise UnscopedQuery("this database session is not scoped to an instance")
        return instance_id


@event.listens_for(InstanceSession, "do_orm_execute")
def _scope_statement(state: ORMExecuteState) -> None:
    if not (state.is_select or state.is_update or state.is_delete):
        return
    if state.is_column_load or state.is_relationship_load:
        return
    instance_id = state.session.instance_id  # type: ignore[attr-defined]
    state.statement = state.statement.options(
        with_loader_criteria(
            InstanceOwned,
            lambda cls: cls.instance_id == instance_id,
            include_aliases=True,
        )
    )


@event.listens_for(InstanceSession, "before_flush")
def _stamp_new_rows(session: InstanceSession, *_: Any) -> None:
    for row in session.new:
        if not isinstance(row, InstanceOwned):
            continue
        if row.instance_id is None:
            row.instance_id = session.instance_id
        elif row.instance_id != session.instance_id:
            raise UnscopedQuery("a row cannot be written into another instance")


def make_engine(database_url: str) -> Engine:
    engine = create_engine(database_url, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _enforce_foreign_keys(connection: Any, _: Any) -> None:
        connection.execute("PRAGMA foreign_keys = ON")

    return engine


_SINGLETON = object()


def open_session(engine: Engine, instance_id: Any = _SINGLETON) -> InstanceSession:
    """A session scoped to `instance_id`, by default the single instance of phase 1."""
    if instance_id is _SINGLETON:
        instance_id = singleton_instance_id(engine)
    session = InstanceSession(engine, expire_on_commit=False)
    session.info["instance_id"] = instance_id
    return session


def singleton_instance_id(engine: Engine) -> int:
    with engine.connect() as connection:
        instance_id = connection.scalars(select(Instance.id).order_by(Instance.id)).first()
    if instance_id is None:
        raise RuntimeError("the database has no instance row; run migrations first")
    return instance_id
