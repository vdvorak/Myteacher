import { createSignal, Show } from 'solid-js'
import { useI18n } from '../i18n/i18n'
import type { CourseBasics } from './api'
import { LanguageSelect } from './languages'

/** Name, subject and the two languages of a course, for creating or changing it. */
export function CourseBasicsForm(props: {
  initial?: CourseBasics
  submitLabel: string
  onSubmit: (basics: CourseBasics) => Promise<void>
}) {
  const { t } = useI18n()
  const [name, setName] = createSignal(props.initial?.name ?? '')
  const [subject, setSubject] = createSignal(props.initial?.subject ?? '')
  const [taught, setTaught] = createSignal<string | null>(props.initial?.taught_language ?? null)
  const [instruction, setInstruction] = createSignal<string | null>(props.initial?.instruction_language ?? null)
  const [busy, setBusy] = createSignal(false)

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    const language = instruction()
    if (language === null) return
    setBusy(true)
    try {
      await props.onSubmit({
        name: name().trim(),
        subject: subject().trim(),
        taught_language: taught(),
        instruction_language: language,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form class="settings-form" onSubmit={submit}>
      <label>
        {t('courses.name')}
        <input required maxLength={200} value={name()} onInput={(e) => setName(e.currentTarget.value)} />
      </label>
      <label>
        {t('courses.subject')}
        <input required maxLength={200} value={subject()} onInput={(e) => setSubject(e.currentTarget.value)} />
      </label>
      <LanguageSelect
        label={t('courses.taughtLanguage')}
        noneLabel={t('courses.noTaughtLanguage')}
        value={taught()}
        onChange={setTaught}
      />
      <LanguageSelect label={t('courses.instructionLanguage')} value={instruction()} onChange={setInstruction} />
      <Show when={props.initial === undefined}>
        <p class="settings-note">{t('courses.languagesNote')}</p>
      </Show>
      <div class="settings-actions">
        <button type="submit" disabled={busy()}>
          {props.submitLabel}
        </button>
      </div>
    </form>
  )
}
