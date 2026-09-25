import { A } from '@solidjs/router'
import { createResource, For, Show } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'

/** What is released to the signed-in student, the latest first, with where they stand on each. */
export function MyWork() {
  const { t, locale } = useI18n()
  const api = useApi().attempts
  const [releases] = createResource(() => api.releases())

  return (
    <section aria-labelledby="work-heading">
      <h2 id="work-heading">{t('work.heading')}</h2>
      <Show when={releases.error}>
        <p role="alert">{t('work.loadFailed')}</p>
      </Show>
      <Show when={!releases.error && releases()}>
        {(list) => (
          <Show when={list().length > 0} fallback={<p>{t('home.studentPlaceholder')}</p>}>
            <ul aria-labelledby="work-heading">
              <For each={list()}>
                {(release) => (
                  <li>
                    <A href={`/work/${release.id}`}>{release.title}</A>{' '}
                    <span class="settings-note">{t('work.meta', { topic: release.topic, run: release.run })}</span>{' '}
                    <span>{t(`work.state.${release.state}`)}</span>
                    <Show when={release.late}>
                      {' '}
                      <span>{t('work.late')}</span>
                    </Show>
                    <Show when={release.state !== 'submitted' && release.due_at}>
                      {(due) => (
                        <>
                          {' '}
                          <span>{t('work.due', { date: new Date(due()).toLocaleString(locale()) })}</span>
                        </>
                      )}
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        )}
      </Show>
    </section>
  )
}
