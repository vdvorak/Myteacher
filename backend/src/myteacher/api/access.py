"""A course's access list and its ownership, managed by the owner alone (ADR 0008).

Every change of the list answers with the whole list, by email."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from myteacher.accounts.models import Account
from myteacher.accounts.service import get_account
from myteacher.api.courses import course_for
from myteacher.api.deps import Db, Now, requires
from myteacher.courses import access
from myteacher.courses.models import Course, CourseRight
from myteacher.persistence import InstanceSession
from myteacher.policy import can_manage_course_access, is_teacher

router = APIRouter(prefix="/courses/{course_id}", tags=["course access"])
Teacher = Annotated[Account, requires(is_teacher)]

Email = Annotated[str, Field(min_length=1, max_length=320)]

REFUSALS = {
    403: {"description": "Not the owner"},
    409: {"description": "The teacher owns the course, or another change came first"},
    422: {"description": "No teacher has the email"},
}


class AccessEntry(BaseModel):
    teacher_id: int
    email: str
    right: CourseRight


class AccessGrant(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: Email
    right: CourseRight


class AccessChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    right: CourseRight


class OwnershipTransfer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: Email
    # The right the previous owner keeps; by default none.
    previous_owner_keeps: CourseRight | None = None


def managed_course(db: InstanceSession, actor: Account, course_id: int) -> Course:
    course = course_for(db, actor, course_id)
    if not can_manage_course_access(actor, course):
        raise HTTPException(status_code=403, detail="forbidden")
    return course


def listed(db: InstanceSession, course: Course) -> list[AccessEntry]:
    return [
        AccessEntry(teacher_id=entry.teacher_id, email=account.email, right=entry.right)  # type: ignore[arg-type]
        for entry, account in access.entries(db, course)
    ]


def teacher_by_email(db: InstanceSession, email: str) -> Account:
    try:
        return access.teacher_by_email(db, email)
    except access.NotATeacher:
        raise HTTPException(status_code=422, detail="not_a_teacher") from None


def listed_teacher(db: InstanceSession, course: Course, teacher_id: int) -> Account:
    teacher = get_account(db, teacher_id)
    if teacher is None or access.entry_of(course, teacher_id) is None:
        raise HTTPException(status_code=404)
    return teacher


def refusal(error: Exception) -> HTTPException:
    if isinstance(error, access.IsOwner):
        return HTTPException(status_code=409, detail="is_owner")
    return HTTPException(status_code=409, detail="access_changed")


@router.get("/access", responses={403: REFUSALS[403]})
def read_access(course_id: int, db: Db, actor: Teacher) -> list[AccessEntry]:
    return listed(db, managed_course(db, actor, course_id))


@router.post("/access", responses=REFUSALS)
def grant_access(
    course_id: int, body: AccessGrant, db: Db, now: Now, actor: Teacher
) -> list[AccessEntry]:
    """Give a teacher a right to the course, replacing the one they had."""
    course = managed_course(db, actor, course_id)
    teacher = teacher_by_email(db, body.email)
    try:
        access.grant(db, course, teacher, body.right, actor=actor, now=now)
    except (access.IsOwner, access.AccessChanged) as error:
        raise refusal(error) from None
    return listed(db, course)


@router.put("/access/{teacher_id}", responses=REFUSALS)
def change_access(
    course_id: int, teacher_id: int, body: AccessChange, db: Db, now: Now, actor: Teacher
) -> list[AccessEntry]:
    course = managed_course(db, actor, course_id)
    teacher = listed_teacher(db, course, teacher_id)
    try:
        access.change(db, course, teacher, body.right, actor=actor, now=now)
    except access.NotListed:
        raise HTTPException(status_code=404) from None
    except access.AccessChanged as error:
        raise refusal(error) from None
    return listed(db, course)


@router.delete("/access/{teacher_id}", responses=REFUSALS)
def remove_access(
    course_id: int, teacher_id: int, db: Db, now: Now, actor: Teacher
) -> list[AccessEntry]:
    course = managed_course(db, actor, course_id)
    teacher = listed_teacher(db, course, teacher_id)
    try:
        access.remove(db, course, teacher, actor=actor, now=now)
    except access.NotListed:
        raise HTTPException(status_code=404) from None
    except access.AccessChanged as error:
        raise refusal(error) from None
    return listed(db, course)


@router.post("/owner", status_code=204, responses=REFUSALS)
def transfer_ownership(
    course_id: int, body: OwnershipTransfer, db: Db, now: Now, actor: Teacher
) -> Response:
    """Make another teacher the owner; the actor keeps only the right named, if any."""
    course = managed_course(db, actor, course_id)
    new_owner = teacher_by_email(db, body.email)
    try:
        access.transfer(
            db,
            course,
            new_owner,
            previous_owner_keeps=body.previous_owner_keeps,
            actor=actor,
            now=now,
        )
    except (access.IsOwner, access.AccessChanged) as error:
        raise refusal(error) from None
    return Response(status_code=204)
