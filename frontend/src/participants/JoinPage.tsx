import { useLocation, useNavigate } from '@solidjs/router'
import { createResource, createSignal, Match, Show, Switch, type JSX } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import { LanguageSwitch } from '../i18n/LanguageSwitch'
import '../auth/auth.css'
import { forget, remember, rememberedFor } from './remembered'

/** A page of someone without an account: the app's name and the language switch above it. */
export function ParticipantFrame(props: { children: JSX.Element }) {
  const { t } = useI18n()
  return (
    <main class="page auth-page">
      <header class="page-header">
        <span class="page-caption">{t('app.title')}</span>
        <LanguageSwitch />
      </header>
      <div class="auth-form">{props.children}</div>
    </main>
  )
}

/** Where a link run's join link lands: type a name and join its lobby. Someone who joined on this
 * browser before may continue instead, and the next person on a shared device may still join as
 * themselves. The token is in the fragment. */
export function JoinPage() {
  const { t } = useI18n()
  const api = useApi().participants
  const location = useLocation()
  const navigate = useNavigate()
  const token = () => location.hash.replace(/^#/, '')
  const [run] = createResource(token, (value) => api.check(value))
  const found = () => (run.error ? undefined : run())
  // The participant this browser joined the run as before, if their link still works.
  const [before] = createResource(
    () => found()?.run_id,
    async (runId) => {
      const personal = rememberedFor(runId)
      const participant = personal ? await api.me(personal).catch(() => null) : null
      if (personal && participant === null) forget(personal)
      return participant && personal ? { participant, personal } : null
    },
  )
  const [someoneElse, setSomeoneElse] = createSignal(false)
  const [name, setName] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [problem, setProblem] = createSignal<'run_full' | 'unknown_link' | 'failed' | null>(null)

  async function join(event: SubmitEvent) {
    event.preventDefault()
    const runId = found()?.run_id
    // `required` lets a name of spaces through.
    if (runId === undefined || name().trim() === '') return
    setBusy(true)
    setProblem(null)
    try {
      const joined = await api.join(token(), name().trim())
      if (typeof joined === 'string') return setProblem(joined)
      remember(runId, joined.token)
      navigate(`/participant#${joined.token}`, { replace: true })
    } catch {
      setProblem('failed')
    } finally {
      setBusy(false)
    }
  }

  const joinForm = () => (
    <Show when={!found()!.full && problem() !== 'run_full'} fallback={<p role="alert">{t('join.full')}</p>}>
      <form class="auth-form" onSubmit={join}>
        <label>
          {t('join.name')}
          <input
            required
            maxLength={60}
            autocomplete="name"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </label>
        <Show when={problem() === 'failed'}>
          <p role="alert">{t('join.failed')}</p>
        </Show>
        <button type="submit" disabled={busy()}>
          {t('join.submit')}
        </button>
      </form>
    </Show>
  )

  return (
    <ParticipantFrame>
      <Switch>
        <Match when={run.error}>
          <h1>{t('join.heading')}</h1>
          <p role="alert">{t('join.checkFailed')}</p>
        </Match>
        <Match when={!token() || run() === null || problem() === 'unknown_link'}>
          <h1>{t('join.heading')}</h1>
          <p role="alert">{t('participant.unknownLink')}</p>
        </Match>
        <Match when={found() && !before.loading}>
          <h1>{found()!.run}</h1>
          <p class="settings-note">{found()!.course}</p>
          <Show when={!someoneElse() && before()} fallback={joinForm()}>
            {(earlier) => (
              <>
                <p>{t('join.joinedBefore', { name: earlier().participant.name })}</p>
                <button type="button" onClick={() => navigate(`/participant#${earlier().personal}`)}>
                  {t('join.continueAs', { name: earlier().participant.name })}
                </button>
                <button type="button" class="button-secondary" onClick={() => setSomeoneElse(true)}>
                  {t('join.someoneElse')}
                </button>
              </>
            )}
          </Show>
        </Match>
        <Match when={true}>
          <p>{t('join.checking')}</p>
        </Match>
      </Switch>
    </ParticipantFrame>
  )
}
