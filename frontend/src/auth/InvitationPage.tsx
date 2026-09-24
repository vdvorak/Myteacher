import { A, useLocation, useNavigate } from '@solidjs/router'
import { createResource, createSignal, Match, Show, Switch } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import { LanguageSwitch } from '../i18n/LanguageSwitch'
import type { MessageKey } from '../i18n/messages'
import type { AcceptResult } from './api'
import { useSession } from './session'
import './auth.css'

/** Kept in step with the backend's minimum. */
const MIN_PASSWORD_LENGTH = 12

type Problem = Exclude<AcceptResult, object> | 'tooShort' | 'mismatch' | 'failed'

const problemMessages: Record<Problem, MessageKey> = {
  used: 'invitation.used',
  revoked: 'invitation.revoked',
  expired: 'invitation.expired',
  unknown: 'invitation.unknown',
  inactive: 'auth.inactive',
  tooShort: 'invitation.tooShort',
  mismatch: 'invitation.mismatch',
  failed: 'invitation.failed',
}

/** Where an invitation link lands: set the first password and sign in. Shared by all accounts. */
export function InvitationPage() {
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const session = useSession()
  const auth = useApi().auth
  // The token is in the fragment, which the browser never sends to the server.
  const token = () => location.hash.replace(/^#/, '')
  const [invitation] = createResource(
    token,
    (value) => auth.checkInvitation(value),
  )
  const [password, setPassword] = createSignal('')
  const [repeated, setRepeated] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [problem, setProblem] = createSignal<Problem | null>(null)

  const linkProblem = (): Problem | null => {
    if (!token()) return 'unknown'
    const state = invitation()?.state
    return state && state !== 'valid' ? state : null
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    if (password().length < MIN_PASSWORD_LENGTH) return setProblem('tooShort')
    if (password() !== repeated()) return setProblem('mismatch')
    setBusy(true)
    setProblem(null)
    try {
      const result = await session.acceptInvitation(token(), password())
      if (typeof result === 'string') setProblem(result)
      else navigate('/', { replace: true })
    } catch {
      setProblem('failed')
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
      <div class="auth-form">
        <h1>{t('invitation.heading')}</h1>
        <Switch>
          <Match when={linkProblem()}>
            {(state) => (
              <>
                <p role="alert">{t(problemMessages[state()])}</p>
                <A href="/sign-in">{t('invitation.toSignIn')}</A>
              </>
            )}
          </Match>
          <Match when={invitation.error}>
            <p role="alert">{t('invitation.checkFailed')}</p>
          </Match>
          <Match when={invitation.loading}>
            <p>{t('invitation.checking')}</p>
          </Match>
          <Match when={invitation()?.email}>
            {(email) => (
              <form class="auth-form" onSubmit={submit}>
                <p>
                  {t('invitation.intro')} <strong>{email()}</strong>
                </p>
                <input type="email" hidden autocomplete="username" value={email()} readOnly />
                <label>
                  {t('invitation.password')}
                  <input
                    type="password"
                    autocomplete="new-password"
                    required
                    value={password()}
                    onInput={(e) => setPassword(e.currentTarget.value)}
                  />
                </label>
                <label>
                  {t('invitation.repeat')}
                  <input
                    type="password"
                    autocomplete="new-password"
                    required
                    value={repeated()}
                    onInput={(e) => setRepeated(e.currentTarget.value)}
                  />
                </label>
                <Show when={problem()}>
                  {(current) => (
                    <p role="alert">{t(problemMessages[current()], { min: MIN_PASSWORD_LENGTH })}</p>
                  )}
                </Show>
                <button type="submit" disabled={busy()}>
                  {t('invitation.submit')}
                </button>
              </form>
            )}
          </Match>
        </Switch>
      </div>
    </main>
  )
}
