"""Attempts at released classroom material (ADR 0011). The server owns them (#19): it holds the
seed, serves the layouts, pins the second round's variants, counts the tries and decides when a
solution reaches the student. Closed answers are assessed at once, or all together when the
first pass is submitted with feedback at the end; open ones wait for the teacher.

The first pass is the attempt: it is submitted with its last try, or by the student with feedback
at the end. The second round repeats what failed, as practice after the submission."""

import secrets
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from pydantic import TypeAdapter
from sqlalchemy import exists, or_, select
from sqlalchemy.exc import IntegrityError

from myteacher.accounts.models import Account
from myteacher.courses import concepts
from myteacher.courses.models import ClassroomMaterial, ClassroomMaterialVersion, Topic
from myteacher.lesson.assessment import AnswerMismatch, assess
from myteacher.lesson.catalog import COMPONENT_CATALOG
from myteacher.lesson.layout import layout
from myteacher.lesson.schema import (
    AssessmentOutcome,
    Exercise,
    ExerciseAnswer,
    FreeTextAnswer,
    LessonDocument,
    OpenExercise,
    TranslationAnswer,
)
from myteacher.lesson.second_round import second_round
from myteacher.persistence import InstanceSession
from myteacher.runs import releases
from myteacher.runs import service as runs
from myteacher.runs.models import (
    Assessment,
    AssessmentConcept,
    Attempt,
    AttemptDraft,
    MaterialRelease,
    ReleaseStudent,
)

Round = Literal["first", "second"]
# With immediate feedback a wrong first try earns exactly one retry, as in the lesson player.
MAX_TRIES = 2

_answer = TypeAdapter(ExerciseAnswer)
_outcome = TypeAdapter(AssessmentOutcome)


class PastDue(Exception):
    """The due date passed and the release refuses late work."""


class NoMoreAttempts(Exception):
    pass


class UnknownExercise(Exception):
    """No exercise of the round has the id, or the round has not started."""


class RoundClosed(Exception):
    pass


class ExerciseLocked(Exception):
    """The exercise was answered right, sent for the teacher, or its tries are used up."""


class AssessedAtTheEnd(Exception):
    pass


class AssessedImmediately(Exception):
    pass


class NotSubmitted(Exception):
    pass


class ReleaseRetracted(Exception):
    pass


class NothingToRetract(Exception):
    """The student has no attempt being worked on or counting."""


class Unanswered(Exception):
    """A closed exercise has no answer to submit."""


# Which releases a student has


def releases_for(db: InstanceSession, student: Account) -> list[MaterialRelease]:
    """The releases meant for the student in the runs they are on, the latest first; a
    retracted one is gone from the list."""
    chosen = exists().where(
        ReleaseStudent.release_id == MaterialRelease.id, ReleaseStudent.student_id == student.id
    )
    return list(
        db.scalars(
            select(MaterialRelease)
            .where(
                MaterialRelease.run_id.in_(runs.runs_of_student(db, student)),
                or_(MaterialRelease.audience == "run", chosen),
                MaterialRelease.retracted_at.is_(None),
            )
            .order_by(MaterialRelease.released_at.desc(), MaterialRelease.id.desc())
        )
    )


def release_for(db: InstanceSession, student: Account, release_id: int) -> MaterialRelease | None:
    """The release, while the student is one of its recipients."""
    released = db.scalars(select(MaterialRelease).where(MaterialRelease.id == release_id)).first()
    if released is None:
        return None
    run = runs.get_run(db, released.run_id)
    assert run is not None
    recipients = releases.recipients(db, run, released)
    return released if any(student.id == s.id for s in recipients) else None


def attempt_for(
    db: InstanceSession, student: Account, attempt_id: int
) -> tuple[Attempt, MaterialRelease] | None:
    """The student's own attempt, while its release is still theirs."""
    attempt = db.scalars(select(Attempt).where(Attempt.id == attempt_id)).first()
    if attempt is None or attempt.student_id != student.id:
        return None
    released = release_for(db, student, attempt.release_id)
    return (attempt, released) if released is not None else None


# The student's standing on a release


def attempts_of(db: InstanceSession, released: MaterialRelease, student: Account) -> list[Attempt]:
    return list(
        db.scalars(
            select(Attempt)
            .where(Attempt.release_id == released.id, Attempt.student_id == student.id)
            .order_by(Attempt.number)
        )
    )


@dataclass
class Standing:
    state: Literal["not_started", "in_progress", "submitted"]
    # The attempt being worked on.
    open: Attempt | None
    # The last submitted attempt, which is the one that counts.
    counting: Attempt | None
    # Whether a new attempt may be started now.
    can_start: bool


def standing(
    db: InstanceSession, released: MaterialRelease, student: Account, now: datetime
) -> Standing:
    """Where the student stands on the release; a retracted attempt counts for nothing."""
    attempts = [a for a in attempts_of(db, released, student) if a.retracted_at is None]
    current = next((a for a in attempts if a.submitted_at is None), None)
    submitted = [a for a in attempts if a.submitted_at is not None]
    counting = submitted[-1] if submitted else None
    state = "in_progress" if current else "submitted" if counting else "not_started"
    return Standing(
        state=state,
        open=current,
        counting=counting,
        can_start=(
            current is None
            and (not attempts or released.attempts == "repeated")
            and not past_due(released, now)
            and released.retracted_at is None
        ),
    )


def past_due(released: MaterialRelease, now: datetime) -> bool:
    return (
        released.due_at is not None
        and now > released.due_at
        and released.late_submissions == "refuse"
    )


# Starting


def start(
    db: InstanceSession, released: MaterialRelease, student: Account, now: datetime
) -> tuple[Attempt, bool]:
    """The attempt being worked on, or a new one; True when it was started now."""
    if released.retracted_at is not None:
        raise ReleaseRetracted()
    found = standing(db, released, student, now)
    if found.open is not None:
        return found.open, False
    if found.counting is not None and released.attempts == "one":
        raise NoMoreAttempts()
    if past_due(released, now):
        raise PastDue()
    attempt = Attempt(
        release_id=released.id,
        student_id=student.id,
        number=max((a.number for a in attempts_of(db, released, student)), default=0) + 1,
        seed=secrets.token_hex(8),
        started_at=now,
    )
    savepoint = db.begin_nested()
    db.add(attempt)
    try:
        db.flush()
    except IntegrityError:
        # Opened on another device meanwhile: that attempt is the one.
        savepoint.rollback()
        current = standing(db, released, student, now).open
        assert current is not None
        return current, False
    savepoint.commit()
    return attempt, True


# The lesson as the attempt holds it


def lesson_of(db: InstanceSession, released: MaterialRelease) -> LessonDocument:
    """The released version, in the release's feedback mode."""
    version = db.get_one(ClassroomMaterialVersion, released.version_id)
    lesson = LessonDocument.model_validate(version.lesson)
    return lesson.model_copy(update={"feedback_mode": released.feedback_mode})


def exercises(lesson: LessonDocument, attempt: Attempt, round: Round) -> list[Exercise]:
    """The round's exercises as the attempt asks them: the lesson's, or the second round's
    variants from the attempt's seed. Empty for a second round not started."""
    if round == "first":
        return [e for e in lesson.exercises() if e.type in COMPONENT_CATALOG]
    if attempt.second_round is None:
        return []
    return second_round(lesson, attempt.second_round, attempt.seed)


def layouts(lesson: LessonDocument, attempt: Attempt, round: Round) -> dict[str, list[str]]:
    first = _layouts(exercises(lesson, attempt, "first"), f"{attempt.seed}:first", {})
    if round == "first":
        return first
    return _layouts(exercises(lesson, attempt, "second"), f"{attempt.seed}:second", first)


def _layouts(
    found: list[Exercise], seed: str, previous: dict[str, list[str]]
) -> dict[str, list[str]]:
    laid = {e.id: layout(e, f"{seed}:{e.id}", previous.get(e.id)) for e in found}
    return {exercise_id: order for exercise_id, order in laid.items() if order is not None}


def _exercise(lesson: LessonDocument, attempt: Attempt, round: Round, exercise_id: str) -> Exercise:
    found = next((e for e in exercises(lesson, attempt, round) if e.id == exercise_id), None)
    if found is None:
        raise UnknownExercise()
    return found


# Answers and their assessments


def drafts_of(db: InstanceSession, attempt: Attempt, round: Round) -> dict[str, ExerciseAnswer]:
    rows = db.scalars(
        select(AttemptDraft).where(
            AttemptDraft.attempt_id == attempt.id, AttemptDraft.round == round
        )
    )
    return {row.exercise_id: _answer.validate_python(row.answer) for row in rows}


def tries_of(db: InstanceSession, attempt: Attempt, round: Round) -> dict[str, list[Assessment]]:
    """The round's tries by exercise, the first first."""
    found: dict[str, list[Assessment]] = {}
    for row in db.scalars(
        select(Assessment)
        .where(Assessment.attempt_id == attempt.id, Assessment.round == round)
        .order_by(Assessment.number)
    ):
        found.setdefault(row.exercise_id, []).append(row)
    return found


def served(released: MaterialRelease, row: Assessment) -> AssessmentOutcome:
    """The outcome as the student gets it. A right answer always comes with its solution, which
    gives nothing away and whose explanation teaches. A wrong answer's solution comes only where
    the release shows solutions, and with immediate feedback only once its tries are used up."""
    outcome = dict(row.outcome)
    reveal = bool(row.correct) or (
        released.show_solutions
        and (released.feedback_mode == "at_the_end" or row.number >= MAX_TRIES)
    )
    if "solution" in outcome and not reveal:
        outcome["solution"] = None
    return _outcome.validate_python(outcome)


def assessed(row: Assessment) -> AssessmentOutcome:
    """The outcome as assessed, solution included, for the run teacher."""
    return _outcome.validate_python(row.outcome)


def answer_of(row: Assessment) -> ExerciseAnswer:
    return _answer.validate_python(row.answer)


def _locked(tries: list[Assessment]) -> bool:
    if not tries:
        return False
    last = tries[-1]
    return last.status == "pending" or bool(last.correct) or len(tries) >= MAX_TRIES


def _closed(attempt: Attempt, round: Round) -> bool:
    return (attempt.submitted_at if round == "first" else attempt.second_submitted_at) is not None


def _refuses_late(attempt: Attempt, released: MaterialRelease, round: Round, now: datetime):
    # The due date is for the submission; the second round after it is practice.
    if round == "first" and past_due(released, now):
        raise PastDue()


def save_draft(
    db: InstanceSession,
    attempt: Attempt,
    released: MaterialRelease,
    round: Round,
    exercise_id: str,
    given: ExerciseAnswer,
    now: datetime,
) -> None:
    exercise = _exercise(lesson_of(db, released), attempt, round, exercise_id)
    if given.type != exercise.type:
        raise AnswerMismatch(f"a {given.type} answer cannot answer a {exercise.type} exercise")
    if _closed(attempt, round):
        raise RoundClosed()
    if released.feedback_mode == "immediate" and _locked(
        tries_of(db, attempt, round).get(exercise_id, [])
    ):
        raise ExerciseLocked()
    _refuses_late(attempt, released, round, now)
    _put_draft(db, attempt, round, exercise_id, given)


def _put_draft(
    db: InstanceSession, attempt: Attempt, round: Round, exercise_id: str, given: ExerciseAnswer
) -> None:
    key = {"attempt_id": attempt.id, "round": round, "exercise_id": exercise_id}
    row = db.get(AttemptDraft, key)
    if row is None:
        db.add(AttemptDraft(**key, answer=given.model_dump(mode="json")))
    else:
        row.answer = given.model_dump(mode="json")
    db.flush()


def _concept_ids(db: InstanceSession, released: MaterialRelease) -> list[int]:
    """The current concepts of the material's topic, while its map is approved and also while it
    is reopened for changes: concept ids survive edits, so they are worth recording rather than
    nothing. A map never approved is a proposal no teacher reviewed, so it records none."""
    material = db.get_one(ClassroomMaterial, released.material_id)
    concept_map = concepts.map_of(db, db.get_one(Topic, material.topic_id))
    if concept_map is None or (concept_map.state != "approved" and not concept_map.approved_before):
        return []
    return [concept.id for concept in concepts.concepts_of(db, concept_map)]


def _record(
    db: InstanceSession,
    attempt: Attempt,
    round: Round,
    exercise_id: str,
    number: int,
    given: ExerciseAnswer,
    outcome: AssessmentOutcome,
    concept_ids: list[int],
    now: datetime,
) -> Assessment:
    row = Assessment(
        attempt_id=attempt.id,
        round=round,
        exercise_id=exercise_id,
        number=number,
        answer=given.model_dump(mode="json"),
        outcome=outcome.model_dump(mode="json"),
        status=outcome.status,
        score=getattr(outcome, "score", None),
        correct=getattr(outcome, "correct", None),
        assessed_at=now,
    )
    db.add(row)
    db.flush()
    for concept_id in concept_ids:
        db.add(AssessmentConcept(assessment_id=row.id, concept_id=concept_id))
    return row


@contextmanager
def _refused_on_conflict(db: InstanceSession, refusal: type[Exception]) -> Iterator[None]:
    """Another device took the same try or submitted the same round meanwhile: the refusal that
    request would have met, rather than a failure."""
    savepoint = db.begin_nested()
    try:
        yield
        db.flush()
    except IntegrityError:
        savepoint.rollback()
        raise refusal() from None
    savepoint.commit()


def _submit(attempt: Attempt, released: MaterialRelease, now: datetime) -> None:
    attempt.submitted_at = now
    attempt.late = released.due_at is not None and now > released.due_at


def take_try(
    db: InstanceSession,
    attempt: Attempt,
    released: MaterialRelease,
    round: Round,
    exercise_id: str,
    given: ExerciseAnswer,
    now: datetime,
) -> Assessment:
    """Assess one try with immediate feedback. The try that finishes the first pass submits the
    attempt."""
    if released.feedback_mode != "immediate":
        raise AssessedAtTheEnd()
    lesson = lesson_of(db, released)
    exercise = _exercise(lesson, attempt, round, exercise_id)
    tries = tries_of(db, attempt, round)
    if _locked(tries.get(exercise_id, [])):
        raise ExerciseLocked()
    _refuses_late(attempt, released, round, now)
    outcome = assess(exercise, given, language=lesson.language, pinned=True)
    number = len(tries.get(exercise_id, [])) + 1
    concept_ids = _concept_ids(db, released)
    with _refused_on_conflict(db, ExerciseLocked):
        row = _record(db, attempt, round, exercise_id, number, given, outcome, concept_ids, now)
    _put_draft(db, attempt, round, exercise_id, given)
    tries.setdefault(exercise_id, []).append(row)
    if round == "first" and attempt.submitted_at is None:
        if all(_locked(tries.get(e.id, [])) for e in exercises(lesson, attempt, "first")):
            _submit(attempt, released, now)
    return row


def _blank(given: ExerciseAnswer) -> bool:
    return isinstance(given, FreeTextAnswer | TranslationAnswer) and not given.text.strip()


def submit_round(
    db: InstanceSession,
    attempt: Attempt,
    released: MaterialRelease,
    round: Round,
    answers: dict[str, ExerciseAnswer],
    now: datetime,
) -> list[Assessment]:
    """Assess a round with feedback at the end: the answers sent with it over the drafts saved.
    Every closed exercise needs an answer; an open one may be left empty and is then not sent.
    Submitting the first pass submits the attempt."""
    if released.feedback_mode != "at_the_end":
        raise AssessedImmediately()
    lesson = lesson_of(db, released)
    asked = exercises(lesson, attempt, round)
    if round == "second" and attempt.second_round is None:
        raise NotSubmitted()
    if _closed(attempt, round):
        raise RoundClosed()
    _refuses_late(attempt, released, round, now)
    known = {exercise.id for exercise in asked}
    unknown = sorted(set(answers) - known)
    if unknown:
        raise AnswerMismatch(f"not exercises of the round: {', '.join(unknown)}")
    given = {**drafts_of(db, attempt, round), **answers}
    assessed: list[tuple[Exercise, ExerciseAnswer, AssessmentOutcome]] = []
    for exercise in asked:
        answer = given.get(exercise.id)
        if answer is None or _blank(answer):
            if isinstance(exercise, OpenExercise):
                continue
            raise Unanswered()
        outcome = assess(exercise, answer, language=lesson.language, pinned=True)
        assessed.append((exercise, answer, outcome))
    for exercise_id, answer in answers.items():
        _put_draft(db, attempt, round, exercise_id, answer)
    concept_ids = _concept_ids(db, released)
    with _refused_on_conflict(db, RoundClosed):
        rows = [
            _record(db, attempt, round, exercise.id, 1, answer, outcome, concept_ids, now)
            for exercise, answer, outcome in assessed
        ]
    if round == "first":
        _submit(attempt, released, now)
    else:
        attempt.second_submitted_at = now
    return rows


def start_second_round(db: InstanceSession, attempt: Attempt, released: MaterialRelease) -> None:
    """Pin the exercises the second round repeats: every closed one not right on its first try."""
    if attempt.submitted_at is None:
        raise NotSubmitted()
    if attempt.second_round is not None:
        return
    tries = tries_of(db, attempt, "first")
    attempt.second_round = [
        exercise.id
        for exercise in exercises(lesson_of(db, released), attempt, "first")
        if not isinstance(exercise, OpenExercise)
        and not (tries.get(exercise.id) and tries[exercise.id][0].correct)
    ]


# Retraction


def _retract(attempt: Attempt, reason: str, teacher: Account, now: datetime) -> None:
    attempt.retracted_at = now
    attempt.retracted_by_id = teacher.id
    attempt.retraction_reason = reason


def retract_attempt(
    db: InstanceSession,
    released: MaterialRelease,
    student: Account,
    *,
    reason: str,
    teacher: Account,
    now: datetime,
) -> None:
    """Retract the attempt being worked on, or else the one that counts; the student may then
    start a new one."""
    if released.retracted_at is not None:
        raise ReleaseRetracted()
    found = standing(db, released, student, now)
    target = found.open or found.counting
    if target is None:
        raise NothingToRetract()
    _retract(target, reason, teacher, now)


def retract_release(
    db: InstanceSession, released: MaterialRelease, *, reason: str, teacher: Account, now: datetime
) -> None:
    """Take the release from its students and retract every attempt at it."""
    if released.retracted_at is not None:
        raise ReleaseRetracted()
    released.retracted_at = now
    released.retracted_by_id = teacher.id
    released.retraction_reason = reason
    for attempt in db.scalars(
        select(Attempt).where(Attempt.release_id == released.id, Attempt.retracted_at.is_(None))
    ):
        _retract(attempt, reason, teacher, now)


def retraction_notice(
    db: InstanceSession, released: MaterialRelease, student: Account
) -> tuple[str, bool] | None:
    """What the student is told: the release's retraction, or that of their latest attempt until
    they start another; (reason, whole release)."""
    if released.retracted_at is not None:
        return released.retraction_reason or "", True
    latest = attempts_of(db, released, student)[-1:]
    if latest and latest[0].retracted_at is not None:
        return latest[0].retraction_reason or "", False
    return None
