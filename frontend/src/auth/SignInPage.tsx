import { Navigate } from '@solidjs/router'
import { createSignal, Match, Switch } from 'solid-js'
import { useI18n } from '../i18n/i18n'
import { LanguageSwitch } from '../i18n/LanguageSwitch'
import { useSession } from './session'
import './auth.css'

type Problem = 'invalid' | 'inactive' | 'failed' | null

export function SignInPage() {
  const { t } = useI18n()
  const session = useSession()
  const [email, setEmail] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [problem, setProblem] = createSignal<Problem>(null)

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      const result = await session.signIn(email(), password())
      if (typeof result === 'string') setProblem(result)
    } catch {
      setProblem('failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Switch>
      <Match when={session.account()}>
        <Navigate href="/" />
      </Match>
      <Match when={session.account() === null || session.loadFailed()}>
        <main class="page auth-page">
          <header class="page-header">
            <span class="page-caption">{t('app.title')}</span>
            <LanguageSwitch />
          </header>
          <form class="auth-form" onSubmit={submit}>
            <h1>{t('auth.signIn')}</h1>
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
            <label>
              {t('auth.password')}
              <input
                type="password"
                autocomplete="current-password"
                required
                value={password()}
                onInput={(event) => setPassword(event.currentTarget.value)}
              />
            </label>
            <Switch>
              <Match when={problem() === 'invalid'}>
                <p role="alert">{t('auth.invalidCredentials')}</p>
              </Match>
              <Match when={problem() === 'inactive'}>
                <p role="alert">{t('auth.inactive')}</p>
              </Match>
              <Match when={problem() === 'failed'}>
                <p role="alert">{t('auth.signInFailed')}</p>
              </Match>
            </Switch>
            <button type="submit" disabled={busy()}>
              {t('auth.submit')}
            </button>
          </form>
        </main>
      </Match>
    </Switch>
  )
}
