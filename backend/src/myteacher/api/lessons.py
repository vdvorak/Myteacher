from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError

from myteacher.lesson.assessment import AnswerMismatch, assess
from myteacher.lesson.fixtures import fixture_lessons
from myteacher.lesson.schema import (
    AssessmentResult,
    ExerciseAnswer,
    LessonDocument,
    LessonPublic,
    to_public,
)

router = APIRouter(tags=["lessons"])


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
    "/lessons/{lesson_id}/exercises/{exercise_id}/assessment", response_model=AssessmentResult
)
def assess_answer(lesson_id: str, exercise_id: str, answer: ExerciseAnswer) -> AssessmentResult:
    exercise = _lesson(lesson_id).exercise(exercise_id)
    if exercise is None:
        raise HTTPException(status_code=404, detail="exercise not found")
    try:
        return assess(exercise, answer)
    except AnswerMismatch as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
