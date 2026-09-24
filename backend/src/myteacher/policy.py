"""Authorisation predicates, applied at the API layer. Later slices add run access here.

A predicate answers whether an actor may do something; it never raises. The API turns a false
answer into 403 with `requires` (predicates of the actor alone) or `ensure` (predicates that also
look at a target).
"""

from collections.abc import Callable
from typing import Literal

from myteacher.accounts.models import Account
from myteacher.courses.models import Course, CourseRight

Predicate = Callable[[Account], bool]
CourseAccessLevel = Literal[CourseRight, "owner"]
# Each level includes the ones before it.
_LEVELS: tuple[CourseAccessLevel, ...] = ("view", "fork", "edit", "owner")


def is_teacher(actor: Account) -> bool:
    return actor.kind == "teacher"


def is_admin(actor: Account) -> bool:
    return is_teacher(actor) and actor.is_admin


def is_account_itself(actor: Account, account_id: int) -> bool:
    return actor.id == account_id


def course_access(actor: Account, course: Course) -> CourseAccessLevel | None:
    """What the actor may do with the course: own it, a right from its access list, or nothing.

    The admin has no right to a course by being the admin."""
    if not is_teacher(actor):
        return None
    if course.owner_id == actor.id:
        return "owner"
    entry = next((e for e in course.access if e.teacher_id == actor.id), None)
    return entry.right if entry else None  # type: ignore[return-value]


def _at_least(actor: Account, course: Course, level: CourseAccessLevel) -> bool:
    held = course_access(actor, course)
    return held is not None and _LEVELS.index(held) >= _LEVELS.index(level)


def can_view_course(actor: Account, course: Course) -> bool:
    """Reading the course and everything in it."""
    return _at_least(actor, course, "view")


def can_fork_course(actor: Account, course: Course) -> bool:
    """Making one's own copy of the course."""
    return _at_least(actor, course, "fork")


def can_edit_course(actor: Account, course: Course) -> bool:
    """Changing everything but the access list and the ownership."""
    return _at_least(actor, course, "edit")


def can_manage_course_access(actor: Account, course: Course) -> bool:
    """Changing the access list and transferring the ownership."""
    return _at_least(actor, course, "owner")


def roles(actor: Account) -> list[str]:
    return [actor.kind, *(["admin"] if is_admin(actor) else [])]
