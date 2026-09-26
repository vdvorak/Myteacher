import { createSignal, createUniqueId, Show } from 'solid-js'
import { useI18n } from '../i18n/i18n'
import './copy-link.css'

/** A link to hand on: shown whole to select by hand, with a button copying it. */
export function CopyLink(props: { label: string; url: string }) {
  const { t } = useI18n()
  const id = createUniqueId()
  const [outcome, setOutcome] = createSignal<'copied' | 'failed' | null>(null)

  async function copy() {
    // Cleared first, so copying again is announced again.
    setOutcome(null)
    try {
      await navigator.clipboard.writeText(props.url)
      setOutcome('copied')
    } catch {
      // No clipboard, as over plain HTTP: the link can still be selected by hand.
      setOutcome('failed')
    }
  }

  return (
    <div class="copy-link">
      <label for={id}>{props.label}</label>
      <div class="copy-link-row">
        <input id={id} readOnly value={props.url} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" onClick={() => void copy()}>
          {t('copyLink.copy')}
        </button>
      </div>
      {/* Always there, so screen readers announce the text put into it. */}
      <p class="settings-note" aria-live="polite">
        <Show when={outcome()}>{(shown) => t(shown() === 'copied' ? 'copyLink.copied' : 'copyLink.failed')}</Show>
      </p>
    </div>
  )
}
