"""Classroom material released to a run (ADR 0011): one version, frozen, to the whole roster or to
chosen students of it, with the settings the run teacher chose."""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import exists, select

from myteacher.accounts.models import Account
from myteacher.courses.models import ClassroomMaterial, ClassroomMaterialVersion, Topic
from myteacher.persistence import InstanceSession
from myteacher.runs import service as runs
from myteacher.runs.models import Attempt, CourseRun, MaterialRelease, ReleaseStudent


class UnknownMaterial(Exception):
    """No material of the run's course has the id, or it was discarded."""


class UnknownVersion(Exception):
    """The material has no version with the number."""


class NotInRun(Exception):
    """A chosen student is not on the run's roster, or no student was chosen."""


class DueInThePast(Exception):
    pass


@dataclass
class Settings:
    feedback_mode: str = "immediate"
    due_at: datetime | None = None
    late_submissions: str = "accept"
    attempts: str = "one"
    show_solutions: bool = True


def releasable(
    db: InstanceSession, run: CourseRun
) -> list[tuple[ClassroomMaterial, Topic, list[ClassroomMaterialVersion]]]:
    """The run's course's current materials that have a version, in topic order, each with its
    versions newest first."""
    rows = db.execute(
        select(ClassroomMaterial, Topic)
        .join(Topic, Topic.id == ClassroomMaterial.topic_id)
        .where(
            ClassroomMaterial.course_id == run.course_id,
            ClassroomMaterial.discarded_at.is_(None),
        )
        .order_by(Topic.position, ClassroomMaterial.id)
    ).tuples()
    found = []
    for material, topic in rows:
        versions = list(
            db.scalars(
                select(ClassroomMaterialVersion)
                .where(ClassroomMaterialVersion.material_id == material.id)
                .order_by(ClassroomMaterialVersion.number.desc())
            )
        )
        if versions:
            found.append((material, topic, versions))
    return found


def _material(db: InstanceSession, run: CourseRun, material_id: int) -> ClassroomMaterial:
    material = db.scalars(
        select(ClassroomMaterial).where(
            ClassroomMaterial.id == material_id,
            ClassroomMaterial.course_id == run.course_id,
            ClassroomMaterial.discarded_at.is_(None),
        )
    ).first()
    if material is None:
        raise UnknownMaterial()
    return material


def _version(
    db: InstanceSession, material: ClassroomMaterial, number: int
) -> ClassroomMaterialVersion:
    version = db.scalars(
        select(ClassroomMaterialVersion).where(
            ClassroomMaterialVersion.material_id == material.id,
            ClassroomMaterialVersion.number == number,
        )
    ).first()
    if version is None:
        raise UnknownVersion()
    return version


def release(
    db: InstanceSession,
    run: CourseRun,
    *,
    material_id: int,
    version: int,
    student_ids: list[int] | None,
    settings: Settings,
    teacher: Account,
    now: datetime,
) -> MaterialRelease:
    """Release the version to the whole run, or to the chosen students when `student_ids` is
    given; each must be on the roster now."""
    material = _material(db, run, material_id)
    pinned = _version(db, material, version)
    if settings.due_at is not None and settings.due_at <= now:
        raise DueInThePast()
    chosen = sorted(set(student_ids)) if student_ids is not None else None
    if chosen is not None:
        on_roster = {entry.student.id for entry in runs.roster(db, run)}
        if not chosen or not set(chosen) <= on_roster:
            raise NotInRun()
    released = MaterialRelease(
        run_id=run.id,
        material_id=material.id,
        version_id=pinned.id,
        audience="run" if chosen is None else "chosen",
        feedback_mode=settings.feedback_mode,
        due_at=settings.due_at,
        late_submissions=settings.late_submissions,
        attempts=settings.attempts,
        show_solutions=settings.show_solutions,
        released_by_id=teacher.id,
        released_at=now,
    )
    db.add(released)
    db.flush()
    for student_id in chosen or []:
        db.add(ReleaseStudent(release_id=released.id, student_id=student_id))
    db.flush()
    return released


def releases_of(db: InstanceSession, run: CourseRun) -> list[MaterialRelease]:
    """The run's releases, the first released first."""
    return list(
        db.scalars(
            select(MaterialRelease)
            .where(MaterialRelease.run_id == run.id)
            .order_by(MaterialRelease.released_at, MaterialRelease.id)
        )
    )


def latest_releases(
    db: InstanceSession, runs: list[CourseRun]
) -> dict[int, tuple[MaterialRelease, str]]:
    """Each run's last release that was not retracted, with the title of the version released."""
    ids = [run.id for run in runs]
    found = db.execute(
        select(MaterialRelease, ClassroomMaterialVersion.lesson)
        .join(ClassroomMaterialVersion, ClassroomMaterialVersion.id == MaterialRelease.version_id)
        .where(MaterialRelease.run_id.in_(ids), MaterialRelease.retracted_at.is_(None))
        .order_by(MaterialRelease.released_at, MaterialRelease.id)
    )
    # Later rows win, so each run keeps its last release.
    return {released.run_id: (released, lesson["title"]) for released, lesson in found}


def get_release(db: InstanceSession, run: CourseRun, release_id: int) -> MaterialRelease | None:
    return db.scalars(
        select(MaterialRelease).where(
            MaterialRelease.id == release_id, MaterialRelease.run_id == run.id
        )
    ).first()


def chosen_students(db: InstanceSession, released: MaterialRelease) -> list[Account]:
    """The students a chosen release was chosen for, by name, whether still in the run or not."""
    return list(
        db.scalars(
            select(Account)
            .join(ReleaseStudent, ReleaseStudent.student_id == Account.id)
            .where(ReleaseStudent.release_id == released.id)
            .order_by(Account.name, Account.email)
        )
    )


def recipients(
    db: InstanceSession,
    run: CourseRun,
    released: MaterialRelease,
    roster: list[Account] | None = None,
) -> list[Account]:
    """Who has the release now: the roster, or the chosen students still on it. The run's roster
    may be given when it was read already."""
    if roster is None:
        roster = [entry.student for entry in runs.roster(db, run)]
    if released.audience == "run":
        return roster
    chosen = {student.id for student in chosen_students(db, released)}
    return [student for student in roster if student.id in chosen]


def submitted_of(
    db: InstanceSession,
    run: CourseRun,
    released: MaterialRelease,
    roster: list[Account] | None = None,
) -> tuple[int, int]:
    """How many of the release's recipients now have an attempt that counts, of how many."""
    ids = {student.id for student in recipients(db, run, released, roster)}
    counting = select(Attempt.student_id).where(
        Attempt.release_id == released.id,
        Attempt.submitted_at.is_not(None),
        Attempt.retracted_at.is_(None),
    )
    return len(ids & set(db.scalars(counting))), len(ids)


def topic_released(db: InstanceSession, topic: Topic) -> bool:
    """Whether any material of the topic was ever released, so the topic has to stay."""
    return bool(
        db.scalar(
            select(
                exists().where(
                    MaterialRelease.material_id == ClassroomMaterial.id,
                    ClassroomMaterial.topic_id == topic.id,
                )
            )
        )
    )
