// Names for the unions of the generated lesson schema. The generator names models, not the
// unions between them, so they are derived here from the generated types and never restated.
import type {
  AssessmentPending,
  AssessmentResult,
  AssessmentUnavailable,
  FreeTextAnswer,
  FreeTextExercisePublic,
  PassageBlock,
  TranslationAnswer,
  TranslationExercisePublic,
  TokenSelectionAnswer,
  TokenSelectionExercisePublic,
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
export type ExercisePublic = Exclude<LessonBlockPublic, ExplanationBlock | PassageBlock>
export type AssessmentOutcome = AssessmentResult | AssessmentPending | AssessmentUnavailable
/** What the player records for a try: a score, or an open answer awaiting assessment. */
export type TryOutcome = AssessmentResult | AssessmentPending
export type ExerciseSolution = NonNullable<AssessmentResult['solution']>

/** The exercise types this phase renders and assesses. */
export type RenderedExercise =
  | MultipleChoiceExercisePublic
  | ShortAnswerExercisePublic
  | ClozeExercisePublic
  | MatchingExercisePublic
  | TokenOrderingExercisePublic
  | TokenSelectionExercisePublic
  | FreeTextExercisePublic
  | TranslationExercisePublic
export type OpenExercise = FreeTextExercisePublic | TranslationExercisePublic
export type RenderedAnswer =
  | MultipleChoiceAnswer
  | ShortAnswerAnswer
  | ClozeAnswer
  | MatchingAnswer
  | TokenOrderingAnswer
  | TokenSelectionAnswer
  | FreeTextAnswer
  | TranslationAnswer

const renderedTypes: ReadonlySet<string> = new Set<RenderedExercise['type']>([
  'multiple_choice',
  'short_answer',
  'cloze',
  'matching',
  'token_ordering',
  'token_selection',
  'free_text',
  'translation',
])

/** Open types are answered in free text and assessed later against a rubric, never here. */
export function isOpen(exercise: RenderedExercise): exercise is OpenExercise {
  return exercise.type === 'free_text' || exercise.type === 'translation'
}

export function isCorrect(outcome: TryOutcome | undefined): boolean {
  return outcome?.status === 'assessed' && outcome.correct
}

export function isRendered(block: LessonBlockPublic): block is RenderedExercise {
  return renderedTypes.has(block.type)
}
