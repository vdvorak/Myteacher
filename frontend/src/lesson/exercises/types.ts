import type { ItemCorrectness } from '../../generated/lesson'
import type { Try } from '../progress'
import type { ExerciseSolution, RenderedAnswer } from '../schema'
import type { Verdict } from './ExerciseFrame'

/** What the lesson player hands every exercise renderer. Renderers are controlled. */
export interface ExerciseViewProps<E, A extends RenderedAnswer> {
  exercise: E
  /** The layout is derived from the seed, never stored pre-shuffled. */
  seed: string
  draft: A | undefined
  onDraft: (draft: A) => void
  tries: Try[]
  locked: boolean
  verdict?: Verdict
  solution?: ExerciseSolution | null
  /** Per-part correctness of the last try (cloze gaps), shown while retrying and when locked. */
  items: ItemCorrectness[]
  onConfirm?: () => void
  checking: boolean
  failed: boolean
}

/** Whether `draft` is an answer already tried; a retry spent on it would teach nothing. */
export function triedAlready(tries: Try[], draft: RenderedAnswer | undefined): boolean {
  if (!draft) return false
  const key = (answer: RenderedAnswer) =>
    JSON.stringify(answer.type === 'short_answer' ? { ...answer, text: answer.text.trim() } : answer)
  return tries.some((attempt) => key(attempt.answer) === key(draft))
}
