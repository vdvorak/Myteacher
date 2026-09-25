from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, String, UniqueConstraint
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


class Attempt(InstanceOwned, Base):
    """One student's pass through a release's version, from opening to submission (ADR 0011).
    The server owns it: it holds the seed, pins the variants and counts the tries."""

    __tablename__ = "attempt"
    __table_args__ = (UniqueConstraint("release_id", "student_id", "number"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    release_id: Mapped[int] = mapped_column(
        ForeignKey("material_release.id", ondelete="CASCADE"), index=True
    )
    student_id: Mapped[int] = mapped_column(
        ForeignKey("account.id", ondelete="CASCADE"), index=True
    )
    # 1 for the first attempt at the release; more where the release allows repeating.
    number: Mapped[int]
    # Decides the layouts and the second round's variants; never chosen by the browser.
    seed: Mapped[str] = mapped_column(String(64))
    started_at: Mapped[datetime] = mapped_column(UTCDateTime)
    # Set once the first pass was submitted; the second round is practice after it.
    submitted_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    # Submitted after the release's due date.
    late: Mapped[bool] = mapped_column(default=False)
    # The exercises the second round repeats, once the student started it.
    second_round: Mapped[list[str] | None] = mapped_column(JSON)
    # Set once the second round was submitted, with feedback at the end.
    second_submitted_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class AttemptDraft(InstanceOwned, Base):
    """The answer a student is composing to one exercise of a round, saved as it is given so
    the attempt continues on another device."""

    __tablename__ = "attempt_draft"

    attempt_id: Mapped[int] = mapped_column(
        ForeignKey("attempt.id", ondelete="CASCADE"), primary_key=True
    )
    # "first" or "second".
    round: Mapped[str] = mapped_column(String(10), primary_key=True)
    exercise_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    answer: Mapped[dict[str, Any]] = mapped_column(JSON)


class Assessment(InstanceOwned, Base):
    """One try at one exercise of an attempt's round, with its outcome as assessed, solution
    included; whether the student sees the solution is decided when it is served."""

    __tablename__ = "assessment"
    __table_args__ = (UniqueConstraint("attempt_id", "round", "exercise_id", "number"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    attempt_id: Mapped[int] = mapped_column(
        ForeignKey("attempt.id", ondelete="CASCADE"), index=True
    )
    round: Mapped[str] = mapped_column(String(10))
    exercise_id: Mapped[str] = mapped_column(String(100))
    # 1 for the first try; with immediate feedback a wrong first try earns a second.
    number: Mapped[int]
    answer: Mapped[dict[str, Any]] = mapped_column(JSON)
    outcome: Mapped[dict[str, Any]] = mapped_column(JSON)
    # "assessed", or "pending" for an open answer waiting for the teacher.
    status: Mapped[str] = mapped_column(String(20))
    score: Mapped[float | None]
    correct: Mapped[bool | None]
    assessed_at: Mapped[datetime] = mapped_column(UTCDateTime)


class AssessmentConcept(InstanceOwned, Base):
    """A concept of the topic's map an assessment is about, so concept states (slice 4) can be
    derived from attempts made before them."""

    __tablename__ = "assessment_concept"

    assessment_id: Mapped[int] = mapped_column(
        ForeignKey("assessment.id", ondelete="CASCADE"), primary_key=True
    )
    concept_id: Mapped[int] = mapped_column(
        ForeignKey("concept.id", ondelete="CASCADE"), primary_key=True, index=True
    )


erasure.register(erasure.Rule(table="run_student", student_column="student_id"))
erasure.register(erasure.Rule(table="release_student", student_column="student_id"))
# The student's answers go with the attempt: drafts and assessments cascade.
erasure.register(erasure.Rule(table="attempt", student_column="student_id"))
