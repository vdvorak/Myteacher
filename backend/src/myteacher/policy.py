"""Authorisation predicates, applied at the API layer. Later slices add course and run access here.

A predicate answers whether an actor may do something; it never raises. The API turns a false
answer into 403 with `requires` (predicates of the actor alone) or `ensure` (predicates that also
look at a target).
"""

from collections.abc import Callable

from myteacher.accounts.models import Account
from myteacher.courses.models import Course

Predicate = Callable[[Account], bool]


def is_teacher(actor: Account) -> bool:
    return actor.kind == "teacher"


def is_admin(actor: Account) -> bool:
    return is_teacher(actor) and actor.is_admin


def is_account_itself(actor: Account, account_id: int) -> bool:
    return actor.id == account_id


def can_view_course(actor: Account, course: Course) -> bool:
    # Only the owner until the course access list arrives.
    return is_teacher(actor) and course.owner_id == actor.id


def can_edit_course(actor: Account, course: Course) -> bool:
    return is_teacher(actor) and course.owner_id == actor.id


def roles(actor: Account) -> list[str]:
    return [actor.kind, *(["admin"] if is_admin(actor) else [])]
