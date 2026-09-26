import { createSignal, Show } from 'solid-js'
import { useI18n } from '../i18n/i18n'
import type { CourseBasics } from './api'
import { LanguageSelect } from './languages'
import './courses.css'

/** The basics as a form holds them: the language of explanations is unset until chosen. */
export type BasicsDraft = Omit<CourseBasics, 'instruction_language'> & { instruction_language: string | null }

export const emptyBasics: BasicsDraft = { name: '', subject: '', taught_language: null, instruction_language: null }

/** The basics to send, trimmed; none before the language of explanations is chosen. */
export function basicsOf(draft: BasicsDraft): CourseBasics | null {
  const language = draft.instruction_language
  if (language === null) return null
  return {
    name: draft.name.trim(),
    subject: draft.subject.trim(),
    taught_language: draft.taught_language,
    instruction_language: language,
  }
}

/** The fields of name, subject and the two languages of a course, for a form that holds them. */
export function CourseBasicsFields(props: { basics: BasicsDraft; onChange: (basics: BasicsDraft) => void }) {
  const { t } = useI18n()
  const change = (field: Partial<BasicsDraft>) => props.onChange({ ...props.basics, ...field })
  return (
    <>
      <label>
        {t('courses.name')}
        <input
          required
          maxLength={200}
          value={props.basics.name}
          onInput={(e) => change({ name: e.currentTarget.value })}
        />
      </label>
      <label>
        {t('courses.subject')}
        <input
          required
          maxLength={200}
          value={props.basics.subject}
          onInput={(e) => change({ subject: e.currentTarget.value })}
        />
      </label>
      <LanguageSelect
        label={t('courses.taughtLanguage')}
        noneLabel={t('courses.noTaughtLanguage')}
        value={props.basics.taught_language}
        onChange={(tag) => change({ taught_language: tag })}
      />
      <LanguageSelect
        label={t('courses.instructionLanguage')}
        value={props.basics.instruction_language}
        onChange={(tag) => change({ instruction_language: tag })}
      />
    </>
  )
}

/** Name, subject and the two languages of a course, for creating or changing it. */
export function CourseBasicsForm(props: {
  initial?: CourseBasics
  submitLabel: string
  onSubmit: (basics: CourseBasics) => Promise<void>
  /** Shown but not changeable, for a teacher who may only view the course. */
  readOnly?: boolean
}) {
  const { t } = useI18n()
  const [basics, setBasics] = createSignal<BasicsDraft>(props.initial ?? emptyBasics)
  const [busy, setBusy] = createSignal(false)

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    const chosen = basicsOf(basics())
    if (chosen === null) return
    setBusy(true)
    try {
      await props.onSubmit(chosen)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form class="settings-form" onSubmit={submit}>
      <fieldset class="read-only-group" disabled={props.readOnly}>
        <CourseBasicsFields basics={basics()} onChange={setBasics} />
      </fieldset>
      <Show when={props.initial === undefined}>
        <p class="settings-note">{t('courses.languagesNote')}</p>
      </Show>
      <Show when={!props.readOnly}>
        <div class="settings-actions">
          <button type="submit" disabled={busy()}>
            {props.submitLabel}
          </button>
        </div>
      </Show>
    </form>
  )
}
