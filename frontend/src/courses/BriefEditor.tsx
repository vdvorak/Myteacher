import { createSignal, For, Show } from 'solid-js'
import { useI18n } from '../i18n/i18n'
import type { MessageKey } from '../i18n/messages'
import { catalogTypes } from '../lesson/schema'
import { TypeConflict, type BriefText, type CatalogType, type CourseBrief } from './api'
import './courses.css'

const textFields: { key: BriefText; label: MessageKey; hint: MessageKey }[] = [
  { key: 'audience', label: 'brief.audience', hint: 'brief.audienceHint' },
  { key: 'level', label: 'brief.level', hint: 'brief.levelHint' },
  { key: 'goals', label: 'brief.goals', hint: 'brief.goalsHint' },
  { key: 'timeframe', label: 'brief.timeframe', hint: 'brief.timeframeHint' },
  { key: 'tone', label: 'brief.tone', hint: 'brief.toneHint' },
  { key: 'notes', label: 'brief.notes', hint: 'brief.notesHint' },
]

// A new catalog type fails to compile here until it has a name in both languages.
export const catalogTypeNames: Record<CatalogType, MessageKey> = {
  multiple_choice: 'exerciseType.multiple_choice',
  short_answer: 'exerciseType.short_answer',
  cloze: 'exerciseType.cloze',
  matching: 'exerciseType.matching',
  token_ordering: 'exerciseType.token_ordering',
  token_selection: 'exerciseType.token_selection',
  free_text: 'exerciseType.free_text',
  translation: 'exerciseType.translation',
}

type Save = (change: Partial<CourseBrief>) => Promise<CourseBrief>

/** The course brief, every field read and saved on its own so no edit waits for another. */
export function BriefEditor(props: {
  initial: CourseBrief
  save: Save
  onSaved: (brief: CourseBrief) => void
  /** Shown but not changeable, for a teacher who may only view the course. */
  readOnly?: boolean
}) {
  const { t } = useI18n()
  // What the controls show: the saved brief with the changes still on their way applied.
  const [brief, setBrief] = createSignal(props.initial)
  const [problem, setProblem] = createSignal<'failed' | 'conflict' | null>(null)
  let saved = props.initial
  let queue: Promise<unknown> = Promise.resolve()
  let pending = 0

  /** Saves run one after another, so a change never overtakes or undoes an earlier one. */
  function save(change: Partial<CourseBrief>): Promise<boolean> {
    setProblem(null)
    setBrief({ ...brief(), ...change })
    pending += 1
    const run = queue.then(async () => {
      try {
        saved = await props.save(change)
        props.onSaved(saved)
        return true
      } catch (error) {
        setProblem(error instanceof TypeConflict ? 'conflict' : 'failed')
        return false
      } finally {
        pending -= 1
        // Once nothing is on its way, show exactly what was saved: a refused change goes back.
        if (pending === 0) setBrief(saved)
      }
    })
    queue = run
    return run
  }

  const toggle = (list: 'preferred_exercise_types' | 'forbidden_exercise_types', type: CatalogType) => {
    const current = brief()[list]
    const next = current.includes(type) ? current.filter((t) => t !== type) : [...current, type]
    // Keep the catalog order, whatever order the types were ticked in.
    void save({ [list]: catalogTypes.filter((t) => next.includes(t)) })
  }

  const typeGroup = (
    list: 'preferred_exercise_types' | 'forbidden_exercise_types',
    other: 'preferred_exercise_types' | 'forbidden_exercise_types',
    legend: MessageKey,
  ) => (
    <fieldset class="brief-types">
      <legend>{t(legend)}</legend>
      <For each={catalogTypes}>
        {(type) => (
          <label class="settings-check">
            <input
              type="checkbox"
              checked={brief()[list].includes(type)}
              // A type is never both preferred and forbidden.
              disabled={brief()[other].includes(type)}
              onChange={() => toggle(list, type)}
            />
            {t(catalogTypeNames[type])}
          </label>
        )}
      </For>
    </fieldset>
  )

  return (
    <section class="settings-form brief" aria-labelledby="brief-heading">
      <h2 id="brief-heading">{t('brief.heading')}</h2>
      <p class="settings-note">{t('brief.intro')}</p>
      <fieldset class="read-only-group" disabled={props.readOnly}>
        <For each={textFields}>
          {(field) => (
            <TextField
              label={t(field.label)}
              hint={t(field.hint)}
              initial={props.initial[field.key]}
              readOnly={props.readOnly}
              save={(value) => save({ [field.key]: value })}
            />
          )}
        </For>
        {typeGroup('preferred_exercise_types', 'forbidden_exercise_types', 'brief.preferred')}
        {typeGroup('forbidden_exercise_types', 'preferred_exercise_types', 'brief.forbidden')}
        <h3>{t('brief.defaults')}</h3>
        <label>
          {t('brief.feedbackMode')}
          <select
            value={brief().feedback_mode}
            onChange={(e) => void save({ feedback_mode: e.currentTarget.value as CourseBrief['feedback_mode'] })}
          >
            <option value="immediate">{t('brief.feedbackImmediate')}</option>
            <option value="at_the_end">{t('brief.feedbackAtTheEnd')}</option>
          </select>
        </label>
        <label class="settings-check">
          <input
            type="checkbox"
            checked={brief().retry_with_hint}
            onChange={(e) => void save({ retry_with_hint: e.currentTarget.checked })}
          />
          {t('brief.retryWithHint')}
        </label>
        <label class="settings-check">
          <input
            type="checkbox"
            checked={brief().second_round}
            onChange={(e) => void save({ second_round: e.currentTarget.checked })}
          />
          {t('brief.secondRound')}
        </label>
      </fieldset>
      <Show when={problem()}>
        {(current) => <p role="alert">{t(current() === 'conflict' ? 'brief.typeConflict' : 'courses.saveFailed')}</p>}
      </Show>
    </section>
  )
}

/** One text field of the brief with its own draft and save button. */
function TextField(props: {
  label: string
  hint: string
  initial: string | null
  readOnly?: boolean
  save: (value: string | null) => Promise<boolean>
}) {
  const { t } = useI18n()
  const [draft, setDraft] = createSignal(props.initial ?? '')
  const [saved, setSaved] = createSignal(false)
  const [busy, setBusy] = createSignal(false)

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    setBusy(true)
    setSaved(false)
    const value = draft().trim()
    if (await props.save(value === '' ? null : value)) setSaved(true)
    setBusy(false)
  }

  return (
    <form class="brief-field" onSubmit={submit}>
      <label>
        {props.label}
        <textarea
          rows={2}
          maxLength={5000}
          placeholder={props.hint}
          value={draft()}
          onInput={(e) => {
            setDraft(e.currentTarget.value)
            setSaved(false)
          }}
        />
      </label>
      <Show when={!props.readOnly}>
        <div class="settings-actions">
          <button type="submit" disabled={busy()} aria-label={t('brief.saveField', { field: props.label })}>
            {t('brief.save')}
          </button>
          <Show when={saved()}>
            <span role="status">{t('brief.fieldSaved', { field: props.label })}</span>
          </Show>
        </div>
      </Show>
    </form>
  )
}
