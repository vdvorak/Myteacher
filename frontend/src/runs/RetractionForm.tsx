import { createSignal, Show } from 'solid-js'
import { useI18n } from '../i18n/i18n'
import type { MessageKey } from '../i18n/messages'
import { useConfirm } from '../shell/confirm'

/** Asks for the reason the students are told, confirms, then retracts. */
export function RetractionForm(props: {
  intro: MessageKey
  /** The confirmation's question. */
  question: MessageKey
  action: MessageKey
  onRetract: (reason: string) => Promise<void>
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const [reason, setReason] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [failed, setFailed] = createSignal(false)

  async function retract(event: SubmitEvent) {
    event.preventDefault()
    // `required` lets a reason of spaces through.
    if (reason().trim() === '') return
    const told = reason().trim()
    if (!(await confirm({ title: t(props.question), body: t('retraction.told', { reason: told }), action: t(props.action) }))) {
      return
    }
    setBusy(true)
    setFailed(false)
    try {
      await props.onRetract(told)
      setReason('')
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={retract}>
      <p class="settings-note">{t(props.intro)}</p>
      <label>
        {t('retraction.reason')}
        <input required maxLength={1000} value={reason()} onInput={(e) => setReason(e.currentTarget.value)} />
      </label>
      <div class="settings-actions">
        <button type="submit" class="button-danger" disabled={busy()}>
          {t(props.action)}
        </button>
      </div>
      <Show when={failed()}>
        <p role="alert">{t('retraction.failed')}</p>
      </Show>
    </form>
  )
}
