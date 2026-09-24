// Names for the unions of the generated lesson schema. The generator names models, not the
// unions between them, so they are derived here from the generated types and never restated.
import type {
  AssessmentResult,
  AssessmentUnavailable,
  ExplanationBlock,
  LessonPublic,
} from '../generated/lesson'

export type LessonBlockPublic = LessonPublic['blocks'][number]
export type ExercisePublic = Exclude<LessonBlockPublic, ExplanationBlock>
export type AssessmentOutcome = AssessmentResult | AssessmentUnavailable
