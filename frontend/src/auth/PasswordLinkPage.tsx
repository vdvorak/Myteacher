import { A, useLocation, useNavigate } from '@solidjs/router'
import { createResource, createSignal, Match, Show, Switch } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import { LanguageSwitch } from '../i18n/LanguageSwitch'
import type { MessageKey } from '../i18n/messages'
import type { AcceptResult, InvitationCheck, InvitationState } from './api'
import { useSession } from './session'
import './auth.css'

/** Kept in step with the backend's minimum. */
const MIN_PASSWORD_LENGTH = 12

type LinkProblem = Exclude<InvitationState, 'valid'>
type Problem = Exclude<AcceptResult, object> | 'tooShort' | 'mismatch' | 'failed'

const formMessages: Record<Exclude<Problem, LinkProblem>, MessageKey> = {
  inactive: 'auth.inactive',
  tooShort: 'invitation.tooShort',
  mismatch: 'invitation.mismatch',
  failed: 'invitation.failed',
}

export interface PasswordLink {
  heading: MessageKey
  check(token: string): Promise<InvitationCheck>
  submit(token: string, password: string): Promise<AcceptResult>
  /** What to say for a link that no longer works. */
  linkMessages: Record<LinkProblem, MessageKey>
  /** Where to go from a link that no longer works. */
  recovery: { href: string; label: MessageKey }
}

/**
 * Where an emailed password link lands, an invitation or a reset: set a password and sign in.
 * The token is in the fragment, which the browser never sends to the server.
 */
export function PasswordLinkPage(props: PasswordLink) {
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const token = () => location.hash.replace(/^#/, '')
  const [invitation] = createResource(token, (value) => props.check(value))
  const message = (problem: Problem) =>
    problem in formMessages
      ? formMessages[problem as keyof typeof formMessages]
      : props.linkMessages[problem as LinkProblem]
  const [password, setPassword] = createSignal('')
  const [repeated, setRepeated] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [problem, setProblem] = createSignal<Problem | null>(null)

  const linkProblem = (): LinkProblem | null => {
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
      const result = await props.submit(token(), password())
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
        <h1>{t(props.heading)}</h1>
        <Switch>
          <Match when={linkProblem()}>
            {(state) => (
              <>
                <p role="alert">{t(message(state()))}</p>
                <A href={props.recovery.href}>{t(props.recovery.label)}</A>
              </>
            )}
          </Match>
          <Match when={invitation.error}>
            <p role="alert">{t('invitation.checkFailed')}</p>
          </Match>
          <Match when={invitation.loading}>
            <p>{t('invitation.checking')}</p>
          </Match>
          <Match when={invitation()?.state === 'valid'}>
              <form class="auth-form" onSubmit={submit}>
                {/* Invitations name the account; reset links do not, as the requester knows it. */}
                <Show when={invitation()?.email}>
                  {(address) => (
                    <>
                      <p>
                        {t('invitation.intro')} <strong>{address()}</strong>
                      </p>
                      <input type="email" hidden autocomplete="username" value={address()} readOnly />
                    </>
                  )}
                </Show>
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
                    <p role="alert">{t(message(current()), { min: MIN_PASSWORD_LENGTH })}</p>
                  )}
                </Show>
                <button type="submit" disabled={busy()}>
                  {t('invitation.submit')}
                </button>
              </form>
          </Match>
        </Switch>
      </div>
    </main>
  )
}

export function InvitationPage() {
  const session = useSession()
  const auth = useApi().auth
  return (
    <PasswordLinkPage
      heading="invitation.heading"
      check={(token) => auth.checkInvitation(token)}
      submit={(token, password) => session.acceptInvitation(token, password)}
      linkMessages={{
        used: 'invitation.used',
        revoked: 'invitation.revoked',
        expired: 'invitation.expired',
        unknown: 'invitation.unknown',
      }}
      recovery={{ href: '/sign-in', label: 'invitation.toSignIn' }}
    />
  )
}

export function ResetPasswordPage() {
  const session = useSession()
  const auth = useApi().auth
  return (
    <PasswordLinkPage
      heading="reset.heading"
      check={(token) => auth.checkReset(token)}
      submit={(token, password) => session.completeReset(token, password)}
      linkMessages={{
        used: 'reset.used',
        revoked: 'reset.revoked',
        expired: 'reset.expired',
        unknown: 'reset.unknown',
      }}
      recovery={{ href: '/forgot-password', label: 'reset.askAgain' }}
    />
  )
}
