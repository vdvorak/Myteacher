import type { JSX } from 'solid-js'
import { I18nProvider } from '../i18n/i18n'
import type { Locale } from '../i18n/messages'
import type { LessonPublic, MultipleChoiceExercisePublic } from '../generated/lesson'

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
}

export const sampleLesson: LessonPublic = {
  id: 'es-ser-estar',
  title: 'Ser, or estar?',
  language: 'es',
  blocks: [
    { type: 'explanation', markdown: 'Spanish has two verbs for *to be*: **ser** and **estar**.' },
    locationExercise,
  ],
}
