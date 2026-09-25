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


class MaterialRelease(InstanceOwned, Base):
    """A version of a classroom material released to a run's students to complete in the app
    (ADR 0011). The version never changes; a corrected material is released again."""

    __tablename__ = "material_release"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("course_run.id", ondelete="CASCADE"), index=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("classroom_material.id"), index=True)
    version_id: Mapped[int] = mapped_column(ForeignKey("classroom_material_version.id"))
    # "run" for everyone on the roster, now and later; "chosen" for the students listed.
    audience: Mapped[str] = mapped_column(String(10))
    # "immediate" or "at_the_end", as for a lesson.
    feedback_mode: Mapped[str] = mapped_column(String(20))
    due_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    # After the due date: "accept" and mark late, or "refuse".
    late_submissions: Mapped[str] = mapped_column(String(10))
    # "one", or "repeated" where the last submitted counts.
    attempts: Mapped[str] = mapped_column(String(10))
    show_solutions: Mapped[bool]
    released_by_id: Mapped[int] = mapped_column(ForeignKey("account.id"))
    released_at: Mapped[datetime] = mapped_column(UTCDateTime)


class ReleaseStudent(InstanceOwned, Base):
    """A student a release was chosen for."""

    __tablename__ = "release_student"

    release_id: Mapped[int] = mapped_column(
        ForeignKey("material_release.id", ondelete="CASCADE"), primary_key=True
    )
    student_id: Mapped[int] = mapped_column(
        ForeignKey("account.id", ondelete="CASCADE"), primary_key=True, index=True
    )


erasure.register(erasure.Rule(table="run_student", student_column="student_id"))
erasure.register(erasure.Rule(table="release_student", student_column="student_id"))
