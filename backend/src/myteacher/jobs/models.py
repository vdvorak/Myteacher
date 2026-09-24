from datetime import datetime
from typing import Any, Literal

from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from myteacher.persistence import Base, InstanceOwned, UTCDateTime

JobState = Literal["queued", "running", "succeeded", "failed"]


class Job(InstanceOwned, Base):
    """A piece of assistant work running in the background, polled by the frontend."""

    __tablename__ = "job"

    id: Mapped[int] = mapped_column(primary_key=True)
    # The teacher who started it, whose key pays.
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), index=True)
    kind: Mapped[str] = mapped_column(String(50))
    # The course the job works on, if any; anyone who may view it may follow the job.
    course_id: Mapped[int | None] = mapped_column(
        ForeignKey("course.id", ondelete="CASCADE"), index=True
    )
    state: Mapped[str] = mapped_column(String(20), default="queued")
    # A short code of what the job is doing now, for the status indicator.
    progress: Mapped[str | None] = mapped_column(String(50))
    # Where to find what the job produced; its shape depends on the kind.
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    error_kind: Mapped[str | None] = mapped_column(String(30))
    # The model's answer when it did not validate, shown to the teacher with the failure.
    raw_output: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
