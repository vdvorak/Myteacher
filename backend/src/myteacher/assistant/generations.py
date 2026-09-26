"""The generation record: one row per assistant call, whatever its outcome (ADR 0010)."""

from datetime import datetime
from typing import Any, Literal

from sqlalchemy import JSON, ForeignKey, String, Text, select
from sqlalchemy.orm import Mapped, mapped_column

from myteacher import erasure
from myteacher.persistence import Base, InstanceOwned, InstanceSession, UTCDateTime


class GenerationRecord(InstanceOwned, Base):
    """What was asked, with which prompt version and model, what came back and what it cost.

    Inputs are stored whole. They hold course design, except for the assessment of an open
    answer, which holds the answer: its record names the student, whose erasure blanks it.
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
    # The student whose work the inputs hold, if any.
    student_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"), index=True)
    # Or the link run participant whose work they hold, whose run's erasure blanks them.
    participant_id: Mapped[int | None] = mapped_column(
        ForeignKey("participant.id", ondelete="SET NULL"), index=True
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


# What a teacher did with generated content: kept it as it was, edited it, regenerated or
# discarded it, or overrode the assessment it made.
ReactionKind = Literal["kept", "edited", "regenerated", "discarded", "overridden"]


class GenerationReaction(InstanceOwned, Base):
    """A teacher's reaction to what one generation produced: the quality signal of ADR 0010.

    One row per reaction, so the history of a generation's reception is kept; it must outlive
    any later pruning of generation records' inputs and outputs.
    """

    __tablename__ = "generation_reaction"

    id: Mapped[int] = mapped_column(primary_key=True)
    generation_id: Mapped[int] = mapped_column(ForeignKey("generation_record.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"))
    # What the reaction concerned, such as the version an edit produced.
    detail: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)


def reviewed(db: InstanceSession, generation_id: int | None) -> bool:
    """Whether the teacher saw to what a version holds: they wrote it (no generation), or kept
    what the assistant generated as it is."""
    if generation_id is None:
        return True
    kept = select(GenerationReaction.id).where(
        GenerationReaction.generation_id == generation_id, GenerationReaction.kind == "kept"
    )
    return db.scalar(kept.limit(1)) is not None


def kept_of(db: InstanceSession, generation_ids: set[int]) -> set[int]:
    """Which of the generations the teacher kept as they are."""
    kept = select(GenerationReaction.generation_id).where(
        GenerationReaction.generation_id.in_(generation_ids), GenerationReaction.kind == "kept"
    )
    return set(db.scalars(kept))


# The record and the teacher's reactions stay for the prompt's quality signal; the student's
# work in it goes.
erasure.register(
    erasure.Rule(
        table="generation_record",
        student_column="student_id",
        anonymise={"inputs": "{}", "output": None, "raw_output": None},
    )
)
