// A student's progress through one lesson in the browser: the answers and assessments of the
// first pass and of the second round. Kept in local storage so a reload resumes the lesson;
// cleared when the lesson is finished. Server-side attempts replace this in slice 4.
import type { LessonPublic } from '../generated/lesson'
import { isCorrect, isOpen, isRendered, type RenderedAnswer, type RenderedExercise, type TryOutcome } from './schema'

export type FeedbackMode = LessonPublic['feedback_mode']
export type Exercise = RenderedExercise

export interface Try {
  answer: RenderedAnswer
  result: TryOutcome
}

export interface ExerciseProgress {
  /** The answer being composed, in the schema's answer shape. */
  draft?: RenderedAnswer
  tries: Try[]
}

export interface RoundProgress {
  exercises: Exercise[]
  answers: Record<string, ExerciseProgress>
  submitted: boolean
}

export interface LessonProgress {
  version: 2
  lessonId: string
  seed: string
  first: RoundProgress
  second: RoundProgress | null
}

/** In immediate mode a wrong first try earns exactly one retry. */
export const MAX_TRIES = 2

/** The exercises the player runs; types without a renderer in this phase are left out. */
export function lessonExercises(lesson: LessonPublic): Exercise[] {
  return lesson.blocks.filter(isRendered)
}

/** Whether a draft is a whole answer: an option picked, text typed, every gap filled. */
export function isComplete(exercise: Exercise, draft: RenderedAnswer | undefined): boolean {
  if (!draft || draft.type !== exercise.type) return false
  switch (draft.type) {
    case 'multiple_choice':
      return true
    case 'short_answer':
      return draft.text.trim() !== ''
    case 'cloze':
      return exercise.type === 'cloze' && exercise.segments.every(
        (segment) => segment.kind !== 'gap' || (draft.gaps[segment.id] ?? '').trim() !== '',
      )
    case 'matching':
      return exercise.type === 'matching' && exercise.left.every((item) => draft.pairs[item.id] !== undefined)
    case 'token_ordering':
      return exercise.type === 'token_ordering' && draft.order.length === exercise.tokens.length
    case 'free_text':
    case 'translation':
      return (
        isOpen(exercise) &&
        draft.text.trim() !== '' &&
        draft.text.length >= exercise.min_characters &&
        draft.text.length <= exercise.max_characters
      )
  }
}

export function newRound(exercises: Exercise[]): RoundProgress {
  return { exercises, answers: {}, submitted: false }
}

export function newProgress(lesson: LessonPublic, seed: string): LessonProgress {
  return { version: 2, lessonId: lesson.id, seed, first: newRound(lessonExercises(lesson)), second: null }
}

export function exerciseProgress(round: RoundProgress, exerciseId: string): ExerciseProgress {
  return round.answers[exerciseId] ?? { tries: [] }
}

export type ExerciseStatus = 'answering' | 'retrying' | 'locked'

export function exerciseStatus(mode: FeedbackMode, round: RoundProgress, exerciseId: string): ExerciseStatus {
  const { tries } = exerciseProgress(round, exerciseId)
  if (mode === 'at_the_end') return round.submitted ? 'locked' : 'answering'
  if (tries.length === 0) return 'answering'
  const last = tries[tries.length - 1]
  // An open answer is sent once and then awaits assessment; there is no retry.
  if (last.result.status === 'pending') return 'locked'
  return last.result.correct || tries.length >= MAX_TRIES ? 'locked' : 'retrying'
}

export function roundComplete(mode: FeedbackMode, round: RoundProgress): boolean {
  if (mode === 'at_the_end') return round.submitted
  return round.exercises.every((exercise) => exerciseStatus(mode, round, exercise.id) === 'locked')
}

/** Closed exercises whose final assessment in the round was not correct. Open exercises are
 * never failed here, answered or not: they are assessed later and never repeated. */
export function failedExercises(round: RoundProgress): string[] {
  return round.exercises
    .filter((exercise) => !isOpen(exercise))
    .filter((exercise) => !isCorrect(exerciseProgress(round, exercise.id).tries.at(-1)?.result))
    .map((exercise) => exercise.id)
}

/** Exercises still to answer before submitting at the end. An open exercise may be left empty,
 * but a started one must be within its length limits. */
export function unanswered(round: RoundProgress): number {
  return round.exercises.filter((exercise) => {
    const draft = exerciseProgress(round, exercise.id).draft
    const text = draft && 'text' in draft ? draft.text : ''
    if (isOpen(exercise) && text.trim() === '') return false
    return !isComplete(exercise, draft)
  }).length
}

/** The closed exercises of a round, which carry a score. */
export function scoredExercises(round: RoundProgress): Exercise[] {
  return round.exercises.filter((exercise) => !isOpen(exercise))
}

export function lessonFinished(mode: FeedbackMode, progress: LessonProgress): boolean {
  if (!roundComplete(mode, progress.first)) return false
  if (failedExercises(progress.first).length === 0) return true
  return progress.second !== null && roundComplete(mode, progress.second)
}

export function setDraft(round: RoundProgress, exerciseId: string, draft: RenderedAnswer): RoundProgress {
  const current = exerciseProgress(round, exerciseId)
  return { ...round, answers: { ...round.answers, [exerciseId]: { ...current, draft } } }
}

export function recordTry(round: RoundProgress, exerciseId: string, attempt: Try): RoundProgress {
  const current = exerciseProgress(round, exerciseId)
  return {
    ...round,
    answers: { ...round.answers, [exerciseId]: { ...current, tries: [...current.tries, attempt] } },
  }
}

const storageKey = (lessonId: string) => `myteacher.lesson-progress.${lessonId}`

export function loadProgress(lesson: LessonPublic, seed: string): LessonProgress | null {
  try {
    const stored = localStorage.getItem(storageKey(lesson.id))
    if (!stored) return null
    const progress = JSON.parse(stored) as LessonProgress
    // Progress saved against an earlier shape of the lesson could strand the student
    // (an exercise that no longer exists can never be answered), so it is discarded.
    return progress.version === 2 &&
      progress.lessonId === lesson.id &&
      progress.seed === seed &&
      JSON.stringify(progress.first.exercises) === JSON.stringify(lessonExercises(lesson))
      ? progress
      : null
  } catch {
    return null
  }
}

export function saveProgress(progress: LessonProgress): void {
  try {
    localStorage.setItem(storageKey(progress.lessonId), JSON.stringify(progress))
  } catch {
    // Storage full or unavailable: the lesson still works, it just will not survive a reload.
  }
}

export function clearProgress(lessonId: string): void {
  try {
    localStorage.removeItem(storageKey(lessonId))
  } catch {
    // Nothing to clear.
  }
}
