/* Generated from schema/lesson.schema.json by scripts/generate-schema.sh. Do not edit. */

export interface MyteacherLessonSchema {
  [k: string]: unknown
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "AssessmentResult".
 */
export interface AssessmentResult {
  exercise_id: string
  score: number
  correct: boolean
  /**
   * Withheld (null) for a wrong answer the student may still retry.
   */
  solution: MultipleChoiceSolution | null
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "MultipleChoiceSolution".
 */
export interface MultipleChoiceSolution {
  type: 'multiple_choice'
  option_id: string
  explanation: string | null
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "ChoiceOption".
 */
export interface ChoiceOption {
  id: string
  text: string
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "ExplanationBlock".
 */
export interface ExplanationBlock {
  type: 'explanation'
  /**
   * Constrained Markdown (CommonMark without raw HTML).
   */
  markdown: string
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "FieldError".
 */
export interface FieldError {
  loc: (string | number)[]
  msg: string
  type: string
}
/**
 * A lesson as stored and authored: canonical, unshuffled, with its answer key.
 *
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "LessonDocument".
 */
export interface LessonDocument {
  id: string
  title: string
  language: string
  /**
   * immediate: each closed answer is assessed at once, with one retry and a hint after a wrong answer. at_the_end: nothing is assessed until the lesson is submitted.
   */
  feedback_mode: 'immediate' | 'at_the_end'
  /**
   * @minItems 1
   */
  blocks: [ExplanationBlock | MultipleChoiceExercise, ...(ExplanationBlock | MultipleChoiceExercise)[]]
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "MultipleChoiceExercise".
 */
export interface MultipleChoiceExercise {
  type: 'multiple_choice'
  id: string
  /**
   * Constrained Markdown (CommonMark without raw HTML).
   */
  prompt: string
  /**
   * @minItems 2
   * @maxItems 8
   */
  options: [ChoiceOption, ChoiceOption, ...ChoiceOption[]]
  correct_option_id: string
  hint?: string | null
  solution_explanation?: string | null
}
/**
 * A lesson as the browser receives it: no answer key, no solutions.
 *
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "LessonPublic".
 */
export interface LessonPublic {
  id: string
  title: string
  language: string
  /**
   * immediate: each closed answer is assessed at once, with one retry and a hint after a wrong answer. at_the_end: nothing is assessed until the lesson is submitted.
   */
  feedback_mode: 'immediate' | 'at_the_end'
  blocks: (ExplanationBlock | MultipleChoiceExercisePublic)[]
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "MultipleChoiceExercisePublic".
 */
export interface MultipleChoiceExercisePublic {
  type: 'multiple_choice'
  id: string
  /**
   * Constrained Markdown (CommonMark without raw HTML).
   */
  prompt: string
  options: ChoiceOption[]
  hint: string | null
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "MultipleChoiceAnswer".
 */
export interface MultipleChoiceAnswer {
  type: 'multiple_choice'
  option_id: string
}
/**
 * Varied repeats of the failed exercises, in lesson order; empty when nothing failed.
 *
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "SecondRound".
 */
export interface SecondRound {
  exercises: MultipleChoiceExercisePublic[]
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "SecondRoundRequest".
 */
export interface SecondRoundRequest {
  failed_exercise_ids: string[]
  seed: string
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "ValidationReport".
 */
export interface ValidationReport {
  valid: boolean
  errors: FieldError[]
}
