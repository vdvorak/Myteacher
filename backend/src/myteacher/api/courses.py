"""Courses and their briefs, seen and changed as the course's access list allows (ADR 0008)."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_serializer, field_validator

from myteacher.accounts.models import Account
from myteacher.api.deps import Db, Now, requires
from myteacher.courses import service as courses
from myteacher.courses.brief import BriefText, CourseBrief, ExerciseTypes
from myteacher.courses.models import Course
from myteacher.lesson.schema import FeedbackMode, LanguageTag
from myteacher.persistence import InstanceSession
from myteacher.policy import (
    CourseAccessLevel,
    can_edit_course,
    can_fork_course,
    can_manage_course_access,
    can_view_course,
    course_access,
    is_teacher,
)

router = APIRouter(prefix="/courses", tags=["courses"])
Teacher = Annotated[Account, requires(is_teacher)]

Text = Annotated[str, AfterValidator(str.strip), Field(min_length=1, max_length=200)]


class CourseSummary(BaseModel):
    id: int
    name: str
    subject: str
    taught_language: str | None
    instruction_language: str
    # What the actor may do with the course.
    access: CourseAccessLevel

    @classmethod
    def of(cls, course: Course, actor: Account) -> "CourseSummary":
        access = course_access(actor, course)
        assert access is not None, "a course the actor may not see is never listed"
        return cls(
            id=course.id,
            name=course.name,
            subject=course.subject,
            taught_language=course.taught_language,
            instruction_language=course.instruction_language,
            access=access,
        )


class CourseOut(CourseSummary):
    owner_id: int
    created_at: datetime
    brief: CourseBrief
    # Whether the actor may change the course; viewers see it read-only.
    can_edit: bool
    # Whether the actor may change the access list and transfer the ownership.
    can_manage_access: bool
    # Whether the actor may make their own copy of the course.
    can_fork: bool
    # The course this one was forked from; None when it was not, or the origin is gone.
    forked_from_id: int | None

    @field_serializer("created_at")
    def _utc(self, at: datetime) -> str:
        return at.strftime("%Y-%m-%dT%H:%M:%SZ")

    @classmethod
    def of(cls, course: Course, actor: Account) -> "CourseOut":
        return cls(
            **CourseSummary.of(course, actor).model_dump(),
            owner_id=course.owner_id,
            created_at=course.created_at,
            brief=courses.brief_of(course),
            can_edit=can_edit_course(actor, course),
            can_manage_access=can_manage_course_access(actor, course),
            can_fork=can_fork_course(actor, course),
            forked_from_id=course.forked_from_id,
        )


class CourseIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Text
    subject: Text
    # None when the subject is not a language.
    taught_language: LanguageTag | None
    instruction_language: LanguageTag


class CourseChange(BaseModel):
    """Only the fields present change; only the taught language can be unset."""

    model_config = ConfigDict(extra="forbid")

    name: Text | None = None
    subject: Text | None = None
    taught_language: LanguageTag | None = None
    instruction_language: LanguageTag | None = None

    @field_validator("name", "subject", "instruction_language")
    @classmethod
    def _cannot_be_unset(cls, value: object) -> object:
        # Validators skip defaults, so this only refuses an explicit null.
        if value is None:
            raise ValueError("can be changed but not unset")
        return value


class BriefChange(BaseModel):
    """Only the fields present change. Text fields are cleared with null or blank text."""

    model_config = ConfigDict(extra="forbid")

    audience: BriefText = None
    level: BriefText = None
    goals: BriefText = None
    timeframe: BriefText = None
    preferred_exercise_types: ExerciseTypes | None = None
    forbidden_exercise_types: ExerciseTypes | None = None
    tone: BriefText = None
    feedback_mode: FeedbackMode | None = None
    retry_with_hint: bool | None = None
    second_round: bool | None = None
    notes: BriefText = None

    @field_validator(
        "preferred_exercise_types",
        "forbidden_exercise_types",
        "feedback_mode",
        "retry_with_hint",
        "second_round",
    )
    @classmethod
    def _cannot_be_unset(cls, value: object) -> object:
        if value is None:
            raise ValueError("can be changed but not unset")
        return value


def course_for(db: InstanceSession, actor: Account, course_id: int) -> Course:
    """The course, or 404 for one the actor may not see, so its existence does not leak."""
    course = courses.get_course(db, course_id)
    if course is None or not can_view_course(actor, course):
        raise HTTPException(status_code=404)
    return course


def editable_course(db: InstanceSession, actor: Account, course_id: int) -> Course:
    course = course_for(db, actor, course_id)
    if not can_edit_course(actor, course):
        raise HTTPException(status_code=403, detail="forbidden")
    return course


@router.get("")
def list_courses(db: Db, actor: Teacher) -> list[CourseSummary]:
    """The courses the actor owns or was given a right to, by name."""
    return [CourseSummary.of(course, actor) for course in courses.visible_courses(db, actor)]


@router.post("", status_code=201)
def create_course(body: CourseIn, db: Db, now: Now, actor: Teacher) -> CourseOut:
    """A new course owned by the actor, with an empty brief."""
    course = courses.create_course(
        db,
        actor,
        name=body.name,
        subject=body.subject,
        taught_language=body.taught_language,
        instruction_language=body.instruction_language,
        now=now,
    )
    return CourseOut.of(course, actor)


@router.get("/{course_id}")
def read_course(course_id: int, db: Db, actor: Teacher) -> CourseOut:
    return CourseOut.of(course_for(db, actor, course_id), actor)


@router.patch("/{course_id}")
def change_course(course_id: int, body: CourseChange, db: Db, actor: Teacher) -> CourseOut:
    course = editable_course(db, actor, course_id)
    for field in body.model_fields_set:
        setattr(course, field, getattr(body, field))
    return CourseOut.of(course, actor)


@router.patch(
    "/{course_id}/brief",
    responses={409: {"description": "A type would be both preferred and forbidden"}},
)
def change_brief(course_id: int, body: BriefChange, db: Db, actor: Teacher) -> CourseBrief:
    """Change the brief field by field; the fields left out keep their value."""
    course = editable_course(db, actor, course_id)
    try:
        return courses.change_brief(course, body.model_dump(include=body.model_fields_set))
    except courses.TypePreferredAndForbidden:
        raise HTTPException(status_code=409, detail="type_preferred_and_forbidden") from None
