import { createUniqueId, Index } from 'solid-js'
import type { PaperOnlyBlock } from '../generated/lesson'
import { useI18n } from '../i18n/i18n'
import { Markdown } from './Markdown'
import './exercise.css'

/** A paper-only exercise, which no exercise type represents: its instruction, answered on the printed
 * sheet in the lines left for it and never in the app. */
export function PaperOnlyExercise(props: { block: PaperOnlyBlock }) {
  const { t } = useI18n()
  const headingId = createUniqueId()
  return (
    <aside class="exercise paper-only" role="note" aria-labelledby={headingId}>
      <p id={headingId} class="paper-only-title">
        <strong>{t('paperOnly.title')}</strong>
      </p>
      <Markdown source={props.block.prompt} />
      <p class="paper-only-note">{t('paperOnly.note')}</p>
      <div class="paper-only-lines" aria-hidden="true">
        <Index each={Array.from({ length: props.block.answer_lines ?? 3 })}>
          {() => <div class="paper-only-line" />}
        </Index>
      </div>
    </aside>
  )
}
