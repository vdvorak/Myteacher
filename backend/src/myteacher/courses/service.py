"""Courses and their briefs. Who may see a course is decided in `myteacher.policy`."""

from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import object_session

from myteacher.accounts.models import Account
from myteacher.courses.brief import CourseBrief
from myteacher.courses.models import Course, CourseAccess, CourseBriefRow, Interview, Source
from myteacher.persistence import InstanceSession


class TypePreferredAndForbidden(Exception):
    pass


def visible_courses(db: InstanceSession, teacher: Account) -> list[Course]:
    """The courses the teacher owns or is on the access list of, by name."""
    shared = select(CourseAccess.course_id).where(CourseAccess.teacher_id == teacher.id)
    return list(
        db.scalars(
            select(Course)
            .where(or_(Course.owner_id == teacher.id, Course.id.in_(shared)))
            .order_by(Course.name)
        )
    )


def get_course(db: InstanceSession, course_id: int) -> Course | None:
    return db.scalars(select(Course).where(Course.id == course_id)).first()


def create_course(
    db: InstanceSession,
    owner: Account,
    *,
    name: str,
    subject: str,
    taught_language: str | None,
    instruction_language: str,
    now: datetime,
) -> Course:
    course = Course(
        owner_id=owner.id,
        name=name,
        subject=subject,
        taught_language=taught_language,
        instruction_language=instruction_language,
        created_at=now,
        brief=CourseBriefRow(**CourseBrief().model_dump(mode="json")),
    )
    db.add(course)
    db.flush()
    return course


def setup_of(course: Course) -> dict[str, object]:
    """The facts the course's steps are read from."""
    db = object_session(course)
    assert db is not None, "a course is read from a session"
    finished = select(Interview.id).where(
        Interview.course_id == course.id, Interview.state == "finished"
    )
    read = select(func.count()).where(Source.course_id == course.id, Source.text.is_not(None))
    return {
        "interview_finished": db.scalar(finished.limit(1)) is not None,
        "brief_confirmed": course.brief_confirmed,
        "read_sources": db.scalar(read) or 0,
        "sources_skipped": course.sources_skipped,
    }


def brief_of(course: Course) -> CourseBrief:
    return CourseBrief.model_validate(
        {field: getattr(course.brief, field) for field in CourseBrief.model_fields}
    )


def change_brief(course: Course, changes: dict[str, object]) -> CourseBrief:
    """Apply the given fields, each already valid on its own, to the course's brief.

    Only the given columns are written, so saving one field never undoes a concurrent save of
    another."""
    brief = brief_of(course).model_copy(update=changes)
    if brief.overlapping_types():
        raise TypePreferredAndForbidden()
    for field in changes:
        setattr(course.brief, field, getattr(brief, field))
    return brief
