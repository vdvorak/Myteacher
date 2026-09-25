"""The results of a release for the run teacher (#69). The attempt that counts is a student's last
submitted one; each exercise of its first pass is right, wrong, open (waiting for the teacher) or
not answered."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from sqlalchemy import select

from myteacher.accounts.models import Account
from myteacher.lesson.schema import LessonDocument
from myteacher.persistence import InstanceSession
from myteacher.runs import attempts, releases
from myteacher.runs.models import Attempt, CourseRun, MaterialRelease

Cell = Literal["right", "wrong", "open", "unanswered"]


@dataclass
class StudentResult:
    student: Account
    # Still one of the release's recipients.
    in_run: bool
    standing: attempts.Standing
    # Every attempt not retracted, the first first.
    attempts: list[Attempt]
    # By exercise id, from the attempt that counts; empty without one.
    cells: dict[str, Cell]


def students_of(db: InstanceSession, run: CourseRun, released: MaterialRelease) -> list[Account]:
    """Everyone the release is for, by name: its recipients now, the students chosen for it, and
    whoever made an attempt, in the run or not any more."""
    ids = {student.id for student in releases.recipients(db, run, released)}
    if released.audience == "chosen":
        ids |= {student.id for student in releases.chosen_students(db, released)}
    ids |= set(db.scalars(select(Attempt.student_id).where(Attempt.release_id == released.id)))
    return list(
        db.scalars(select(Account).where(Account.id.in_(ids)).order_by(Account.name, Account.email))
    )


def cells_of(db: InstanceSession, lesson: LessonDocument, attempt: Attempt) -> dict[str, Cell]:
    tries = attempts.tries_of(db, attempt, "first")
    cells: dict[str, Cell] = {}
    for exercise in attempts.exercises(lesson, attempt, "first"):
        last = tries.get(exercise.id, [None])[-1]
        if last is None:
            cells[exercise.id] = "unanswered"
        elif last.status == "pending":
            cells[exercise.id] = "open"
        else:
            cells[exercise.id] = "right" if last.correct else "wrong"
    return cells


def results(
    db: InstanceSession, run: CourseRun, released: MaterialRelease, now: datetime
) -> list[StudentResult]:
    lesson = attempts.lesson_of(db, released)
    in_run = {student.id for student in releases.recipients(db, run, released)}
    found = []
    for student in students_of(db, run, released):
        standing = attempts.standing(db, released, student, now)
        found.append(
            StudentResult(
                student=student,
                in_run=student.id in in_run,
                standing=standing,
                attempts=[
                    a for a in attempts.attempts_of(db, released, student) if a.retracted_at is None
                ],
                cells=cells_of(db, lesson, standing.counting) if standing.counting else {},
            )
        )
    return found
