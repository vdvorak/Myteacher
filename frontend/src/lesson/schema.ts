// Names for the unions of the generated lesson schema. The generator names models, not the
// unions between them, so they are derived here from the generated types and never restated.
import type {
  AssessmentResult,
  AssessmentUnavailable,
  ClozeAnswer,
  ClozeExercisePublic,
  ExplanationBlock,
  LessonPublic,
  MatchingAnswer,
  MatchingExercisePublic,
  TokenOrderingAnswer,
  TokenOrderingExercisePublic,
  MultipleChoiceAnswer,
  MultipleChoiceExercisePublic,
  ShortAnswerAnswer,
  ShortAnswerExercisePublic,
} from '../generated/lesson'

export type LessonBlockPublic = LessonPublic['blocks'][number]
export type ExercisePublic = Exclude<LessonBlockPublic, ExplanationBlock>
export type AssessmentOutcome = AssessmentResult | AssessmentUnavailable
export type ExerciseSolution = NonNullable<AssessmentResult['solution']>

/** The exercise types this phase renders and assesses. */
export type RenderedExercise =
  | MultipleChoiceExercisePublic
  | ShortAnswerExercisePublic
  | ClozeExercisePublic
  | MatchingExercisePublic
  | TokenOrderingExercisePublic
export type RenderedAnswer =
  | MultipleChoiceAnswer
  | ShortAnswerAnswer
  | ClozeAnswer
  | MatchingAnswer
  | TokenOrderingAnswer

const renderedTypes: ReadonlySet<string> = new Set<RenderedExercise['type']>([
  'multiple_choice',
  'short_answer',
  'cloze',
  'matching',
  'token_ordering',
])

export function isRendered(block: LessonBlockPublic): block is RenderedExercise {
  return renderedTypes.has(block.type)
}
