import { createSignal, createUniqueId, Show } from 'solid-js'
import { useI18n } from '../i18n/i18n'
import type { Student } from './api'

/**
 * A minor's guardian consent (ADR 0007): what is recorded, and the form by which the signed-in
 * teacher attests it. Recording consent activates nobody; the teacher does that separately.
 */
export function ConsentSection(props: {
  student: Student
  busy: boolean
  /** Resolves true when the consent was recorded. */
  onRecord: (note: string | null) => Promise<boolean>
}) {
  const { t, locale } = useI18n()
  const headingId = createUniqueId()
  const [attested, setAttested] = createSignal(false)
  const [note, setNote] = createSignal('')
  const recordedAt = (at: string) =>
    new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at))

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    const text = note().trim()
    if (await props.onRecord(text === '' ? null : text)) {
      setAttested(false)
      setNote('')
    }
  }

  return (
    <section class="admin-section" aria-labelledby={headingId}>
      <h2 id={headingId}>{t('consent.heading')}</h2>
      <Show when={props.student.consent} fallback={<p>{t('consent.none')}</p>}>
        {(consent) => (
          <div class="settings-note">
            <p>
              {t('consent.recorded', {
                teacher: consent().attested_by_email,
                at: recordedAt(consent().recorded_at),
              })}
            </p>
            <Show when={consent().note}>{(text) => <p>{text()}</p>}</Show>
          </div>
        )}
      </Show>
      <form class="settings-form" onSubmit={submit}>
        <label class="settings-check">
          <input
            type="checkbox"
            required
            checked={attested()}
            onChange={(e) => setAttested(e.currentTarget.checked)}
          />
          {t('consent.attest')}
        </label>
        <label>
          {t('consent.note')}
          <textarea maxLength={1000} rows={3} value={note()} onInput={(e) => setNote(e.currentTarget.value)} />
        </label>
        <div class="settings-actions">
          <button type="submit" disabled={props.busy}>
            {t('consent.record')}
          </button>
        </div>
      </form>
    </section>
  )
}
