import { useLocation } from '@solidjs/router'
import { createEffect, createResource, Match, Switch } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import { CopyLink } from '../shell/CopyLink'
import { personalUrl } from './api'
import { ParticipantFrame } from './JoinPage'
import { forget, remember } from './remembered'

/** Where a participant's personal link lands, on any device: their run's lobby for now, and the
 * link to keep. The token is in the fragment. */
export function ParticipantPage() {
  const { t } = useI18n()
  const api = useApi().participants
  const location = useLocation()
  const token = () => location.hash.replace(/^#/, '')
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
              <p role="status">{t('participant.wait')}</p>
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
