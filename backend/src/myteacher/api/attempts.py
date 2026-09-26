"""A learner's releases and their attempts (ADR 0011): a student sees only what is released to
them in the runs they are on, a participant what is released in their link run (ADR 0012), and
they work on it through an attempt the server owns (#19)."""

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field, field_serializer

from myteacher.api.deps import Db, Now
from myteacher.api.participants import LearnerActor
from myteacher.courses.models import ClassroomMaterial, ClassroomMaterialVersion, Course, Topic
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
from myteacher.runs import attempts, open_assessment
from myteacher.runs import service as runs
from myteacher.runs.attempts import Round
from myteacher.runs.learners import Learner
from myteacher.runs.models import Assessment, Attempt, MaterialRelease

router = APIRouter(tags=["attempts"])

TryOutcome = Annotated[AssessmentResult | AssessmentPending, Field(discriminator="status")]


def _utc(at: datetime | None) -> str | None:
    return at.isoformat().replace("+00:00", "Z") if at is not None else None


class Progress(BaseModel):
    answered: int
    total: int


class Score(BaseModel):
    # What the student sees: the points of the first pass, of how many exercises, and how many
    # written answers still wait for results to be published.
    points: float
    total: int
    pending: int


class RetractionNotice(BaseModel):
    # What the teacher told the student.
    reason: str
    # The whole release was retracted, not just the student's attempt.
    whole_release: bool


class StudentRelease(BaseModel):
    id: int
    title: str
    topic: str
    # The course's name.
    course: str
    # The run's name.
    run: str
    released_at: datetime
    due_at: datetime | None
    state: Literal["not_started", "in_progress", "submitted"]
    # Whether the attempt that counts was submitted after the due date.
    late: bool
    # The last submitted attempt, which is the one that counts.
    counting_attempt_id: int | None
    # Of the attempt being worked on.
    progress: Progress | None
    # Of the attempt that counts.
    score: Score | None
    # Results were published for the attempt that counts since the student last looked.
    new_assessment: bool
    # Why the student's latest attempt, or the release, was retracted.
    retraction: RetractionNotice | None
    # Whether a new attempt may be started now.
    can_start: bool

    @field_serializer("released_at", "due_at")
    def _utc(self, at: datetime | None) -> str | None:
        return _utc(at)


class PublishedReview(BaseModel):
    """What the teacher published of an assessment: the assistant's score of an open answer or
    the teacher's override, with the feedback for the student and the override's reason."""

    score: float | None
    feedback: str | None
    reason: str | None


class AssessmentReview(BaseModel):
    """An assessment as the run teacher sees it."""

    id: int
    # The score that counts: the override, the assistant's, or the deterministic one.
    score: float | None
    assistant_score: float | None
    justification: str | None
    feedback: str | None
    # The assistant's output did not fit, even after the retry.
    flagged: bool
    override_score: float | None
    override_reason: str | None
    # What the students see is up to date.
    published: bool

    @classmethod
    def of(cls, row: Assessment) -> "AssessmentReview":
        return cls(
            id=row.id,
            score=open_assessment.score_of(row),
            assistant_score=row.assistant_score,
            justification=row.justification,
            feedback=row.feedback,
            flagged=row.assistant_failed,
            override_score=row.override_score,
            override_reason=row.override_reason,
            published=open_assessment.to_publish(row) is not None
            and not open_assessment.unpublished(row),
        )


class Try(BaseModel):
    answer: ExerciseAnswer
    result: TryOutcome
    # What the teacher published of its assessment; for the student.
    review: PublishedReview | None = None
    # The assessment in full; for the run teacher only.
    assessment: AssessmentReview | None = None


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
    # The attempt being worked on, or else the one that counts.
    attempt: AttemptOut | None


class SubmissionIn(BaseModel):
    # Answers not saved as drafts yet; they overwrite the drafts.
    answers: dict[Identifier, ExerciseAnswer] = {}


class RoundSubmitted(BaseModel):
    # By exercise id, each with the answer assessed, which may be a draft saved before; an open
    # exercise left empty has none.
    tries: dict[str, Try]


def _release_or_404(db: InstanceSession, actor: Learner, release_id: int) -> MaterialRelease:
    released = attempts.release_for(db, actor, release_id)
    if released is None:
        raise HTTPException(status_code=404)
    return released


def _attempt_or_404(
    db: InstanceSession, actor: Learner, attempt_id: int, now: datetime
) -> tuple[Attempt, MaterialRelease]:
    found = attempts.attempt_for(db, actor, attempt_id)
    if found is None:
        raise HTTPException(status_code=404)
    if found[0].retracted_at is not None:
        # The teacher retracted it: the student is taken out, and the release says why.
        raise HTTPException(status_code=410, detail="attempt_retracted")
    attempts.close_past_due(db, *found, now)
    return found


def _try(released: MaterialRelease, row: Assessment, *, teacher: bool = False) -> Try:
    """A try as the student gets it, or for the teacher as assessed, solution included."""
    if teacher:
        return Try(
            answer=attempts.answer_of(row),
            result=attempts.assessed(row),  # type: ignore[arg-type]
            assessment=AssessmentReview.of(row),
        )
    return Try(
        answer=attempts.answer_of(row),
        result=attempts.served(released, row),  # type: ignore[arg-type]
        review=PublishedReview(**row.published) if row.published else None,
    )


def _round(
    db: InstanceSession,
    attempt: Attempt,
    released: MaterialRelease,
    round: Round,
    *,
    teacher: bool = False,
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
                tries=[_try(released, row, teacher=teacher) for row in tries.get(exercise_id, [])],
            )
            for exercise_id in sorted(set(drafts) | set(tries))
        },
        submitted=(attempt.submitted_at if round == "first" else attempt.second_submitted_at)
        is not None,
    )


def attempt_out(
    db: InstanceSession, attempt: Attempt, released: MaterialRelease, *, teacher: bool = False
) -> AttemptOut:
    """The attempt for its student, or for the run teacher with every solution."""
    return AttemptOut(
        id=attempt.id,
        release_id=released.id,
        number=attempt.number,
        seed=attempt.seed,
        lesson=to_public(attempts.lesson_of(db, released)),
        first=_round(db, attempt, released, "first", teacher=teacher),
        second=(
            _round(db, attempt, released, "second", teacher=teacher)
            if attempt.second_round is not None
            else None
        ),
        started_at=attempt.started_at,
        submitted_at=attempt.submitted_at,
        late=attempt.late,
    )


def _summary(
    db: InstanceSession, released: MaterialRelease, student: Learner, standing: attempts.Standing
) -> StudentRelease:
    version = db.get_one(ClassroomMaterialVersion, released.version_id)
    topic = db.get_one(Topic, db.get_one(ClassroomMaterial, released.material_id).topic_id)
    run = runs.get_run(db, released.run_id)
    assert run is not None
    counting = standing.counting
    progress = attempts.progress(db, released, standing.open) if standing.open else None
    score = attempts.score(db, released, counting) if counting else None
    notice = attempts.retraction_notice(db, released, student)
    return StudentRelease(
        id=released.id,
        title=version.lesson["title"],
        topic=topic.name,
        course=db.get_one(Course, run.course_id).name,
        run=run.name,
        released_at=released.released_at,
        due_at=released.due_at,
        state=standing.state,
        late=standing.counting.late if standing.counting else False,
        counting_attempt_id=standing.counting.id if standing.counting else None,
        progress=Progress(answered=progress[0], total=progress[1]) if progress else None,
        score=Score(points=score[0], total=score[1], pending=score[2]) if score else None,
        new_assessment=counting is not None and attempts.new_results(db, counting),
        retraction=RetractionNotice(reason=notice[0], whole_release=notice[1]) if notice else None,
        can_start=standing.can_start,
    )


@router.get("/my/releases")
def my_releases(db: Db, now: Now, actor: LearnerActor) -> list[StudentRelease]:
    """The material released to the student in the runs they are on, the latest first."""
    return [
        _summary(db, released, actor, attempts.standing(db, released, actor, now))
        for released in attempts.releases_for(db, actor)
    ]


@router.get("/my/releases/{release_id}")
def my_release(release_id: int, db: Db, now: Now, actor: LearnerActor) -> ReleaseDetail:
    released = _release_or_404(db, actor, release_id)
    standing = attempts.standing(db, released, actor, now)
    shown = standing.open or standing.counting
    summary = _summary(db, released, actor, standing)
    # The student looks at the attempt that counts now: what was published so far is no longer
    # new. Shown another attempt, being worked on, they have not seen its results yet.
    if standing.counting is not None and shown is standing.counting:
        standing.counting.results_seen_at = now
    return ReleaseDetail(
        **summary.model_dump(),
        feedback_mode=released.feedback_mode,  # type: ignore[arg-type]
        attempts=released.attempts,  # type: ignore[arg-type]
        late_submissions=released.late_submissions,  # type: ignore[arg-type]
        show_solutions=released.show_solutions,
        attempt=attempt_out(db, shown, released) if shown else None,
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
    release_id: int, response: Response, db: Db, now: Now, actor: LearnerActor
) -> AttemptOut:
    """Start an attempt on the release, or resume the one being worked on."""
    released = _release_or_404(db, actor, release_id)
    try:
        attempt, created = attempts.start(db, released, actor, now)
    except attempts.NoMoreAttempts:
        raise HTTPException(status_code=409, detail="no_more_attempts") from None
    except attempts.PastDue:
        raise HTTPException(status_code=409, detail="past_due") from None
    except attempts.ReleaseRetracted:
        raise HTTPException(status_code=410, detail="release_retracted") from None
    if not created:
        response.status_code = 200
    return attempt_out(db, attempt, released)


@router.get("/attempts/{attempt_id}")
def read_attempt(attempt_id: int, db: Db, now: Now, actor: LearnerActor) -> AttemptOut:
    return attempt_out(db, *_attempt_or_404(db, actor, attempt_id, now))


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
    actor: LearnerActor,
) -> Response:
    """Save the answer being composed, so the attempt continues on another device."""
    attempt, released = _attempt_or_404(db, actor, attempt_id, now)
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
    actor: LearnerActor,
) -> AssessmentResult | AssessmentPending:
    """Assess one try with immediate feedback; the attempt decides whether it may be taken and
    whether the solution comes with it."""
    attempt, released = _attempt_or_404(db, actor, attempt_id, now)
    try:
        row = attempts.take_try(db, attempt, released, round, exercise_id, body, now)
    except _REFUSABLE as error:
        raise _refused(error) from None
    return attempts.served(released, row)  # type: ignore[return-value]


@router.post("/attempts/{attempt_id}/rounds/{round}/submission")
def submit_round(
    attempt_id: int, round: Round, body: SubmissionIn, db: Db, now: Now, actor: LearnerActor
) -> RoundSubmitted:
    """Submit a round with feedback at the end; submitting the first pass submits the attempt."""
    attempt, released = _attempt_or_404(db, actor, attempt_id, now)
    try:
        rows = attempts.submit_round(db, attempt, released, round, body.answers, now)
    except _REFUSABLE as error:
        raise _refused(error) from None
    return RoundSubmitted(tries={row.exercise_id: _try(released, row) for row in rows})


@router.post("/attempts/{attempt_id}/second-round")
def start_second_round(attempt_id: int, db: Db, now: Now, actor: LearnerActor) -> RoundOut:
    """Start the second round, which repeats what failed the first time, or return it."""
    attempt, released = _attempt_or_404(db, actor, attempt_id, now)
    try:
        attempts.start_second_round(db, attempt, released)
    except attempts.NotSubmitted:
        raise HTTPException(status_code=409, detail="not_submitted") from None
    return _round(db, attempt, released, "second")
