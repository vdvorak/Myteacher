"""Courses and their briefs, seen and changed only by the course's owner for now (ADR 0008)."""

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
from myteacher.policy import can_edit_course, can_view_course, is_teacher

router = APIRouter(prefix="/courses", tags=["courses"])
Teacher = Annotated[Account, requires(is_teacher)]

Text = Annotated[str, AfterValidator(str.strip), Field(min_length=1, max_length=200)]


class CourseSummary(BaseModel):
    id: int
    name: str
    subject: str
    taught_language: str | None
    instruction_language: str


class CourseOut(CourseSummary):
    owner_id: int
    created_at: datetime
    brief: CourseBrief

    @field_serializer("created_at")
    def _utc(self, at: datetime) -> str:
        return at.strftime("%Y-%m-%dT%H:%M:%SZ")

    @classmethod
    def of(cls, course: Course) -> "CourseOut":
        return cls(
            id=course.id,
            name=course.name,
            subject=course.subject,
            taught_language=course.taught_language,
            instruction_language=course.instruction_language,
            owner_id=course.owner_id,
            created_at=course.created_at,
            brief=courses.brief_of(course),
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


def _course(db: InstanceSession, actor: Account, course_id: int) -> Course:
    """The course, or 404 for one the actor may not see, so its existence does not leak."""
    course = courses.get_course(db, course_id)
    if course is None or not can_view_course(actor, course):
        raise HTTPException(status_code=404)
    return course


def _editable(db: InstanceSession, actor: Account, course_id: int) -> Course:
    course = _course(db, actor, course_id)
    if not can_edit_course(actor, course):
        raise HTTPException(status_code=403, detail="forbidden")
    return course


@router.get("")
def list_courses(db: Db, actor: Teacher) -> list[CourseSummary]:
    """The actor's own courses, by name."""
    return [
        CourseSummary(
            id=course.id,
            name=course.name,
            subject=course.subject,
            taught_language=course.taught_language,
            instruction_language=course.instruction_language,
        )
        for course in courses.owned_courses(db, actor)
    ]


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
    return CourseOut.of(course)


@router.get("/{course_id}")
def read_course(course_id: int, db: Db, actor: Teacher) -> CourseOut:
    return CourseOut.of(_course(db, actor, course_id))


@router.patch("/{course_id}")
def change_course(course_id: int, body: CourseChange, db: Db, actor: Teacher) -> CourseOut:
    course = _editable(db, actor, course_id)
    for field in body.model_fields_set:
        setattr(course, field, getattr(body, field))
    return CourseOut.of(course)


@router.patch(
    "/{course_id}/brief",
    responses={409: {"description": "A type would be both preferred and forbidden"}},
)
def change_brief(course_id: int, body: BriefChange, db: Db, actor: Teacher) -> CourseBrief:
    """Change the brief field by field; the fields left out keep their value."""
    course = _editable(db, actor, course_id)
    try:
        return courses.change_brief(course, body.model_dump(include=body.model_fields_set))
    except courses.TypePreferredAndForbidden:
        raise HTTPException(status_code=409, detail="type_preferred_and_forbidden") from None
