import { vi } from 'vitest'
import type { JSX } from 'solid-js'
import { I18nProvider } from '../i18n/i18n'
import type { Locale } from '../i18n/messages'
import type {
  AssessmentResult,
  LessonPublic,
  MultipleChoiceAnswer,
  MultipleChoiceExercisePublic,
} from '../generated/lesson'
import type { LessonApi } from './LessonPlayer'

export function withI18n(ui: () => JSX.Element, locale: Locale = 'en') {
  return () => <I18nProvider initialLocale={locale}>{ui()}</I18nProvider>
}

export const locationExercise: MultipleChoiceExercisePublic = {
  type: 'multiple_choice',
  id: 'location',
  prompt: 'Madrid ___ en el centro de España.',
  options: [
    { id: 'es', text: 'es' },
    { id: 'esta', text: 'está' },
    { id: 'son', text: 'son' },
    { id: 'estan', text: 'están' },
  ],
  hint: 'Is the sentence saying *where* Madrid is?',
}

export const originExercise: MultipleChoiceExercisePublic = {
  type: 'multiple_choice',
  id: 'origin',
  prompt: 'Nosotros ___ de Brno.',
  options: [
    { id: 'somos', text: 'somos' },
    { id: 'estamos', text: 'estamos' },
    { id: 'sois', text: 'sois' },
  ],
  hint: 'Origin does not change from day to day.',
}

export const sampleLesson: LessonPublic = {
  id: 'es-ser-estar',
  title: 'Ser, or estar?',
  language: 'es',
  feedback_mode: 'immediate',
  blocks: [
    { type: 'explanation', markdown: 'Spanish has two verbs for *to be*: **ser** and **estar**.' },
    locationExercise,
    originExercise,
  ],
}

export const atTheEndLesson: LessonPublic = {
  ...sampleLesson,
  id: 'es-ser-estar-check',
  feedback_mode: 'at_the_end',
}

/** The answer key the fake backend grades against; the player itself never sees it. */
export const answerKey: Record<string, string> = { location: 'esta', origin: 'somos' }

/** A stand-in for the backend: grades with `answerKey` and repeats exercises reversed. */
export function fakeApi(lesson: LessonPublic = sampleLesson) {
  const assess = vi.fn(
    async (
      exerciseId: string,
      answer: MultipleChoiceAnswer,
      options: { reveal: boolean },
    ): Promise<AssessmentResult> => {
      const correct = answerKey[exerciseId] === answer.option_id
      return {
        exercise_id: exerciseId,
        score: correct ? 1 : 0,
        correct,
        solution:
          correct || options.reveal
            ? {
                type: 'multiple_choice',
                option_id: answerKey[exerciseId],
                explanation: `Because of **${exerciseId}**.`,
              }
            : null,
      }
    },
  )
  const secondRound = vi.fn(async (failed: string[], _seed: string) => ({
    exercises: lesson.blocks
      .filter((block): block is MultipleChoiceExercisePublic => block.type === 'multiple_choice')
      .filter((exercise) => failed.includes(exercise.id))
      .map((exercise) => ({ ...exercise, options: [...exercise.options].reverse() })),
  }))
  return { assess, secondRound } satisfies LessonApi
}
