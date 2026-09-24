/* Generated from schema/lesson.schema.json by scripts/generate-schema.sh. Do not edit. */

/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "JsonValue".
 */
export type JsonValue = unknown

export interface MyteacherLessonSchema {
  [k: string]: unknown
}
/**
 * The canonical solution of every exercise in lesson order, for a printed answer key.
 *
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "AnswerKey".
 */
export interface AnswerKey {
  lesson_id: string
  entries: AnswerKeyEntry[]
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "AnswerKeyEntry".
 */
export interface AnswerKeyEntry {
  exercise_id: string
  /**
   * Null for a type without an assessor in this phase.
   */
  solution:
    (MultipleChoiceSolution | ShortAnswerSolution | ClozeSolution | MatchingSolution | TokenOrderingSolution) | null
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
 * via the `definition` "ShortAnswerSolution".
 */
export interface ShortAnswerSolution {
  type: 'short_answer'
  answer: string
  explanation: string | null
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "ClozeSolution".
 */
export interface ClozeSolution {
  type: 'cloze'
  gaps: ClozeGapSolution[]
  explanation: string | null
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "ClozeGapSolution".
 */
export interface ClozeGapSolution {
  id: string
  answer: string
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "MatchingSolution".
 */
export interface MatchingSolution {
  type: 'matching'
  pairs: MatchedPair[]
  explanation: string | null
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "MatchedPair".
 */
export interface MatchedPair {
  left_id: string
  right_id: string
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "TokenOrderingSolution".
 */
export interface TokenOrderingSolution {
  type: 'token_ordering'
  /**
   * The token texts in the first accepted order.
   */
  tokens: string[]
  explanation: string | null
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "AssessmentResult".
 */
export interface AssessmentResult {
  status: 'assessed'
  exercise_id: string
  score: number
  correct: boolean
  /**
   * Per-part correctness for exercises with parts; kept when withheld.
   */
  items?: ItemCorrectness[]
  /**
   * Withheld (null) for a wrong answer the student may still retry.
   */
  solution:
    (MultipleChoiceSolution | ShortAnswerSolution | ClozeSolution | MatchingSolution | TokenOrderingSolution) | null
}
/**
 * Whether one part of an exercise was right: a cloze gap, a matched left item, or a token
 * position (identified by the id of the token the student put there).
 *
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "ItemCorrectness".
 */
export interface ItemCorrectness {
  id: string
  correct: boolean
}
/**
 * The answer fits the exercise, but its type has no assessor in this phase.
 *
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "AssessmentUnavailable".
 */
export interface AssessmentUnavailable {
  status: 'unavailable'
  exercise_id: string
  reason: 'no_assessor_in_this_phase'
}
/**
 * A file stored with the course (attachment storage arrives in slice 3).
 *
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "AttachmentReference".
 */
export interface AttachmentReference {
  attachment_id: string
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "BlankCell".
 */
export interface BlankCell {
  kind: 'blank'
  id: string
  /**
   * @minItems 1
   * @maxItems 20
   */
  accepted_answers: [string, ...string[]]
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "BlankCellPublic".
 */
export interface BlankCellPublic {
  kind: 'blank'
  id: string
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
 * via the `definition` "ClozeAnswer".
 */
export interface ClozeAnswer {
  type: 'cloze'
  /**
   * The typed or placed word per gap id.
   */
  gaps: {
    /**
     * This interface was referenced by `undefined`'s JSON-Schema definition
     * via the `patternProperty` "^[a-z0-9][a-z0-9-]*$".
     */
    [k: string]: string
  }
}
/**
 * A word that may be blanked; `blanked` on the exercise says which are gaps now.
 *
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "ClozeCandidate".
 */
export interface ClozeCandidate {
  kind: 'candidate'
  /**
   * Reaches the browser as the gap id: must not be the answer.
   */
  id: string
  answer: string
  alternatives?: string[]
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "ClozeExercise".
 */
export interface ClozeExercise {
  type: 'cloze'
  id: string
  /**
   * Constrained Markdown (CommonMark without raw HTML).
   */
  prompt: string
  /**
   * @minItems 1
   * @maxItems 200
   */
  segments: [ClozeText | ClozeCandidate, ...(ClozeText | ClozeCandidate)[]]
  /**
   * @minItems 1
   * @maxItems 50
   */
  blanked: [string, ...string[]]
  word_bank?: WordBank | null
  tolerance?: ToleranceRules
  hint?: string | null
  solution_explanation?: string | null
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "ClozeText".
 */
export interface ClozeText {
  kind: 'text'
  text: string
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "WordBank".
 */
export interface WordBank {
  /**
   * @maxItems 20
   */
  distractors?: string[]
}
/**
 * How strictly a typed answer is compared with the accepted answers.
 */
export interface ToleranceRules {
  ignore_case?: boolean
  /**
   * Collapse runs of whitespace; leading and trailing never count.
   */
  normalise_whitespace?: boolean
  /**
   * Accents do not count; ñ stays a letter distinct from n.
   */
  ignore_diacritics?: boolean
  /**
   * Punctuation, including ¿ and ¡, does not count.
   */
  ignore_punctuation?: boolean
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "ClozeExercisePublic".
 */
export interface ClozeExercisePublic {
  type: 'cloze'
  id: string
  /**
   * Constrained Markdown (CommonMark without raw HTML).
   */
  prompt: string
  segments: (ClozeText | ClozeGapPublic)[]
  /**
   * Words to place into the gaps, or null when the student types.
   */
  word_bank: string[] | null
  hint: string | null
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "ClozeGapPublic".
 */
export interface ClozeGapPublic {
  kind: 'gap'
  id: string
}
/**
 * Opaque JSON from a custom exercise frame, validated only for size.
 *
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "CustomAnswer".
 */
export interface CustomAnswer {
  type: 'custom'
  value: JsonValue
}
/**
 * Assistant-written HTML run in a sandbox with a fixed result contract (ADR 0006).
 *
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "CustomExercise".
 */
export interface CustomExercise {
  type: 'custom'
  id: string
  prompt?: string | null
  html: string
  specification: string
  example: string
  /**
   * self_assessed_advisory: the frame reports a self-assessment the teacher confirms. teacher_assessed: the teacher assesses the answer.
   */
  assessment_mode: 'self_assessed_advisory' | 'teacher_assessed'
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "CustomExercisePublic".
 */
export interface CustomExercisePublic {
  type: 'custom'
  id: string
  prompt: string | null
  html: string
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
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "GivenCell".
 */
export interface GivenCell {
  kind: 'given'
  text: string
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
  blocks: [
    (
      | ExplanationBlock
      | MultipleChoiceExercise
      | ShortAnswerExercise
      | ClozeExercise
      | MatchingExercise
      | TokenOrderingExercise
      | SpanHighlightExercise
      | TableFillExercise
      | NumericExercise
      | ListeningExercise
      | CustomExercise
    ),
    ...(
      | ExplanationBlock
      | MultipleChoiceExercise
      | ShortAnswerExercise
      | ClozeExercise
      | MatchingExercise
      | TokenOrderingExercise
      | SpanHighlightExercise
      | TableFillExercise
      | NumericExercise
      | ListeningExercise
      | CustomExercise
    )[]
  ]
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
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "ShortAnswerExercise".
 */
export interface ShortAnswerExercise {
  type: 'short_answer'
  id: string
  /**
   * Constrained Markdown (CommonMark without raw HTML).
   */
  prompt: string
  /**
   * The first is the canonical answer shown as solution.
   *
   * @minItems 1
   * @maxItems 20
   */
  accepted_answers: [string, ...string[]]
  tolerance?: ToleranceRules1
  hint?: string | null
  /**
   * Show the hint before the first try (used by the second round).
   */
  show_hint?: boolean
  solution_explanation?: string | null
}
/**
 * How strictly a typed answer is compared with the accepted answers.
 */
export interface ToleranceRules1 {
  ignore_case?: boolean
  /**
   * Collapse runs of whitespace; leading and trailing never count.
   */
  normalise_whitespace?: boolean
  /**
   * Accents do not count; ñ stays a letter distinct from n.
   */
  ignore_diacritics?: boolean
  /**
   * Punctuation, including ¿ and ¡, does not count.
   */
  ignore_punctuation?: boolean
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "MatchingExercise".
 */
export interface MatchingExercise {
  type: 'matching'
  id: string
  /**
   * Constrained Markdown (CommonMark without raw HTML).
   */
  prompt: string
  /**
   * @minItems 2
   * @maxItems 10
   */
  pairs: [MatchingPair, MatchingPair, ...MatchingPair[]]
  /**
   * Score the share of right pairs instead of all or nothing.
   */
  partial_credit?: boolean
  hint?: string | null
  solution_explanation?: string | null
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "MatchingPair".
 */
export interface MatchingPair {
  id: string
  left: string
  right: string
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "TokenOrderingExercise".
 */
export interface TokenOrderingExercise {
  type: 'token_ordering'
  id: string
  /**
   * Constrained Markdown (CommonMark without raw HTML).
   */
  prompt: string
  /**
   * @minItems 2
   * @maxItems 30
   */
  tokens: [OrderToken, OrderToken, ...OrderToken[]]
  /**
   * Each lists every token id once.
   *
   * @minItems 1
   * @maxItems 10
   */
  accepted_orders: [string[], ...string[][]]
  /**
   * Score the share of tokens in place instead of all or nothing.
   */
  partial_credit?: boolean
  hint?: string | null
  solution_explanation?: string | null
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "OrderToken".
 */
export interface OrderToken {
  id: string
  text: string
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "SpanHighlightExercise".
 */
export interface SpanHighlightExercise {
  type: 'span_highlight'
  id: string
  /**
   * Constrained Markdown (CommonMark without raw HTML).
   */
  prompt: string
  text: string
  /**
   * @minItems 1
   * @maxItems 100
   */
  correct_spans: [TextSpan, ...TextSpan[]]
  hint?: string | null
}
/**
 * Characters `start` (inclusive) to `end` (exclusive) of a text, counted in code points.
 *
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "TextSpan".
 */
export interface TextSpan {
  start: number
  end: number
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "TableFillExercise".
 */
export interface TableFillExercise {
  type: 'table_fill'
  id: string
  /**
   * Constrained Markdown (CommonMark without raw HTML).
   */
  prompt: string
  /**
   * @minItems 1
   * @maxItems 8
   */
  columns: [string, ...string[]]
  /**
   * @minItems 1
   * @maxItems 50
   */
  rows: [(GivenCell | BlankCell)[], ...(GivenCell | BlankCell)[][]]
  hint?: string | null
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "NumericExercise".
 */
export interface NumericExercise {
  type: 'numeric'
  id: string
  /**
   * Constrained Markdown (CommonMark without raw HTML).
   */
  prompt: string
  correct_value: number
  /**
   * Largest accepted absolute difference from the value.
   */
  tolerance?: number
  unit?: string | null
  hint?: string | null
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "ListeningExercise".
 */
export interface ListeningExercise {
  type: 'listening'
  id: string
  /**
   * Constrained Markdown (CommonMark without raw HTML).
   */
  prompt: string
  audio: AttachmentReference
  transcript?: string | null
  /**
   * @minItems 1
   * @maxItems 20
   */
  accepted_answers: [string, ...string[]]
  hint?: string | null
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
  blocks: (
    | ExplanationBlock
    | MultipleChoiceExercisePublic
    | ShortAnswerExercisePublic
    | ClozeExercisePublic
    | MatchingExercisePublic
    | TokenOrderingExercisePublic
    | SpanHighlightExercisePublic
    | TableFillExercisePublic
    | NumericExercisePublic
    | ListeningExercisePublic
    | CustomExercisePublic
  )[]
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
 * via the `definition` "ShortAnswerExercisePublic".
 */
export interface ShortAnswerExercisePublic {
  type: 'short_answer'
  id: string
  /**
   * Constrained Markdown (CommonMark without raw HTML).
   */
  prompt: string
  hint: string | null
  show_hint: boolean
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "MatchingExercisePublic".
 */
export interface MatchingExercisePublic {
  type: 'matching'
  id: string
  /**
   * Constrained Markdown (CommonMark without raw HTML).
   */
  prompt: string
  left: MatchItem[]
  /**
   * In alphabetical order, not paired.
   */
  right: MatchItem[]
  hint: string | null
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "MatchItem".
 */
export interface MatchItem {
  id: string
  text: string
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "TokenOrderingExercisePublic".
 */
export interface TokenOrderingExercisePublic {
  type: 'token_ordering'
  id: string
  /**
   * Constrained Markdown (CommonMark without raw HTML).
   */
  prompt: string
  /**
   * In alphabetical order.
   */
  tokens: MatchItem[]
  hint: string | null
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "SpanHighlightExercisePublic".
 */
export interface SpanHighlightExercisePublic {
  type: 'span_highlight'
  id: string
  /**
   * Constrained Markdown (CommonMark without raw HTML).
   */
  prompt: string
  text: string
  hint: string | null
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "TableFillExercisePublic".
 */
export interface TableFillExercisePublic {
  type: 'table_fill'
  id: string
  /**
   * Constrained Markdown (CommonMark without raw HTML).
   */
  prompt: string
  columns: string[]
  rows: (GivenCell | BlankCellPublic)[][]
  hint: string | null
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "NumericExercisePublic".
 */
export interface NumericExercisePublic {
  type: 'numeric'
  id: string
  /**
   * Constrained Markdown (CommonMark without raw HTML).
   */
  prompt: string
  unit: string | null
  hint: string | null
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "ListeningExercisePublic".
 */
export interface ListeningExercisePublic {
  type: 'listening'
  id: string
  /**
   * Constrained Markdown (CommonMark without raw HTML).
   */
  prompt: string
  audio: AttachmentReference
  hint: string | null
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "ListeningAnswer".
 */
export interface ListeningAnswer {
  type: 'listening'
  text: string
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "MatchingAnswer".
 */
export interface MatchingAnswer {
  type: 'matching'
  /**
   * The right item id chosen for each left item id.
   */
  pairs: {
    /**
     * This interface was referenced by `undefined`'s JSON-Schema definition
     * via the `patternProperty` "^[a-z0-9][a-z0-9-]*$".
     */
    [k: string]: string
  }
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
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "NumericAnswer".
 */
export interface NumericAnswer {
  type: 'numeric'
  value: number
}
/**
 * Varied repeats of the failed exercises, in lesson order; empty when nothing failed.
 *
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "SecondRound".
 */
export interface SecondRound {
  exercises: (
    | MultipleChoiceExercisePublic
    | ShortAnswerExercisePublic
    | ClozeExercisePublic
    | MatchingExercisePublic
    | TokenOrderingExercisePublic
    | SpanHighlightExercisePublic
    | TableFillExercisePublic
    | NumericExercisePublic
    | ListeningExercisePublic
    | CustomExercisePublic
  )[]
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
 * via the `definition` "ShortAnswerAnswer".
 */
export interface ShortAnswerAnswer {
  type: 'short_answer'
  text: string
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "SpanHighlightAnswer".
 */
export interface SpanHighlightAnswer {
  type: 'span_highlight'
  /**
   * @maxItems 100
   */
  spans: TextSpan[]
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "TableFillAnswer".
 */
export interface TableFillAnswer {
  type: 'table_fill'
  /**
   * Answers keyed by blank id.
   */
  cells: {
    /**
     * This interface was referenced by `undefined`'s JSON-Schema definition
     * via the `patternProperty` "^[a-z0-9][a-z0-9-]*$".
     */
    [k: string]: string
  }
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "TokenOrderingAnswer".
 */
export interface TokenOrderingAnswer {
  type: 'token_ordering'
  /**
   * @maxItems 30
   */
  order: string[]
}
/**
 * How strictly a typed answer is compared with the accepted answers.
 *
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "ToleranceRules".
 */
export interface ToleranceRules2 {
  ignore_case?: boolean
  /**
   * Collapse runs of whitespace; leading and trailing never count.
   */
  normalise_whitespace?: boolean
  /**
   * Accents do not count; ñ stays a letter distinct from n.
   */
  ignore_diacritics?: boolean
  /**
   * Punctuation, including ¿ and ¡, does not count.
   */
  ignore_punctuation?: boolean
}
/**
 * This interface was referenced by `MyteacherLessonSchema`'s JSON-Schema
 * via the `definition` "ValidationReport".
 */
export interface ValidationReport {
  valid: boolean
  errors: FieldError[]
}
