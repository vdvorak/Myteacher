"""The access list of a course and its ownership, both managed by the owner (ADR 0008).

What each right allows is decided in `myteacher.policy`; this module only keeps the list and
records every change in the audit log."""

from datetime import datetime

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import StaleDataError

from myteacher.accounts.models import Account
from myteacher.accounts.service import find_account_by_email, record_event
from myteacher.courses.models import Course, CourseAccess, CourseRight
from myteacher.persistence import InstanceSession


class NotATeacher(Exception):
    """No teacher has the email."""


class IsOwner(Exception):
    """The teacher already owns the course."""


class NotListed(Exception):
    """The teacher is not on the course's access list."""


class AccessChanged(Exception):
    """Another request changed the same entry, or the ownership, first."""


def entries(db: InstanceSession, course: Course) -> list[tuple[CourseAccess, Account]]:
    """The access list with each teacher's account, by email."""
    rows = db.execute(
        select(CourseAccess, Account)
        .join(Account, Account.id == CourseAccess.teacher_id)
        .where(CourseAccess.course_id == course.id)
        .order_by(Account.email)
    )
    return [(entry, account) for entry, account in rows.tuples()]


def teacher_by_email(db: InstanceSession, email: str) -> Account:
    account = find_account_by_email(db, email)
    if account is None or account.kind != "teacher":
        raise NotATeacher()
    return account


def entry_of(course: Course, teacher_id: int) -> CourseAccess | None:
    return next((entry for entry in course.access if entry.teacher_id == teacher_id), None)


def _hold_ownership(db: InstanceSession, course: Course) -> None:
    """Take the course's row for the rest of the transaction, as long as its owner is still the
    one this request read; otherwise `AccessChanged`.

    Every change of the list or the ownership starts here, so they run one after another and
    none acts on an ownership another request has just given away."""
    held = db.execute(
        update(Course)
        .where(Course.id == course.id, Course.owner_id == course.owner_id)
        .values(owner_id=Course.owner_id)
        .execution_options(synchronize_session=False)
    )
    if held.rowcount != 1:  # type: ignore[attr-defined]
        raise AccessChanged()


def _written(db: InstanceSession) -> None:
    """Flush the change, turning a concurrent change of the same entry into `AccessChanged`."""
    try:
        with db.begin_nested():
            db.flush()
    except (IntegrityError, StaleDataError):
        raise AccessChanged() from None


def grant(
    db: InstanceSession,
    course: Course,
    teacher: Account,
    right: CourseRight,
    *,
    actor: Account,
    now: datetime,
) -> None:
    """Give the teacher the right, replacing the one they had."""
    _hold_ownership(db, course)
    if teacher.id == course.owner_id:
        raise IsOwner()
    entry = entry_of(course, teacher.id)
    if entry is None:
        course.access.append(CourseAccess(teacher_id=teacher.id, right=right, granted_at=now))
        kind = "course_access_granted"
    elif entry.right != right:
        entry.right = right
        kind = "course_access_changed"
    else:
        return
    _written(db)
    record_event(db, kind, at=now, actor=actor, subject=teacher, course_id=course.id, detail=right)


def change(
    db: InstanceSession,
    course: Course,
    teacher: Account,
    right: CourseRight,
    *,
    actor: Account,
    now: datetime,
) -> None:
    if entry_of(course, teacher.id) is None:
        raise NotListed()
    grant(db, course, teacher, right, actor=actor, now=now)


def remove(
    db: InstanceSession, course: Course, teacher: Account, *, actor: Account, now: datetime
) -> None:
    _hold_ownership(db, course)
    entry = entry_of(course, teacher.id)
    if entry is None:
        raise NotListed()
    course.access.remove(entry)
    _written(db)
    record_event(
        db, "course_access_removed", at=now, actor=actor, subject=teacher, course_id=course.id
    )


def transfer(
    db: InstanceSession,
    course: Course,
    new_owner: Account,
    *,
    previous_owner_keeps: CourseRight | None,
    actor: Account,
    now: datetime,
) -> None:
    """Make another teacher the owner. The previous owner keeps no right unless given one."""
    _hold_ownership(db, course)
    if new_owner.id == course.owner_id:
        raise IsOwner()
    previous = db.get_one(Account, course.owner_id)
    # From the database, not the list read earlier: the owner is never on the list.
    db.execute(
        delete(CourseAccess)
        .where(CourseAccess.course_id == course.id, CourseAccess.teacher_id == new_owner.id)
        .execution_options(synchronize_session=False)
    )
    db.expire(course, ["access"])
    course.owner_id = new_owner.id
    _written(db)
    record_event(
        db,
        "course_ownership_transferred",
        at=now,
        actor=actor,
        subject=new_owner,
        course_id=course.id,
    )
    if previous_owner_keeps is not None:
        grant(db, course, previous, previous_owner_keeps, actor=actor, now=now)
