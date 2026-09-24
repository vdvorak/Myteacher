"""Classes, maintained by any teacher on the instance so that a substitute is never blocked."""

from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from myteacher.accounts import consent, service
from myteacher.accounts.consent import StudentState
from myteacher.accounts.models import Account
from myteacher.api.deps import Db, Now, requires
from myteacher.classes import service as classes
from myteacher.classes.models import SchoolClass
from myteacher.persistence import InstanceSession
from myteacher.policy import is_teacher

router = APIRouter(prefix="/classes", tags=["classes"])
Teacher = Annotated[Account, requires(is_teacher)]

ClassName = Annotated[str, AfterValidator(str.strip), Field(min_length=1, max_length=100)]


class ClassSummary(BaseModel):
    id: int
    name: str
    member_count: int


class Member(BaseModel):
    id: int
    name: str
    email: str
    state: StudentState


class ClassOut(BaseModel):
    id: int
    name: str
    # The current members by name, deactivated ones included.
    members: list[Member]


class ClassIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ClassName


def _class(db: InstanceSession, class_id: int) -> SchoolClass:
    klass = classes.get_class(db, class_id)
    if klass is None:
        raise HTTPException(status_code=404)
    return klass


def _student(db: InstanceSession, student_id: int) -> Account:
    student = service.get_account(db, student_id)
    if student is None or student.kind != "student":
        raise HTTPException(status_code=404)
    if student.erased_at is not None:
        # Erasure took the student out of every class; nothing puts them back.
        raise HTTPException(status_code=410, detail="student_erased")
    return student


def _out(db: InstanceSession, klass: SchoolClass) -> ClassOut:
    consents = consent.latest_consents(db)
    return ClassOut(
        id=klass.id,
        name=klass.name,
        members=[
            Member(
                id=student.id,
                name=student.name or "",
                email=student.email,
                state=consent.student_state(student, consents.get(student.id)),
            )
            for student in classes.members(db, klass)
        ],
    )


@router.get("")
def list_classes(db: Db, _: Teacher) -> list[ClassSummary]:
    """Every class on the instance, by name."""
    return [
        ClassSummary(id=klass.id, name=klass.name, member_count=count)
        for klass, count in classes.list_classes(db)
    ]


@router.post("", status_code=201, responses={409: {"description": "Name taken"}})
def create_class(body: ClassIn, db: Db, now: Now, _: Teacher) -> ClassOut:
    try:
        klass = classes.create_class(db, body.name, now=now)
    except classes.NameTaken:
        raise HTTPException(status_code=409, detail="name_taken") from None
    return _out(db, klass)


@router.get("/{class_id}")
def read_class(class_id: int, db: Db, _: Teacher) -> ClassOut:
    return _out(db, _class(db, class_id))


@router.patch("/{class_id}", responses={409: {"description": "Name taken"}})
def rename_class(class_id: int, body: ClassIn, db: Db, _: Teacher) -> ClassOut:
    klass = _class(db, class_id)
    try:
        classes.rename_class(db, klass, body.name)
    except classes.NameTaken:
        raise HTTPException(status_code=409, detail="name_taken") from None
    return _out(db, klass)


@router.put("/{class_id}/members/{student_id}")
def add_member(class_id: int, student_id: int, db: Db, _: Teacher) -> ClassOut:
    """Put a student in the class; adding a member again changes nothing."""
    klass = _class(db, class_id)
    classes.add_member(db, klass, _student(db, student_id))
    return _out(db, klass)


@router.delete("/{class_id}/members/{student_id}")
def remove_member(class_id: int, student_id: int, db: Db, _: Teacher) -> ClassOut:
    """Take a student out of the class; their account and history stay."""
    klass = _class(db, class_id)
    classes.remove_member(db, klass, _student(db, student_id))
    return _out(db, klass)
