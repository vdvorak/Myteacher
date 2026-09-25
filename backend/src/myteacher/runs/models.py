from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from myteacher import erasure
from myteacher.persistence import Base, InstanceOwned, UTCDateTime


class CourseRun(InstanceOwned, Base):
    """One delivery of a course by its teacher (ADR 0008). It points at the course and copies
    nothing of its design."""

    __tablename__ = "course_run"

    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("course.id"), index=True)
    # The teacher who started the run; co-teachers come in slice 4.
    teacher_id: Mapped[int] = mapped_column(ForeignKey("account.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)


class RunClass(InstanceOwned, Base):
    """A class enrolled in a run. Its members are read at request time, so the roster is live."""

    __tablename__ = "run_class"

    run_id: Mapped[int] = mapped_column(
        ForeignKey("course_run.id", ondelete="CASCADE"), primary_key=True
    )
    class_id: Mapped[int] = mapped_column(
        ForeignKey("school_class.id", ondelete="CASCADE"), primary_key=True, index=True
    )


class RunStudent(InstanceOwned, Base):
    """A student enrolled in a run directly, not through a class."""

    __tablename__ = "run_student"

    run_id: Mapped[int] = mapped_column(
        ForeignKey("course_run.id", ondelete="CASCADE"), primary_key=True
    )
    student_id: Mapped[int] = mapped_column(
        ForeignKey("account.id", ondelete="CASCADE"), primary_key=True, index=True
    )


erasure.register(erasure.Rule(table="run_student", student_column="student_id"))
