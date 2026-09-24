import { vi } from 'vitest'
import type { JSX } from 'solid-js'
import { I18nProvider } from '../i18n/i18n'
import type { Locale } from '../i18n/messages'
import type { AssessmentResult, LessonPublic, MultipleChoiceExercisePublic } from '../generated/lesson'
import { isRendered, type ExercisePublic, type RenderedAnswer, type RenderedExercise } from './schema'
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
export const typedKey: Record<string, string> = { song: 'canción', contraction: "don't" }
/** Right item id per left item id (right ids are public ranks, see the served fixtures). */
export const matchingKey: Record<string, Record<string, string>> = {
  rooms: { p1: 'r3', p2: 'r1', p3: 'r2', p4: 'r4' },
  opposites: { p1: 'r3', p2: 'r1', p3: 'r2' },
}
/** Accepted token orders as public token ids, with the texts of the first order. */
export const orderKey: Record<string, { orders: string[][]; texts: string[] }> = {
  'where-bathroom': { orders: [['t4', 't3', 't2', 't1']], texts: ['¿Dónde', 'está', 'el', 'baño?'] },
  yesterday: {
    orders: [
      ['t2', 't4', 't3', 't1', 't5'],
      ['t5', 't2', 't4', 't3', 't1'],
    ],
    texts: ['I', 'visited', 'my', 'grandmother', 'yesterday'],
  },
}
export const clozeKey: Record<string, Record<string, string>> = {
  tomorrow: { w2: 'vamos', w4: 'hermano' },
  yesterday: { v1: 'went', v3: 'saw' },
}

const same = (given: string, expected: string) => given.trim().toLowerCase() === expected.toLowerCase()

function grade(exerciseId: string, answer: RenderedAnswer): Omit<AssessmentResult, 'solution'> & {
  solution: NonNullable<AssessmentResult['solution']>
} {
  const explanation = `Because of **${exerciseId}**.`
  const base = { status: 'assessed' as const, exercise_id: exerciseId }
  switch (answer.type) {
    case 'multiple_choice': {
      const correct = answerKey[exerciseId] === answer.option_id
      return {
        ...base,
        score: correct ? 1 : 0,
        correct,
        items: [],
        solution: { type: 'multiple_choice', option_id: answerKey[exerciseId], explanation },
      }
    }
    case 'short_answer': {
      const correct = same(answer.text, typedKey[exerciseId])
      return {
        ...base,
        score: correct ? 1 : 0,
        correct,
        items: [],
        solution: { type: 'short_answer', answer: typedKey[exerciseId], explanation },
      }
    }
    case 'cloze': {
      const key = clozeKey[exerciseId]
      const items = Object.keys(answer.gaps).map((id) => ({ id, correct: same(answer.gaps[id], key[id] ?? '') }))
      const right = items.filter((item) => item.correct).length
      return {
        ...base,
        score: right / items.length,
        correct: right === items.length,
        items,
        solution: {
          type: 'cloze',
          gaps: Object.keys(answer.gaps).map((id) => ({ id, answer: key[id] })),
          explanation,
        },
      }
    }
    case 'matching': {
      const key = matchingKey[exerciseId]
      const items = Object.keys(key).map((id) => ({ id, correct: answer.pairs[id] === key[id] }))
      const correct = items.every((item) => item.correct)
      return {
        ...base,
        score: items.filter((item) => item.correct).length / items.length,
        correct,
        items,
        solution: {
          type: 'matching',
          pairs: Object.entries(key).map(([left_id, right_id]) => ({ left_id, right_id })),
          explanation,
        },
      }
    }
    case 'token_ordering': {
      const key = orderKey[exerciseId]
      const closest = key.orders
        .map((order) => order.map((id, i) => answer.order[i] === id))
        .sort((a, b) => b.filter(Boolean).length - a.filter(Boolean).length)[0]
      const items = answer.order.map((id, i) => ({ id, correct: closest[i] ?? false }))
      const correct = items.every((item) => item.correct)
      return {
        ...base,
        score: items.filter((item) => item.correct).length / items.length,
        correct,
        items,
        solution: { type: 'token_ordering', tokens: key.texts, explanation },
      }
    }
  }
}

/** A stand-in for the backend: grades with the keys above and repeats exercises reversed. */
export function fakeApi(lesson: LessonPublic = sampleLesson) {
  const assess = vi.fn(
    async (exerciseId: string, answer: RenderedAnswer, options: { reveal: boolean }): Promise<AssessmentResult> => {
      const result = grade(exerciseId, answer)
      return { ...result, solution: result.correct || options.reveal ? result.solution : null }
    },
  )
  const secondRound = vi.fn(async (failed: string[], _seed: string) => ({
    exercises: lesson.blocks
      .filter((block): block is RenderedExercise => isRendered(block))
      .filter((exercise) => failed.includes(exercise.id))
      .map((exercise) =>
        exercise.type === 'multiple_choice'
          ? { ...exercise, options: [...exercise.options].reverse() }
          : exercise.type === 'short_answer'
            ? { ...exercise, show_hint: true }
            : exercise,
      ),
  }))
  return { assess, secondRound } satisfies LessonApi
}

/** The public shape of every exercise type the schema knows but phase 1 does not render. */
export const unrenderedExercises: ExercisePublic[] = [
  {
    type: 'span_highlight',
    id: 'highlight',
    prompt: 'Highlight every form of *estar*.',
    text: 'Hoy estoy en casa.',
    hint: null,
  },
  {
    type: 'table_fill',
    id: 'conjugation',
    prompt: 'Complete the present tense of *estar*.',
    columns: ['Persona', 'Forma'],
    rows: [[{ kind: 'given', text: 'yo' }, { kind: 'blank', id: 'yo' }]],
    hint: null,
  },
  { type: 'numeric', id: 'distance', prompt: 'How far is Sevilla?', unit: 'km', hint: null },
  {
    type: 'listening',
    id: 'dictation',
    prompt: 'Listen and write down the sentence.',
    audio: { attachment_id: 'dictado-01' },
    hint: null,
  },
  { type: 'custom', id: 'stress', prompt: 'Tap the stressed syllable.', html: '<p>can·ción</p>' },
  { type: 'custom', id: 'no-prompt', prompt: null, html: '<p>x</p>' },
]

export const allTypesLesson: LessonPublic = {
  ...sampleLesson,
  id: 'all-exercise-types',
  blocks: [locationExercise, ...unrenderedExercises],
}
