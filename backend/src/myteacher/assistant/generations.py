"""The generation record: one row per assistant call, whatever its outcome (ADR 0010)."""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from myteacher.persistence import Base, InstanceOwned, UTCDateTime


class GenerationRecord(InstanceOwned, Base):
    """What was asked, with which prompt version and model, what came back and what it cost.

    Inputs are stored whole: in this slice they hold course design only, never student data.
    """

    __tablename__ = "generation_record"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_kind: Mapped[str] = mapped_column(String(50))
    prompt_version: Mapped[str] = mapped_column(String(20))
    # Of the assembled prompt, fragments included.
    prompt_hash: Mapped[str] = mapped_column(String(64))
    # The teacher whose key paid.
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), index=True)
    course_id: Mapped[int | None] = mapped_column(
        ForeignKey("course.id", ondelete="SET NULL"), index=True
    )
    provider: Mapped[str] = mapped_column(String(50))
    model: Mapped[str] = mapped_column(String(200))
    inputs: Mapped[dict[str, Any]] = mapped_column(JSON)
    # "succeeded" or "failed".
    status: Mapped[str] = mapped_column(String(20))
    # The validated output; None when the call failed.
    output: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    # What the model returned when it did not validate, for the teacher and for debugging.
    raw_output: Mapped[str | None] = mapped_column(Text)
    error_kind: Mapped[str | None] = mapped_column(String(30))
    input_tokens: Mapped[int] = mapped_column(default=0)
    output_tokens: Mapped[int] = mapped_column(default=0)
    duration_ms: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
