from datetime import datetime

from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from myteacher.persistence import Base, InstanceOwned, UTCDateTime


class Course(InstanceOwned, Base):
    """The reusable design of a subject, owned by one teacher and never tied to students
    (ADR 0008). Nothing here is student data, so erasure registers no rule for it."""

    __tablename__ = "course"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("account.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    subject: Mapped[str] = mapped_column(String(200))
    # The language being taught, if the subject is one; None for, say, mathematics.
    taught_language: Mapped[str | None] = mapped_column(String(10))
    # The language explanations are written in.
    instruction_language: Mapped[str] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)

    brief: Mapped["CourseBriefRow"] = relationship(lazy="joined")


class CourseBriefRow(InstanceOwned, Base):
    """The course brief, one column per field, so that saving one field never writes another."""

    __tablename__ = "course_brief"

    course_id: Mapped[int] = mapped_column(
        ForeignKey("course.id", ondelete="CASCADE"), primary_key=True
    )
    audience: Mapped[str | None] = mapped_column(Text)
    level: Mapped[str | None] = mapped_column(Text)
    goals: Mapped[str | None] = mapped_column(Text)
    timeframe: Mapped[str | None] = mapped_column(Text)
    preferred_exercise_types: Mapped[list[str]] = mapped_column(JSON)
    forbidden_exercise_types: Mapped[list[str]] = mapped_column(JSON)
    tone: Mapped[str | None] = mapped_column(Text)
    feedback_mode: Mapped[str] = mapped_column(String(20))
    retry_with_hint: Mapped[bool]
    second_round: Mapped[bool]
    notes: Mapped[str | None] = mapped_column(Text)
