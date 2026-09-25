import { A } from '@solidjs/router'
import { For, Show } from 'solid-js'
import { useI18n } from '../i18n/i18n'
import type { CourseRun, ListedRelease } from './api'

/** The releases of a run with how far their students got; the settings are in each release. */
export function RunReleases(props: {
  run: CourseRun
  releases: ListedRelease[] | undefined
  failed: boolean
}) {
  const { t, locale } = useI18n()
  const date = (at: string) => new Date(at).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <section aria-labelledby="releases-heading">
      <h2 id="releases-heading">{t('releases.heading')}</h2>
      <Show when={props.failed}>
        <p role="alert">{t('releases.loadFailed')}</p>
      </Show>
      <Show when={props.releases}>
        {(list) => (
          <Show when={list().length > 0} fallback={<p>{t('releases.none')}</p>}>
            <div class="table-scroll">
              <table class="admin-table" aria-label={t('releases.heading')}>
                <thead>
                  <tr>
                    <th scope="col">{t('releases.material')}</th>
                    <th scope="col">{t('releases.topic')}</th>
                    <th scope="col">{t('runReleases.released')}</th>
                    <th scope="col">{t('releases.due')}</th>
                    <th scope="col">{t('runReleases.submitted')}</th>
                    <th scope="col">{t('runReleases.toAssess')}</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={[...list()].reverse()}>
                    {(released) => (
                      <tr>
                        <th scope="row">
                          <A href={`/runs/${props.run.id}/releases/${released.id}`}>{released.title}</A>
                          <Show when={released.retracted_at}>
                            {' '}
                            <span class="badge" data-tone="quiet">
                              {t('releases.retracted')}
                            </span>
                          </Show>
                        </th>
                        <td>{released.topic}</td>
                        <td>{date(released.released_at)}</td>
                        <td>{released.due_at ? date(released.due_at) : t('releases.noDue')}</td>
                        <td>{t('runReleases.ofTotal', { submitted: released.submitted, total: released.total })}</td>
                        <td>
                          <Show when={released.waiting > 0} fallback="–">
                            <span class="badge" data-tone="attention">
                              {released.waiting}
                            </span>
                          </Show>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        )}
      </Show>
    </section>
  )
}
