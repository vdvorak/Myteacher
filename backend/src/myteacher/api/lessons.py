from typing import Annotated

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError

from myteacher.accounts.models import Account
from myteacher.api.deps import requires
from myteacher.lesson.assessment import AnswerMismatch, answer_key, assess
from myteacher.lesson.fixtures import fixture_lessons
from myteacher.lesson.schema import (
    AnswerKey,
    AssessmentOutcome,
    ExerciseAnswer,
    LessonDocument,
    LessonPublic,
    SecondRound,
    SecondRoundRequest,
    exercise_to_public,
    to_public,
)
from myteacher.lesson.second_round import UnknownExercise, second_round
from myteacher.policy import is_teacher

router = APIRouter(tags=["lessons"])
Teacher = Annotated[Account, requires(is_teacher)]


class FieldError(BaseModel):
    loc: list[str | int]
    msg: str
    type: str


class ValidationReport(BaseModel):
    valid: bool
    errors: list[FieldError]


@router.post(
    "/lessons/validate",
    response_model=ValidationReport,
    responses={422: {"model": ValidationReport}},
)
async def validate_lesson(request: Request) -> ValidationReport | JSONResponse:
    # The body is read raw so that unparseable JSON is reported in the same shape.
    try:
        LessonDocument.model_validate_json(await request.body())
    except ValidationError as error:
        report = ValidationReport(
            valid=False,
            errors=[
                FieldError(loc=list(e["loc"]), msg=e["msg"], type=e["type"]) for e in error.errors()
            ],
        )
        return JSONResponse(status_code=422, content=report.model_dump())
    return ValidationReport(valid=True, errors=[])


def _lesson(lesson_id: str) -> LessonDocument:
    lesson = fixture_lessons().get(lesson_id)
    if lesson is None:
        raise HTTPException(status_code=404, detail="lesson not found")
    return lesson


@router.get("/lessons/{lesson_id}", response_model=LessonPublic)
def get_lesson(lesson_id: str) -> LessonPublic:
    return to_public(_lesson(lesson_id))


@router.post(
    "/lessons/{lesson_id}/exercises/{exercise_id}/assessment", response_model=AssessmentOutcome
)
def assess_answer(
    lesson_id: str, exercise_id: str, answer: ExerciseAnswer, reveal: bool = True
) -> AssessmentOutcome:
    """Assess one answer to a sample lesson. `reveal=false` marks a try the student may retry: a
    wrong answer then comes back without its solution. Stateless: work a student hands in goes
    through an attempt, which decides server-side how many tries remain."""
    lesson = _lesson(lesson_id)
    exercise = lesson.exercise(exercise_id)
    if exercise is None:
        raise HTTPException(status_code=404, detail="exercise not found")
    try:
        return assess(exercise, answer, language=lesson.language, reveal=reveal)
    except AnswerMismatch as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post("/lessons/{lesson_id}/second-round", response_model=SecondRound)
def get_second_round(lesson_id: str, request: SecondRoundRequest) -> SecondRound:
    try:
        repeats = second_round(_lesson(lesson_id), request.failed_exercise_ids, request.seed)
    except UnknownExercise as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return SecondRound(exercises=[exercise_to_public(exercise) for exercise in repeats])


@router.get("/lessons/{lesson_id}/answer-key", response_model=AnswerKey)
def get_answer_key(lesson_id: str, actor: Teacher) -> AnswerKey:
    """Canonical solutions for a printed answer key, fetched only when a print asks for one.
    Never part of the lesson payload, and for teachers only."""
    return answer_key(_lesson(lesson_id))
