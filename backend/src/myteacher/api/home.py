"""The teacher's home (#103): what to do now. The getting-started checklist until their first
release, what needs their attention, the courses still being prepared, and for an admin what the
instance still lacks. Everything is read from what the teacher may see and teaches."""

from datetime import datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter
from pydantic import BaseModel, field_serializer
from sqlalchemy import exists, func, select

from myteacher.accounts import consent
from myteacher.accounts import service as accounts
from myteacher.accounts.models import Account
from myteacher.api.deps import Db, Now, requires
from myteacher.api.runs import runs_taught
from myteacher.assistant import generations
from myteacher.assistant.service import paying_credential
from myteacher.classes.models import ClassMembership
from myteacher.courses import service as courses
from myteacher.courses import topics
from myteacher.courses.models import (
    ClassroomMaterial,
    ClassroomMaterialVersion,
    Course,
    ReferenceDocument,
    ReferenceDocumentVersion,
    Topic,
)
from myteacher.mail.store import stored_settings
from myteacher.persistence import InstanceSession
from myteacher.policy import can_edit_course, is_teacher
from myteacher.runs import open_assessment, releases
from myteacher.runs import service as runs
from myteacher.runs.models import CourseRun, MaterialRelease, RunClass, RunStudent

router = APIRouter(prefix="/home", tags=["home"])
Teacher = Annotated[Account, requires(is_teacher)]

# How far ahead a due date needs attention.
DUE_SOON = timedelta(days=3)


class Checklist(BaseModel):
    """Which getting-started steps are done, and where the steps lead."""

    assistant: bool
    # A course with its brief done.
    course: bool
    sources: bool
    concept_map: bool
    material: bool
    # A class with a student in it.
    students: bool
    # A run started; releasing into it ends the checklist.
    run: bool
    # The course last created, its topic with an approved map (or else its first), the run last
    # started.
    course_id: int | None
    topic_id: int | None
    run_id: int | None


AttentionKind = Literal["open_answers", "drafts", "awaiting_consent", "due_soon"]


class AttentionItem(BaseModel):
    kind: AttentionKind
    # Open answers waiting, drafts not reviewed, students awaiting consent; 1 for a due date.
    count: int
    course_id: int | None = None
    course_name: str | None = None
    topic_id: int | None = None
    run_id: int | None = None
    release_id: int | None = None
    # The release's or the topic's.
    title: str | None = None
    due_at: datetime | None = None
    submitted: int | None = None
    total: int | None = None
    # Where drafts are reviewed: the topic's documents or its materials.
    tab: Literal["documents", "materials"] | None = None

    @field_serializer("due_at")
    def _utc(self, at: datetime | None) -> str | None:
        return at.strftime("%Y-%m-%dT%H:%M:%SZ") if at else None


class CourseInPreparation(BaseModel):
    id: int
    name: str
    brief: bool
    sources: bool
    topics: int
    # Topics holding classroom material with a version.
    topics_ready: int


class Instance(BaseModel):
    smtp: bool
    teacher_invited: bool


class Home(BaseModel):
    # None once the teacher released material.
    checklist: Checklist | None
    attention: list[AttentionItem]
    courses: list[CourseInPreparation]
    # For an admin, until email works and a teacher is invited.
    instance: Instance | None


def _brief_done(setup: dict) -> bool:
    return bool(setup["interview_finished"] or setup["brief_confirmed"])


def _sources_done(setup: dict) -> bool:
    return bool(setup["read_sources"] or setup["sources_skipped"])


Made = Literal["documents", "materials"]
_MADE = {
    "documents": (
        ReferenceDocument,
        ReferenceDocumentVersion,
        ReferenceDocumentVersion.document_id,
    ),
    "materials": (
        ClassroomMaterial,
        ClassroomMaterialVersion,
        ClassroomMaterialVersion.material_id,
    ),
}


def _latest_versions(db: InstanceSession, topic_ids: list[int], made: Made):
    """The topic and the generation of each latest version of what the topics hold; an item
    without a version, its generation failed or running, has none."""
    item, version, item_id = _MADE[made]
    latest = (
        select(item_id.label("item_id"), func.max(version.number).label("number"))
        .group_by(item_id)
        .subquery()
    )
    found = (
        select(item.topic_id, version.generation_id)
        .join(latest, latest.c.item_id == item.id)
        .join(version, (item_id == item.id) & (version.number == latest.c.number))
        .where(item.topic_id.in_(topic_ids), item.discarded_at.is_(None))
    )
    return list(db.execute(found).tuples())


def _checklist(
    db: InstanceSession,
    actor: Account,
    editable: list[Course],
    taught: list[CourseRun],
    setups: dict[int, dict],
    held: dict[int, list[Topic]],
    approved: set[int],
    ready: set[int],
) -> Checklist:
    latest = max(editable, key=lambda c: (c.created_at, c.id), default=None)
    topic_id = None
    if latest is not None:
        ordered = [topic.id for topic in held[latest.id]]
        topic_id = next(iter([t for t in ordered if t in approved] or ordered), None)
    last_run = max(taught, key=lambda r: (r.created_at, r.id), default=None)
    return Checklist(
        assistant=paying_credential(db, actor) is not None,
        course=any(_brief_done(setups[c.id]) for c in editable),
        sources=any(_sources_done(setups[c.id]) for c in editable),
        concept_map=bool(approved),
        material=bool(ready),
        students=bool(db.scalar(select(exists().select_from(ClassMembership)))),
        run=bool(taught),
        course_id=latest.id if latest else None,
        topic_id=topic_id,
        run_id=last_run.id if last_run else None,
    )


def _drafts(
    db: InstanceSession, editable: list[Course], held: dict[int, list[Topic]]
) -> tuple[list[AttentionItem], set[int]]:
    """Per topic, the generated documents and then materials the teacher has not reviewed yet;
    and the topics holding a material with a version."""
    topic_ids = [topic.id for course in editable for topic in held[course.id]]
    versions = {made: _latest_versions(db, topic_ids, made) for made in _MADE}
    generated = {g for found in versions.values() for _, g in found if g is not None}
    kept = generations.kept_of(db, generated)
    items = []
    for course in editable:
        for topic in held[course.id]:
            for made, found in versions.items():
                count = sum(t == topic.id and g is not None and g not in kept for t, g in found)
                if count:
                    items.append(
                        AttentionItem(
                            kind="drafts",
                            count=count,
                            course_id=course.id,
                            course_name=course.name,
                            topic_id=topic.id,
                            title=topic.name,
                            tab=made,  # type: ignore[arg-type]
                        )
                    )
    return items, {t for t, _ in versions["materials"]}


def _awaiting_consent(db: InstanceSession, taught: list[CourseRun]) -> list[AttentionItem]:
    """The students of the teacher's runs, directly or through a class, awaiting consent."""
    ids = [run.id for run in taught]
    direct = select(RunStudent.student_id).where(RunStudent.run_id.in_(ids))
    classes = select(RunClass.class_id).where(RunClass.run_id.in_(ids))
    members = select(ClassMembership.student_id).where(ClassMembership.class_id.in_(classes))
    students = db.scalars(
        select(Account).where(Account.id.in_(direct.union(members)), Account.is_minor.is_(True))
    )
    consents = consent.latest_consents(db)
    count = sum(
        consent.student_state(s, consents.get(s.id)) == "awaiting_consent" for s in students
    )
    return [AttentionItem(kind="awaiting_consent", count=count)] if count else []


def _releases(
    db: InstanceSession, taught: dict[CourseRun, Course], now: datetime
) -> tuple[list[AttentionItem], list[AttentionItem]]:
    """The releases not retracted with open answers waiting, and those due in the next days."""
    run_of = {run.id: run for run in taught}
    found = list(
        db.execute(
            select(MaterialRelease, ClassroomMaterialVersion.lesson)
            .join(
                ClassroomMaterialVersion,
                ClassroomMaterialVersion.id == MaterialRelease.version_id,
            )
            .where(MaterialRelease.run_id.in_(run_of), MaterialRelease.retracted_at.is_(None))
            .order_by(MaterialRelease.released_at, MaterialRelease.id)
        ).tuples()
    )
    counts = open_assessment.waiting_counts(db, [released.id for released, _ in found])
    waiting, due = [], []
    for released, lesson in found:
        run = run_of[released.run_id]
        place = {
            "course_id": taught[run].id,
            "course_name": taught[run].name,
            "run_id": run.id,
            "release_id": released.id,
            "title": lesson["title"],
        }
        if count := counts.get(released.id):
            waiting.append(AttentionItem(kind="open_answers", count=count, **place))
        if released.due_at is not None and now < released.due_at <= now + DUE_SOON:
            submitted, total = releases.submitted_of(db, run, released)
            due.append(
                AttentionItem(
                    kind="due_soon",
                    count=1,
                    due_at=released.due_at,
                    submitted=submitted,
                    total=total,
                    **place,
                )
            )
    return waiting, sorted(due, key=lambda item: item.due_at or now)


def _instance(db: InstanceSession, actor: Account) -> Instance | None:
    """What the instance lacks: email, and another teacher who is invited or active."""
    if not actor.is_admin:
        return None
    found = Instance(
        smtp=stored_settings(db) is not None,
        teacher_invited=any(
            teacher.id != actor.id and accounts.account_state(teacher) in ("invited", "active")
            for teacher in accounts.list_teachers(db)
        ),
    )
    return None if found.smtp and found.teacher_invited else found


@router.get("")
def read_home(db: Db, now: Now, actor: Teacher) -> Home:
    editable = [c for c in courses.visible_courses(db, actor) if can_edit_course(actor, c)]
    taught = runs_taught(db, actor)
    setups = {course.id: courses.setup_of(course) for course in editable}
    held: dict[int, list[Topic]] = {course.id: [] for course in editable}
    for topic in db.scalars(
        select(Topic).where(Topic.course_id.in_(held)).order_by(Topic.position, Topic.id)
    ):
        held[topic.course_id].append(topic)
    approved = {
        topic_id
        for course in editable
        for topic_id, (state, _, _) in topics.progress_of(db, course).items()
        if state == "approved"
    }
    drafts, ready = _drafts(db, editable, held)
    # Every run the actor ever taught: losing its course later does not undo having released.
    own_runs = [run.id for run in runs.runs_taught_by(db, actor)]
    ever_released = db.scalar(select(exists().where(MaterialRelease.run_id.in_(own_runs))))
    waiting, due = _releases(db, taught, now)
    preparing = []
    for course in editable:
        ready_here = sum(topic.id in ready for topic in held[course.id])
        brief, sources = _brief_done(setups[course.id]), _sources_done(setups[course.id])
        if not (brief and sources and ready_here):
            preparing.append(
                CourseInPreparation(
                    id=course.id,
                    name=course.name,
                    brief=brief,
                    sources=sources,
                    topics=len(held[course.id]),
                    topics_ready=ready_here,
                )
            )
    return Home(
        checklist=None
        if ever_released
        else _checklist(db, actor, editable, list(taught), setups, held, approved, ready),
        attention=[*waiting, *drafts, *_awaiting_consent(db, list(taught)), *due],
        courses=preparing,
        instance=_instance(db, actor),
    )
