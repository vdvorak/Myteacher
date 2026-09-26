import { A, useLocation } from '@solidjs/router'
import { createEffect, createResource, Match, Show, Switch, type JSX } from 'solid-js'
import { ApiProvider, useApi } from '../api/context'
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

/** The work pages as a participant reaches them: every request carries their personal link, and
 * every link keeps it. Built afresh for another link opened in the same tab, so nobody sees the
 * work of whoever opened theirs before. */
function AsParticipant(props: { token: string; children: () => JSX.Element }) {
  const apis = useApi()
  return (
    <Show when={props.token} keyed>
      {(token) => (
        <ApiProvider apis={{ ...apis, attempts: apis.participants.attempts(token) }}>
          <WorkLinksProvider
            links={{
              home: `/participant#${token}`,
              work: (releaseId) => `/participant/work/${releaseId}#${token}`,
            }}
          >
            {props.children()}
          </WorkLinksProvider>
        </ApiProvider>
      )}
    </Show>
  )
}

/** Where a participant's personal link lands, on any device: their run's work, or its lobby until
 * the teacher releases some, and the link to keep. The token is in the fragment. */
export function ParticipantPage() {
  const { t } = useI18n()
  const api = useApi().participants
  const location = useLocation()
  const token = () => tokenOf(location.hash)
  const [participant] = createResource(token, (value) => api.me(value))
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
