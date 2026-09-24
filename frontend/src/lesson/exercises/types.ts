import type { ItemCorrectness } from '../../generated/lesson'
import type { Try } from '../progress'
import type { ExerciseSolution, RenderedAnswer } from '../schema'
import type { PassageReference, Verdict } from './ExerciseFrame'

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
  /** Item ids in the order the student saw them before; a repeat never looks the same. */
  previousLayout?: string[]
  passage?: PassageReference
}

/** Whether `draft` is an answer already tried; a retry spent on it would teach nothing. */
export function triedAlready(
  tries: Try[],
  draft: RenderedAnswer | undefined,
  /** Overrides how answers are compared, for types where different ids mean the same answer. */
  compareAs?: (answer: RenderedAnswer) => string,
): boolean {
  if (!draft) return false
  const key = (answer: RenderedAnswer) => {
    if (compareAs) return compareAs(answer)
    if (answer.type === 'short_answer') return JSON.stringify({ ...answer, text: answer.text.trim() })
    if (answer.type === 'matching') return JSON.stringify(Object.entries(answer.pairs).sort())
    if (answer.type === 'cloze') return JSON.stringify(Object.entries(answer.gaps).sort())
    return JSON.stringify(answer)
  }
  return tries.some((attempt) => key(attempt.answer) === key(draft))
}
