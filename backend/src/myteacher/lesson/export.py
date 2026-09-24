"""Export the lesson schema as one JSON Schema document (draft 2020-12).

The frontend's TypeScript types are generated from this output; CI regenerates
both and fails when the committed files differ.

    uv run python -m myteacher.lesson.export > ../schema/lesson.schema.json
"""

import json

from pydantic.json_schema import models_json_schema

from myteacher.api.lessons import ValidationReport
from myteacher.lesson.schema import (
    AnswerKey,
    AssessmentResult,
    AssessmentUnavailable,
    ClozeAnswer,
    CustomAnswer,
    LessonDocument,
    LessonPublic,
    ListeningAnswer,
    MultipleChoiceAnswer,
    NumericAnswer,
    SecondRound,
    SecondRoundRequest,
    ShortAnswerAnswer,
    SpanHighlightAnswer,
    TableFillAnswer,
)

MODELS = [
    (LessonDocument, "validation"),
    (LessonPublic, "serialization"),
    (MultipleChoiceAnswer, "validation"),
    (ShortAnswerAnswer, "validation"),
    (ClozeAnswer, "validation"),
    (SpanHighlightAnswer, "validation"),
    (TableFillAnswer, "validation"),
    (NumericAnswer, "validation"),
    (ListeningAnswer, "validation"),
    (CustomAnswer, "validation"),
    (AssessmentResult, "serialization"),
    (AssessmentUnavailable, "serialization"),
    (AnswerKey, "serialization"),
    (SecondRoundRequest, "validation"),
    (SecondRound, "serialization"),
    (ValidationReport, "serialization"),
]


def lesson_json_schema() -> dict:
    _, schema = models_json_schema(MODELS, title="Myteacher lesson schema")
    return {"$schema": "https://json-schema.org/draft/2020-12/schema", **schema}


if __name__ == "__main__":
    print(json.dumps(lesson_json_schema(), indent=2, ensure_ascii=False))
