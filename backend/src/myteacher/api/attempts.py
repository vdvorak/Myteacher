"""A student's releases and their attempts (ADR 0011): the student sees only what is released to
them in the runs they are on, and works on it through an attempt the server owns (#19)."""

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field, field_serializer

from myteacher.accounts.models import Account
from myteacher.api.deps import Db, Now, requires
from myteacher.courses.models import ClassroomMaterial, ClassroomMaterialVersion, Topic
from myteacher.lesson.assessment import AnswerMismatch
from myteacher.lesson.schema import (
    AssessmentPending,
    AssessmentResult,
    ExerciseAnswer,
    ExercisePublic,
    FeedbackMode,
    Identifier,
    LessonPublic,
    exercise_to_public,
    to_public,
)
from myteacher.persistence import InstanceSession
from myteacher.policy import is_student
from myteacher.runs import attempts
from myteacher.runs import service as runs
from myteacher.runs.attempts import Round
from myteacher.runs.models import Assessment, Attempt, MaterialRelease

router = APIRouter(tags=["attempts"])
Student = Annotated[Account, requires(is_student)]

TryOutcome = Annotated[AssessmentResult | AssessmentPending, Field(discriminator="status")]


def _utc(at: datetime | None) -> str | None:
    return at.isoformat().replace("+00:00", "Z") if at is not None else None


class StudentRelease(BaseModel):
    id: int
    title: str
    topic: str
    # The run's name.
    run: str
    released_at: datetime
    due_at: datetime | None
    state: Literal["not_started", "in_progress", "submitted"]
    # Whether the attempt that counts was submitted after the due date.
    late: bool
    # The last submitted attempt, which is the one that counts.
    counting_attempt_id: int | None

    @field_serializer("released_at", "due_at")
    def _utc(self, at: datetime | None) -> str | None:
        return _utc(at)


class Try(BaseModel):
    answer: ExerciseAnswer
    result: TryOutcome


class ExerciseProgress(BaseModel):
    # The answer being composed.
    draft: ExerciseAnswer | None
    tries: list[Try]


class RoundOut(BaseModel):
    exercises: list[ExercisePublic]
    # The order to show a matching's right items and the tokens to order in, by exercise id.
    layouts: dict[str, list[str]]
    answers: dict[str, ExerciseProgress]
    # Submitted as a round, with feedback at the end.
    submitted: bool


class AttemptOut(BaseModel):
    id: int
    release_id: int
    number: int
    # For the layouts the browser still draws itself, such as the order of choice options.
    seed: str
    # The released version in the release's feedback mode, without its key.
    lesson: LessonPublic
    first: RoundOut
    second: RoundOut | None
    started_at: datetime
    submitted_at: datetime | None
    late: bool

    @field_serializer("started_at", "submitted_at")
    def _utc(self, at: datetime | None) -> str | None:
        return _utc(at)


class ReleaseDetail(StudentRelease):
    feedback_mode: FeedbackMode
    attempts: Literal["one", "repeated"]
    late_submissions: Literal["accept", "refuse"]
    show_solutions: bool
    # Whether a new attempt may be started now.
    can_start: bool
    # The attempt being worked on, or else the one that counts.
    attempt: AttemptOut | None


class SubmissionIn(BaseModel):
    # Answers not saved as drafts yet; they overwrite the drafts.
    answers: dict[Identifier, ExerciseAnswer] = {}


class RoundSubmitted(BaseModel):
    # By exercise id, each with the answer assessed, which may be a draft saved before; an open
    # exercise left empty has none.
    tries: dict[str, Try]


def _release_or_404(db: InstanceSession, actor: Account, release_id: int) -> MaterialRelease:
    released = attempts.release_for(db, actor, release_id)
    if released is None:
        raise HTTPException(status_code=404)
    return released


def _attempt_or_404(
    db: InstanceSession, actor: Account, attempt_id: int
) -> tuple[Attempt, MaterialRelease]:
    found = attempts.attempt_for(db, actor, attempt_id)
    if found is None:
        raise HTTPException(status_code=404)
    return found


def _try(released: MaterialRelease, row: Assessment) -> Try:
    return Try(answer=attempts.answer_of(row), result=attempts.served(released, row))  # type: ignore[arg-type]


def _round(
    db: InstanceSession, attempt: Attempt, released: MaterialRelease, round: Round
) -> RoundOut:
    lesson = attempts.lesson_of(db, released)
    drafts = attempts.drafts_of(db, attempt, round)
    tries = attempts.tries_of(db, attempt, round)
    return RoundOut(
        exercises=[exercise_to_public(e) for e in attempts.exercises(lesson, attempt, round)],
        layouts=attempts.layouts(lesson, attempt, round),
        answers={
            exercise_id: ExerciseProgress(
                draft=drafts.get(exercise_id),
                tries=[_try(released, row) for row in tries.get(exercise_id, [])],
            )
            for exercise_id in sorted(set(drafts) | set(tries))
        },
        submitted=(attempt.submitted_at if round == "first" else attempt.second_submitted_at)
        is not None,
    )


def _attempt_out(db: InstanceSession, attempt: Attempt, released: MaterialRelease) -> AttemptOut:
    return AttemptOut(
        id=attempt.id,
        release_id=released.id,
        number=attempt.number,
        seed=attempt.seed,
        lesson=to_public(attempts.lesson_of(db, released)),
        first=_round(db, attempt, released, "first"),
        second=(
            _round(db, attempt, released, "second") if attempt.second_round is not None else None
        ),
        started_at=attempt.started_at,
        submitted_at=attempt.submitted_at,
        late=attempt.late,
    )


def _summary(
    db: InstanceSession, released: MaterialRelease, standing: attempts.Standing
) -> StudentRelease:
    version = db.get_one(ClassroomMaterialVersion, released.version_id)
    topic = db.get_one(Topic, db.get_one(ClassroomMaterial, released.material_id).topic_id)
    run = runs.get_run(db, released.run_id)
    assert run is not None
    return StudentRelease(
        id=released.id,
        title=version.lesson["title"],
        topic=topic.name,
        run=run.name,
        released_at=released.released_at,
        due_at=released.due_at,
        state=standing.state,
        late=standing.counting.late if standing.counting else False,
        counting_attempt_id=standing.counting.id if standing.counting else None,
    )


@router.get("/my/releases")
def my_releases(db: Db, now: Now, actor: Student) -> list[StudentRelease]:
    """The material released to the student in the runs they are on, the latest first."""
    return [
        _summary(db, released, attempts.standing(db, released, actor, now))
        for released in attempts.releases_for(db, actor)
    ]


@router.get("/my/releases/{release_id}")
def my_release(release_id: int, db: Db, now: Now, actor: Student) -> ReleaseDetail:
    released = _release_or_404(db, actor, release_id)
    standing = attempts.standing(db, released, actor, now)
    shown = standing.open or standing.counting
    return ReleaseDetail(
        **_summary(db, released, standing).model_dump(),
        feedback_mode=released.feedback_mode,  # type: ignore[arg-type]
        attempts=released.attempts,  # type: ignore[arg-type]
        late_submissions=released.late_submissions,  # type: ignore[arg-type]
        show_solutions=released.show_solutions,
        can_start=standing.can_start,
        attempt=_attempt_out(db, shown, released) if shown else None,
    )


@router.post(
    "/my/releases/{release_id}/attempts",
    status_code=201,
    responses={
        200: {"description": "The attempt being worked on, resumed"},
        409: {"description": "No more attempts, or past the due date"},
    },
)
def start_attempt(
    release_id: int, response: Response, db: Db, now: Now, actor: Student
) -> AttemptOut:
    """Start an attempt on the release, or resume the one being worked on."""
    released = _release_or_404(db, actor, release_id)
    try:
        attempt, created = attempts.start(db, released, actor, now)
    except attempts.NoMoreAttempts:
        raise HTTPException(status_code=409, detail="no_more_attempts") from None
    except attempts.PastDue:
        raise HTTPException(status_code=409, detail="past_due") from None
    if not created:
        response.status_code = 200
    return _attempt_out(db, attempt, released)


@router.get("/attempts/{attempt_id}")
def read_attempt(attempt_id: int, db: Db, actor: Student) -> AttemptOut:
    return _attempt_out(db, *_attempt_or_404(db, actor, attempt_id))


_REFUSALS: list[tuple[type[Exception], int, str]] = [
    (attempts.UnknownExercise, 404, "exercise not found"),
    (attempts.PastDue, 409, "past_due"),
    (attempts.RoundClosed, 409, "round_closed"),
    (attempts.ExerciseLocked, 409, "exercise_locked"),
    (attempts.AssessedAtTheEnd, 409, "assessed_at_the_end"),
    (attempts.AssessedImmediately, 409, "assessed_immediately"),
    (attempts.NotSubmitted, 409, "not_submitted"),
    (attempts.Unanswered, 422, "unanswered"),
]


def _refused(error: Exception) -> HTTPException:
    if isinstance(error, AnswerMismatch):
        return HTTPException(status_code=422, detail=str(error))
    status, detail = next((s, d) for kind, s, d in _REFUSALS if isinstance(error, kind))
    return HTTPException(status_code=status, detail=detail)


_REFUSABLE = (AnswerMismatch, *(kind for kind, _, _ in _REFUSALS))


@router.put("/attempts/{attempt_id}/rounds/{round}/drafts/{exercise_id}", status_code=204)
def save_draft(
    attempt_id: int,
    round: Round,
    exercise_id: str,
    body: ExerciseAnswer,
    db: Db,
    now: Now,
    actor: Student,
) -> Response:
    """Save the answer being composed, so the attempt continues on another device."""
    attempt, released = _attempt_or_404(db, actor, attempt_id)
    try:
        attempts.save_draft(db, attempt, released, round, exercise_id, body, now)
    except _REFUSABLE as error:
        raise _refused(error) from None
    return Response(status_code=204)


@router.post(
    "/attempts/{attempt_id}/rounds/{round}/exercises/{exercise_id}/tries",
    response_model=TryOutcome,
)
def take_try(
    attempt_id: int,
    round: Round,
    exercise_id: str,
    body: ExerciseAnswer,
    db: Db,
    now: Now,
    actor: Student,
) -> AssessmentResult | AssessmentPending:
    """Assess one try with immediate feedback; the attempt decides whether it may be taken and
    whether the solution comes with it."""
    attempt, released = _attempt_or_404(db, actor, attempt_id)
    try:
        row = attempts.take_try(db, attempt, released, round, exercise_id, body, now)
    except _REFUSABLE as error:
        raise _refused(error) from None
    return attempts.served(released, row)  # type: ignore[return-value]


@router.post("/attempts/{attempt_id}/rounds/{round}/submission")
def submit_round(
    attempt_id: int, round: Round, body: SubmissionIn, db: Db, now: Now, actor: Student
) -> RoundSubmitted:
    """Submit a round with feedback at the end; submitting the first pass submits the attempt."""
    attempt, released = _attempt_or_404(db, actor, attempt_id)
    try:
        rows = attempts.submit_round(db, attempt, released, round, body.answers, now)
    except _REFUSABLE as error:
        raise _refused(error) from None
    return RoundSubmitted(tries={row.exercise_id: _try(released, row) for row in rows})


@router.post("/attempts/{attempt_id}/second-round")
def start_second_round(attempt_id: int, db: Db, actor: Student) -> RoundOut:
    """Start the second round, which repeats what failed the first time, or return it."""
    attempt, released = _attempt_or_404(db, actor, attempt_id)
    try:
        attempts.start_second_round(db, attempt, released)
    except attempts.NotSubmitted:
        raise HTTPException(status_code=409, detail="not_submitted") from None
    return _round(db, attempt, released, "second")
