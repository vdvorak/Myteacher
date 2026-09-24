import { createUniqueId, Show } from 'solid-js'
import type { ExercisePublic, RenderedExercise } from './schema'
import { useI18n } from '../i18n/i18n'
import type { MessageKey } from '../i18n/messages'
import { Markdown } from './Markdown'
import './exercise.css'

/** Exercise types the schema knows but this phase does not render. */
export type UnrenderedExercise = Exclude<ExercisePublic, RenderedExercise>

// A new exercise type fails to compile here until it has a name in both languages.
const typeNames: Record<UnrenderedExercise['type'], MessageKey> = {
  span_highlight: 'exerciseType.span_highlight',
  table_fill: 'exerciseType.table_fill',
  numeric: 'exerciseType.numeric',
  listening: 'exerciseType.listening',
  custom: 'exerciseType.custom',
}

export function UnsupportedExercise(props: { exercise: UnrenderedExercise }) {
  const { t } = useI18n()
  const headingId = createUniqueId()
  return (
    <aside class="exercise exercise-unsupported" role="note" aria-labelledby={headingId}>
      <p id={headingId} class="exercise-unsupported-title">
        <strong>{t(typeNames[props.exercise.type])}</strong>: {t('exercise.unsupported')}
      </p>
      <Show when={props.exercise.prompt}>{(prompt) => <Markdown source={prompt()} />}</Show>
    </aside>
  )
}
