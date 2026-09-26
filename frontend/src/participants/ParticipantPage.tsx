import { A, useLocation } from '@solidjs/router'
import { createEffect, createResource, createSignal, Match, Show, Switch, type JSX } from 'solid-js'
import { ApiProvider, useApi } from '../api/context'
import { OtherDevice, type AttemptsApi } from '../attempts/api'
import { WorkLinksProvider } from '../attempts/links'
import { MyWork } from '../attempts/MyWork'
import { WorkPage } from '../attempts/WorkPage'
import { useI18n } from '../i18n/i18n'
import { CopyLink } from '../shell/CopyLink'
import { personalUrl } from './api'
import { ParticipantFrame } from './JoinPage'
import { forget, remember } from './remembered'

/** How often a participant's home asks for work released meanwhile. */
const POLL_MS = 10_000

const tokenOf = (hash: string) => hash.replace(/^#/, '')

/** The attempts API that tells `onMoved` when a request is refused as the work moved to another device. */
function heedingMoves(api: AttemptsApi, onMoved: () => void): AttemptsApi {
  const heeding = (call: (...args: never[]) => Promise<unknown>) =>
    async (...args: never[]) => {
      try {
        return await call(...args)
      } catch (error) {
        if (error instanceof OtherDevice) onMoved()
        throw error
      }
    }
  return Object.fromEntries(Object.entries(api).map(([name, call]) => [name, heeding(call)])) as unknown as AttemptsApi
}

/** The work pages as a participant reaches them: every request carries their personal link, and
 * every link keeps it. Built afresh for another link opened in the same tab, so nobody sees the
 * work of whoever opened theirs before. Once the work moved to another device, it gives way to a
 * notice, so nothing typed here since overwrites the newer work there, until the participant
 * moves it back. */
function AsParticipant(props: { token: string; children: () => JSX.Element }) {
  const apis = useApi()
  return (
    <Show when={props.token} keyed>
      {(token) => {
        const { t } = useI18n()
        const [moved, setMoved] = createSignal(false)
        const [busy, setBusy] = createSignal(false)
        const [failed, setFailed] = createSignal(false)
        const attempts = heedingMoves(apis.participants.attempts(token), () => setMoved(true))

        async function continueHere() {
          setBusy(true)
          setFailed(false)
          try {
            // A link that stopped working meanwhile says so at the next request.
            await apis.participants.open(token)
            setMoved(false)
          } catch {
            setFailed(true)
          } finally {
            setBusy(false)
          }
        }

        return (
          <Show
            when={!moved()}
            fallback={
              <section class="auth-form" aria-labelledby="other-device-heading">
                {/* Taken from wherever they were typing: nothing typed here is saved any more. */}
                <h2 id="other-device-heading" tabindex="-1" ref={(heading) => queueMicrotask(() => heading.focus())}>
                  {t('participant.otherDevice')}
                </h2>
                <p>{t('participant.otherDeviceNote')}</p>
                <Show when={failed()}>
                  <p role="alert">{t('participant.loadFailed')}</p>
                </Show>
                <button type="button" disabled={busy()} onClick={() => void continueHere()}>
                  {t('participant.continueHere')}
                </button>
              </section>
            }
          >
            <ApiProvider apis={{ ...apis, attempts }}>
              <WorkLinksProvider
                links={{
                  home: `/participant#${token}`,
                  work: (releaseId) => `/participant/work/${releaseId}#${token}`,
                }}
              >
                {props.children()}
              </WorkLinksProvider>
            </ApiProvider>
          </Show>
        )
      }}
    </Show>
  )
}

/** Where a participant's personal link lands, on any device: their run's work, or its lobby until
 * the teacher releases some, and the link to keep. Landing here moves the work to this device. The
 * token is in the fragment. */
export function ParticipantPage() {
  const { t } = useI18n()
  const api = useApi().participants
  const location = useLocation()
  const token = () => tokenOf(location.hash)
  const [participant] = createResource(token, (value) => api.open(value))
  const found = () => (participant.error ? undefined : participant())

  createEffect(() => {
    const found = participant.error ? undefined : participant()
    // Remembered here too, so the join link brings them back on this device as well.
    if (found) remember(found.run_id, token())
    else if (found === null) forget(token())
  })

  return (
    <ParticipantFrame>
      <Switch>
        <Match when={participant.error}>
          <h1>{t('participant.heading')}</h1>
          <p role="alert">{t('participant.loadFailed')}</p>
        </Match>
        <Match when={!token() || found() === null}>
          <h1>{t('participant.heading')}</h1>
          <p role="alert">{t('participant.unknownLink')}</p>
        </Match>
        <Match when={found()}>
          {(found) => (
            <>
              <h1>{found().run}</h1>
              <p class="settings-note">{found().course.name}</p>
              <p>{t('participant.greeting', { name: found().name })}</p>
              <AsParticipant token={token()}>
                {() => <MyWork pollMs={POLL_MS} empty={<p role="status">{t('participant.wait')}</p>} />}
              </AsParticipant>
              <section class="auth-form" aria-labelledby="personal-link-heading">
                <h2 id="personal-link-heading">{t('participant.linkHeading')}</h2>
                <p>{t('participant.save')}</p>
                <CopyLink label={t('participant.link')} url={personalUrl(token())} />
              </section>
            </>
          )}
        </Match>
        <Match when={true}>
          <p>{t('participant.loading')}</p>
        </Match>
      </Switch>
    </ParticipantFrame>
  )
}

/** One piece of a participant's work, behind their personal link, with the way back home. */
export function ParticipantWorkPage() {
  const { t } = useI18n()
  const location = useLocation()
  const token = () => tokenOf(location.hash)
  return (
    <ParticipantFrame>
      <A href={`/participant#${token()}`}>{t('participant.back')}</A>
      <AsParticipant token={token()}>{() => <WorkPage participant />}</AsParticipant>
    </ParticipantFrame>
  )
}
