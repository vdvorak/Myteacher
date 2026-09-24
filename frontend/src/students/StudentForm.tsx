import { createSignal, createUniqueId, For } from 'solid-js'
import { useI18n } from '../i18n/i18n'
import { localeNames, locales, type Locale } from '../i18n/messages'
import type { StudentBasics } from './api'

/**
 * A student's basics, for creating a student and for editing one. It carries the rule that only
 * learning-related observations belong in student notes, so every teacher meets it where students
 * are written about.
 */
export function StudentForm(props: {
  initial?: StudentBasics
  submitLabel: string
  busy: boolean
  /** Resolves true when the basics were taken; a new-student form then empties itself. */
  onSubmit: (basics: StudentBasics) => Promise<boolean>
}) {
  const { t, locale } = useI18n()
  const noteId = createUniqueId()
  const [name, setName] = createSignal(props.initial?.name ?? '')
  const [email, setEmail] = createSignal(props.initial?.email ?? '')
  const [language, setLanguage] = createSignal<Locale>(props.initial?.language ?? locale())

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    const taken = await props.onSubmit({ name: name().trim(), email: email().trim(), language: language() })
    if (taken && props.initial === undefined) {
      setName('')
      setEmail('')
    }
  }

  return (
    <form class="settings-form" onSubmit={submit} aria-describedby={noteId}>
      <p id={noteId} class="settings-note">
        {t('students.notesRule')}
      </p>
      <label>
        {t('students.name')}
        <input required maxLength={200} value={name()} onInput={(e) => setName(e.currentTarget.value)} />
      </label>
      <label>
        {t('auth.email')}
        <input type="email" required value={email()} onInput={(e) => setEmail(e.currentTarget.value)} />
      </label>
      <label>
        {t('students.language')}
        <select value={language()} onChange={(e) => setLanguage(e.currentTarget.value as Locale)}>
          <For each={locales}>{(code) => <option value={code}>{localeNames[code]}</option>}</For>
        </select>
      </label>
      <div class="settings-actions">
        <button type="submit" disabled={props.busy}>
          {props.submitLabel}
        </button>
      </div>
    </form>
  )
}
