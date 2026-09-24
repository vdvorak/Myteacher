from datetime import datetime
from typing import Any, Literal

from sqlalchemy import JSON, ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from myteacher.persistence import Base, InstanceOwned, UTCDateTime

# What a teacher on a course's access list may do, each right including the ones before it.
CourseRight = Literal["view", "fork", "edit"]


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
    # The teachers the owner shared the course with; the owner is never on it.
    access: Mapped[list["CourseAccess"]] = relationship(
        lazy="selectin", cascade="all, delete-orphan"
    )


class CourseAccess(InstanceOwned, Base):
    """One teacher's right to a course, granted by its owner (ADR 0008)."""

    __tablename__ = "course_access"

    course_id: Mapped[int] = mapped_column(
        ForeignKey("course.id", ondelete="CASCADE"), primary_key=True
    )
    teacher_id: Mapped[int] = mapped_column(ForeignKey("account.id"), primary_key=True, index=True)
    right: Mapped[str] = mapped_column(String(10))
    granted_at: Mapped[datetime] = mapped_column(UTCDateTime)


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


class Topic(InstanceOwned, Base):
    """A teacher-defined unit of a course, in the order the teacher teaches."""

    __tablename__ = "topic"

    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("course.id", ondelete="CASCADE"), index=True)
    # 0-based and without gaps within the course.
    position: Mapped[int]
    name: Mapped[str] = mapped_column(String(200))
    # Whether the topic starts with a diagnostic lesson; runs in slice 4 read it.
    diagnostic_wanted: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)


class Interview(InstanceOwned, Base):
    """The teacher interview of a course: its rounds of questions with the teacher's answers.

    The brief, not this transcript, is what generations are based on; the transcript is kept
    as context for later rounds and for the generation records.
    """

    __tablename__ = "interview"
    # At most one active interview per course, even when two requests start one at once.
    __table_args__ = (
        Index(
            "one_active_interview",
            "course_id",
            unique=True,
            sqlite_where=text("state = 'active'"),
            postgresql_where=text("state = 'active'"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("course.id", ondelete="CASCADE"), index=True)
    # "active" while rounds go on, "finished" once the brief was patched, "ended" when the
    # teacher stopped it early.
    state: Mapped[str] = mapped_column(String(20))
    # [{"questions": [{"question", "recommended_answer"}], "answers": [str] | None}]
    rounds: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    # Set when the interview finished: whether the teacher named sources, and the summary.
    sources_offered: Mapped[bool | None]
    summary: Mapped[str | None] = mapped_column(Text)
    # The latest job working on the interview.
    job_id: Mapped[int | None] = mapped_column(ForeignKey("job.id", ondelete="SET NULL"))
    started_by_id: Mapped[int] = mapped_column(ForeignKey("account.id"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
    # Checked on every write, so that of two concurrent changes (two answers, an answer and
    # the end, the job's result and the end) the second fails instead of overwriting the first.
    version: Mapped[int] = mapped_column(default=1)

    __mapper_args__ = {"version_id_col": version}
