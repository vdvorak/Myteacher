"""Classes and their live membership: nothing about members is copied anywhere."""

from collections.abc import Callable
from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from myteacher.accounts.models import Account
from myteacher.classes.models import ClassMembership, SchoolClass
from myteacher.persistence import InstanceSession


class NameTaken(Exception):
    pass


def list_classes(db: InstanceSession) -> list[tuple[SchoolClass, int]]:
    """Every class by name, with how many students are in it."""
    counts = (
        select(ClassMembership.class_id, func.count().label("members"))
        .group_by(ClassMembership.class_id)
        .subquery()
    )
    rows = db.execute(
        select(SchoolClass, func.coalesce(counts.c.members, 0))
        .outerjoin(counts, counts.c.class_id == SchoolClass.id)
        .order_by(SchoolClass.name)
    )
    return [(klass, members) for klass, members in rows.tuples()]


def get_class(db: InstanceSession, class_id: int) -> SchoolClass | None:
    return db.scalars(select(SchoolClass).where(SchoolClass.id == class_id)).first()


def _ensure_name_free(db: InstanceSession, name: str, keep: SchoolClass | None = None) -> None:
    holder = db.scalars(select(SchoolClass).where(SchoolClass.name == name)).first()
    if holder is not None and holder is not keep:
        raise NameTaken()


def _with_unique_name(db: InstanceSession, change: Callable[[], None]) -> None:
    """Apply `change` in a savepoint; the unique constraint catches a name taken meanwhile."""
    savepoint = db.begin_nested()
    change()
    try:
        db.flush()
    except IntegrityError:
        savepoint.rollback()
        raise NameTaken() from None
    savepoint.commit()


def create_class(db: InstanceSession, name: str, *, now: datetime) -> SchoolClass:
    _ensure_name_free(db, name)
    klass = SchoolClass(name=name, created_at=now)
    _with_unique_name(db, lambda: db.add(klass))
    return klass


def rename_class(db: InstanceSession, klass: SchoolClass, name: str) -> None:
    _ensure_name_free(db, name, keep=klass)
    _with_unique_name(db, lambda: setattr(klass, "name", name))


def members(db: InstanceSession, klass: SchoolClass) -> list[Account]:
    return list(
        db.scalars(
            select(Account)
            .join(ClassMembership, ClassMembership.student_id == Account.id)
            .where(ClassMembership.class_id == klass.id)
            .order_by(Account.name, Account.email)
        )
    )


def _is_member(db: InstanceSession, klass: SchoolClass, student: Account) -> bool:
    found = db.scalars(
        select(ClassMembership.class_id).where(
            ClassMembership.class_id == klass.id, ClassMembership.student_id == student.id
        )
    ).first()
    return found is not None


def add_member(db: InstanceSession, klass: SchoolClass, student: Account) -> None:
    """Put the student in the class; a no-op when they are in it already."""
    if _is_member(db, klass, student):
        return
    savepoint = db.begin_nested()
    db.add(ClassMembership(class_id=klass.id, student_id=student.id))
    try:
        db.flush()
    except IntegrityError:
        # Another request added them in the meantime, which is the same outcome.
        savepoint.rollback()
        return
    savepoint.commit()


def remove_member(db: InstanceSession, klass: SchoolClass, student: Account) -> None:
    db.execute(
        delete(ClassMembership).where(
            ClassMembership.class_id == klass.id, ClassMembership.student_id == student.id
        )
    )


def classes_of(db: InstanceSession, student: Account) -> list[SchoolClass]:
    """The classes the student is in now, by name."""
    return list(
        db.scalars(
            select(SchoolClass)
            .join(ClassMembership, ClassMembership.class_id == SchoolClass.id)
            .where(ClassMembership.student_id == student.id)
            .order_by(SchoolClass.name)
        )
    )


def classes_by_student(db: InstanceSession) -> dict[int, list[SchoolClass]]:
    """Each student's classes by name, keyed by student id."""
    rows = db.execute(
        select(ClassMembership.student_id, SchoolClass)
        .join(SchoolClass, SchoolClass.id == ClassMembership.class_id)
        .order_by(SchoolClass.name)
    )
    found: dict[int, list[SchoolClass]] = {}
    for student_id, klass in rows.tuples():
        found.setdefault(student_id, []).append(klass)
    return found
