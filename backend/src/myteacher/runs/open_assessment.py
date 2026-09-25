"""Open answers assessed by the assistant, the teacher's overrides and publishing results (#70).

Each open answer of a submitted attempt is assessed in an isolated call with no tools, on the run
teacher's key, the answer embedded as delimited data marked untrusted and the output validated
against the exercise's rubric (ADR 0009); an injection can at worst spoil that one assessment.
Output that does not fit even after the service's retry flags the answer for the teacher. Every
call is recorded with its prompt version, and an override is a reaction to it (ADR 0010).

Students see the assistant's assessments and the teacher's overrides only once the teacher
publishes them; each assessment keeps what was published, so later changes wait for the next.
"""

from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, Field, model_validator
from sqlalchemy import exists, select, update

from myteacher.accounts.models import Account
from myteacher.assistant.generations import GenerationReaction
from myteacher.assistant.service import AssistantFailed, Task, generate_recorded
from myteacher.courses import service as courses
from myteacher.jobs.models import Job
from myteacher.jobs.runner import JobContext, Work
from myteacher.lesson.schema import OpenExercise, Rubric, TranslationExercise
from myteacher.persistence import InstanceSession
from myteacher.runs import attempts
from myteacher.runs import service as runs
from myteacher.runs.models import Assessment, Attempt, MaterialRelease

TASK_KIND = "open_assessment"


class Awarded(BaseModel):
    criterion_id: str
    points: Annotated[int, Field(ge=0)]
    comment: Annotated[str, Field(max_length=500)]


class OpenAssessment(BaseModel):
    criteria: list[Awarded]
    justification: Annotated[str, Field(min_length=1, max_length=2000)]
    feedback: Annotated[str, Field(min_length=1, max_length=2000)]


def output_for(rubric: Rubric) -> type[OpenAssessment]:
    """The output type for one rubric: every criterion awarded once, within its points. Output
    that breaks it counts as invalid, so the service retries it once."""
    maxima = {criterion.id: criterion.points for criterion in rubric.criteria}

    class FitsTheRubric(OpenAssessment):
        @model_validator(mode="after")
        def _fits(self) -> "FitsTheRubric":
            ids = sorted(awarded.criterion_id for awarded in self.criteria)
            if ids != sorted(maxima):
                raise ValueError(f"award each of the criteria {sorted(maxima)} exactly once")
            for awarded in self.criteria:
                if awarded.points > maxima[awarded.criterion_id]:
                    raise ValueError(
                        f"criterion {awarded.criterion_id!r} has at most "
                        f"{maxima[awarded.criterion_id]} points"
                    )
            return self

    return FitsTheRubric


def share(rubric: Rubric, output: OpenAssessment) -> float:
    total = sum(criterion.points for criterion in rubric.criteria)
    return sum(awarded.points for awarded in output.criteria) / total


# Which answers wait for the assistant


def _of_release(released: MaterialRelease):
    return (
        select(Assessment)
        .join(Attempt, Attempt.id == Assessment.attempt_id)
        .where(
            Attempt.release_id == released.id,
            Attempt.submitted_at.is_not(None),
            Attempt.retracted_at.is_(None),
        )
    )


def waiting(db: InstanceSession, released: MaterialRelease) -> list[Assessment]:
    """Open answers of submitted attempts with no assessment yet, flagged ones included, unless
    the teacher already scored them."""
    return list(
        db.scalars(
            _of_release(released)
            .where(
                Assessment.status == "pending",
                Assessment.assistant_score.is_(None),
                Assessment.override_score.is_(None),
            )
            .order_by(Assessment.id)
        )
    )


def assessments_of(db: InstanceSession, released: MaterialRelease) -> list[Assessment]:
    """Every assessment of the release's submitted attempts not retracted."""
    return list(db.scalars(_of_release(released).order_by(Assessment.id)))


def running(db: InstanceSession, released: MaterialRelease) -> bool:
    if released.assessment_job_id is None:
        return False
    job = db.get(Job, released.assessment_job_id)
    return job is not None and job.state in ("queued", "running")


def claim(db: InstanceSession, released: MaterialRelease, job: Job) -> bool:
    """Make the job the release's assessment, unless another one runs, even one another request
    started since this one looked."""
    busy = exists().where(
        Job.id == MaterialRelease.assessment_job_id, Job.state.in_(("queued", "running"))
    )
    claimed = db.execute(
        update(MaterialRelease)
        .where(MaterialRelease.id == released.id, ~busy)
        .values(assessment_job_id=job.id)
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:  # type: ignore[attr-defined]
        return False
    released.assessment_job_id = job.id
    return True


# The job


def _inputs(exercise: OpenExercise, answer: str, language: str, feedback_language: str):
    described: dict[str, Any] = {
        "type": exercise.type,
        "prompt": exercise.prompt,
        "rubric": exercise.rubric.model_dump(mode="json"),
    }
    if isinstance(exercise, TranslationExercise):
        described |= {
            "source_text": exercise.source_text,
            "source_language": exercise.source_language,
            "target_language": exercise.target_language,
            "model_answer": exercise.model_answer,
        }
    return {
        "exercise": described,
        "lesson_language": language,
        "feedback_language": feedback_language,
        "student_answer": {"untrusted": True, "text": answer},
    }


def assessing(release_id: int) -> Work:
    """The work of a job assessing the release's waiting open answers, one call each."""

    async def work(db: InstanceSession, job: Job, ctx: JobContext) -> dict[str, Any]:
        released = db.scalars(select(MaterialRelease).where(MaterialRelease.id == release_id)).one()
        run = runs.get_run(db, released.run_id)
        assert run is not None
        course = courses.get_course(db, run.course_id)
        assert course is not None
        teacher = db.get_one(Account, run.teacher_id)
        lesson = attempts.lesson_of(db, released)
        counts = {"assessed": 0, "flagged": 0}
        for assessment_id in [row.id for row in waiting(db, released)]:
            # The service commits before each call, so every row is read afresh.
            row = db.get_one(Assessment, assessment_id)
            exercise = lesson.exercise(row.exercise_id)
            if not isinstance(exercise, OpenExercise) or row.override_score is not None:
                continue
            attempt = db.get_one(Attempt, row.attempt_id)
            if attempt.retracted_at is not None:
                # Retracted while the job ran: it counts for nothing, so it is not paid for.
                continue
            text = getattr(attempts.answer_of(row), "text", "")
            student_id = attempt.student_id
            try:
                output, generation_id = await generate_recorded(
                    ctx.assistant,
                    db,
                    Task(TASK_KIND, output_for(exercise.rubric), slot="strong"),
                    teacher=teacher,
                    inputs=_inputs(exercise, text, lesson.language, course.instruction_language),
                    course_id=course.id,
                    student_id=student_id,
                )
            except AssistantFailed as failure:
                if failure.kind != "invalid_output":
                    raise
                db.get_one(Assessment, assessment_id).assistant_failed = True
                db.commit()
                counts["flagged"] += 1
                continue
            row = db.get_one(Assessment, assessment_id)
            if row.override_score is None:
                row.assistant_score = share(exercise.rubric, output)
                row.justification = output.justification
                row.feedback = output.feedback
                row.generation_id = generation_id
                row.assistant_failed = False
                counts["assessed"] += 1
            db.commit()
        return counts

    return work


# Overrides and publishing


def score_of(row: Assessment) -> float | None:
    """The score that counts: the teacher's, the assistant's, or the deterministic one."""
    if row.override_score is not None:
        return row.override_score
    if row.assistant_score is not None:
        return row.assistant_score
    return row.score


def override(
    db: InstanceSession,
    row: Assessment,
    *,
    score: float,
    reason: str,
    teacher: Account,
    now: datetime,
) -> None:
    row.override_score = score
    row.override_reason = reason
    row.overridden_by_id = teacher.id
    row.overridden_at = now
    if row.generation_id is not None:
        db.add(
            GenerationReaction(
                generation_id=row.generation_id,
                kind="overridden",
                account_id=teacher.id,
                detail={"assessment_id": row.id, "score": score},
                created_at=now,
            )
        )


def to_publish(row: Assessment) -> dict[str, Any] | None:
    """What the student is to see of the assistant's assessment and the override, if any."""
    if row.override_score is None and row.assistant_score is None:
        return None
    return {"score": score_of(row), "feedback": row.feedback, "reason": row.override_reason}


def unpublished(row: Assessment) -> bool:
    shown = to_publish(row)
    return shown is not None and shown != row.published


def publish(db: InstanceSession, released: MaterialRelease) -> int:
    """Show the students what changed since the last publishing; returns how many changed."""
    changed = [row for row in assessments_of(db, released) if unpublished(row)]
    for row in changed:
        row.published = to_publish(row)
    return len(changed)
