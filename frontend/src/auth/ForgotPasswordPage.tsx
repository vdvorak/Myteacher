import { A } from '@solidjs/router'
import { createSignal, Match, Switch } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import { LanguageSwitch } from '../i18n/LanguageSwitch'
import './auth.css'

/** Ask for a password reset link; the answer never reveals whether the email has an account. */
export function ForgotPasswordPage() {
  const { t } = useI18n()
  const auth = useApi().auth
  const [email, setEmail] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [outcome, setOutcome] = createSignal<'requested' | 'failed' | null>(null)

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    setBusy(true)
    setOutcome(null)
    try {
      await auth.requestReset(email())
      setOutcome('requested')
    } catch {
      setOutcome('failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main class="page auth-page">
      <header class="page-header">
        <span class="page-caption">{t('app.title')}</span>
        <LanguageSwitch />
      </header>
      <form class="auth-form" onSubmit={submit}>
        <h1>{t('reset.heading')}</h1>
        <p>{t('reset.intro')}</p>
        <label>
          {t('auth.email')}
          <input
            type="email"
            autocomplete="username"
            required
            value={email()}
            onInput={(event) => setEmail(event.currentTarget.value)}
          />
        </label>
        <Switch>
          <Match when={outcome() === 'requested'}>
            <p role="status">{t('reset.requested')}</p>
          </Match>
          <Match when={outcome() === 'failed'}>
            <p role="alert">{t('reset.requestFailed')}</p>
          </Match>
        </Switch>
        <button type="submit" disabled={busy()}>
          {t('reset.submit')}
        </button>
        <A href="/sign-in">{t('reset.toSignIn')}</A>
      </form>
    </main>
  )
}
