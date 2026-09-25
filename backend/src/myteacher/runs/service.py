"""Course runs and their enrolments. The roster is resolved at read time from the live class
membership, so nothing about students is copied into a run."""

from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import delete, func, select, union
from sqlalchemy.exc import IntegrityError

from myteacher.accounts.models import Account
from myteacher.classes.models import ClassMembership, SchoolClass
from myteacher.persistence import InstanceSession
from myteacher.runs.models import CourseRun, RunClass, RunStudent


@dataclass
class RosterEntry:
    student: Account
    # Enrolled on their own, not only through a class.
    direct: bool = False
    # The enrolled classes they are in, by name.
    classes: list[str] = field(default_factory=list)


def get_run(db: InstanceSession, run_id: int) -> CourseRun | None:
    return db.scalars(select(CourseRun).where(CourseRun.id == run_id)).first()


def start_run(
    db: InstanceSession, course_id: int, teacher: Account, name: str, *, now: datetime
) -> CourseRun:
    run = CourseRun(course_id=course_id, teacher_id=teacher.id, name=name, created_at=now)
    db.add(run)
    db.flush()
    return run


def runs_of(db: InstanceSession, course_id: int, teacher: Account) -> list[CourseRun]:
    """The runs of the course the teacher teaches, by name."""
    return list(
        db.scalars(
            select(CourseRun)
            .where(CourseRun.course_id == course_id, CourseRun.teacher_id == teacher.id)
            .order_by(CourseRun.name, CourseRun.id)
        )
    )


def runs_taught_by(db: InstanceSession, teacher: Account) -> list[CourseRun]:
    """Every run the teacher teaches, across courses."""
    return list(db.scalars(select(CourseRun).where(CourseRun.teacher_id == teacher.id)))


def enrolled_classes(db: InstanceSession, run: CourseRun) -> list[tuple[SchoolClass, int]]:
    """The run's classes by name, with how many students are in each now."""
    counts = (
        select(ClassMembership.class_id, func.count().label("members"))
        .group_by(ClassMembership.class_id)
        .subquery()
    )
    rows = db.execute(
        select(SchoolClass, func.coalesce(counts.c.members, 0))
        .join(RunClass, RunClass.class_id == SchoolClass.id)
        .outerjoin(counts, counts.c.class_id == SchoolClass.id)
        .where(RunClass.run_id == run.id)
        .order_by(SchoolClass.name)
    )
    return [(klass, members) for klass, members in rows.tuples()]


def enrolled_students(db: InstanceSession, run: CourseRun) -> list[Account]:
    """The students enrolled directly, by name, whatever the state of their account."""
    return list(
        db.scalars(
            select(Account)
            .join(RunStudent, RunStudent.student_id == Account.id)
            .where(RunStudent.run_id == run.id)
            .order_by(Account.name, Account.email)
        )
    )


def roster(db: InstanceSession, run: CourseRun) -> list[RosterEntry]:
    """Every student of the run now, by name: enrolled directly or in an enrolled class, and with
    an account that works. A minor without consent is never active, so is never on it."""
    direct = select(RunStudent.student_id).where(RunStudent.run_id == run.id)
    in_classes = (
        select(ClassMembership.student_id)
        .join(RunClass, RunClass.class_id == ClassMembership.class_id)
        .where(RunClass.run_id == run.id)
    )
    class_names: dict[int, list[str]] = {}
    for student_id, name in db.execute(
        in_classes.add_columns(SchoolClass.name)
        .join(SchoolClass, SchoolClass.id == ClassMembership.class_id)
        .order_by(SchoolClass.name)
    ).tuples():
        class_names.setdefault(student_id, []).append(name)
    direct_ids = set(db.scalars(direct))
    enrolled = union(direct, in_classes)
    students = db.scalars(
        select(Account)
        .where(Account.id.in_(enrolled), Account.active.is_(True), Account.erased_at.is_(None))
        .order_by(Account.name, Account.email)
    )
    return [
        RosterEntry(
            student=student,
            direct=student.id in direct_ids,
            classes=class_names.get(student.id, []),
        )
        for student in students
    ]


def roster_sizes(db: InstanceSession, runs: list[CourseRun]) -> dict[int, int]:
    return {run.id: len(roster(db, run)) for run in runs}


def _add_once(db: InstanceSession, row: RunClass | RunStudent, key: dict[str, int]) -> None:
    """Add the enrolment; one that exists already, or that another request added meanwhile,
    is the same outcome."""
    if db.get(type(row), key) is not None:
        return
    savepoint = db.begin_nested()
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        savepoint.rollback()
        return
    savepoint.commit()


def enrol_class(db: InstanceSession, run: CourseRun, klass: SchoolClass) -> None:
    key = {"run_id": run.id, "class_id": klass.id}
    _add_once(db, RunClass(**key), key)


def unenrol_class(db: InstanceSession, run: CourseRun, klass: SchoolClass) -> None:
    db.execute(delete(RunClass).where(RunClass.run_id == run.id, RunClass.class_id == klass.id))


def enrol_student(db: InstanceSession, run: CourseRun, student: Account) -> None:
    key = {"run_id": run.id, "student_id": student.id}
    _add_once(db, RunStudent(**key), key)


def unenrol_student(db: InstanceSession, run: CourseRun, student: Account) -> None:
    db.execute(
        delete(RunStudent).where(RunStudent.run_id == run.id, RunStudent.student_id == student.id)
    )


def runs_of_student(db: InstanceSession, student: Account) -> list[int]:
    """The ids of the runs the student is enrolled in, directly or through a class."""
    direct = select(RunStudent.run_id).where(RunStudent.student_id == student.id)
    in_classes = (
        select(RunClass.run_id)
        .join(ClassMembership, ClassMembership.class_id == RunClass.class_id)
        .where(ClassMembership.student_id == student.id)
    )
    return list(db.scalars(union(direct, in_classes)))
