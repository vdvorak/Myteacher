import { A } from '@solidjs/router'
import { createResource, For, Show } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import '../admin/admin.css'
import { useBreadcrumbs } from '../shell/breadcrumbs'
import { PageHeader } from '../shell/PageHeader'
import { TeachersOnly } from '../students/StudentsPage'

/** Every run the teacher teaches, across courses, with how far it got. */
export function RunsPage() {
  return (
    <TeachersOnly>
      <TaughtRuns />
    </TeachersOnly>
  )
}

function TaughtRuns() {
  const { t, locale } = useI18n()
  const api = useApi().runs
  const [runs] = createResource(() => api.taught())
  useBreadcrumbs(() => [{ label: t('nav.runs') }])
  const date = (at: string) => new Date(at).toLocaleDateString(locale())

  return (
    <section class="admin-section">
      <PageHeader title={t('nav.runs')} />
      <Show when={runs.error}>
        <p role="alert">{t('runsPage.loadFailed')}</p>
      </Show>
      <Show when={!runs.error && runs()}>
        {(list) => (
          <Show
            when={list().length > 0}
            fallback={
              <>
                <p>{t('runsPage.none')}</p>
                <p>
                  <A class="button-link" href="/courses">
                    {t('runsPage.toCourses')}
                  </A>
                </p>
              </>
            }
          >
            <div class="table-scroll">
              <table class="admin-table" aria-label={t('nav.runs')}>
                <thead>
                  <tr>
                    <th scope="col">{t('runsPage.run')}</th>
                    <th scope="col">{t('runsPage.course')}</th>
                    <th scope="col">{t('runsPage.students')}</th>
                    <th scope="col">{t('runsPage.latestRelease')}</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={list()}>
                    {(run) => (
                      <tr>
                        <td>
                          <A href={`/runs/${run.id}`}>{run.name}</A>
                        </td>
                        <td>
                          <A href={`/courses/${run.course.id}`}>{run.course.name}</A>
                        </td>
                        <td>{run.roster_size}</td>
                        <td>
                          <Show when={run.latest_release} fallback={<span class="settings-note">{t('runsPage.nothingReleased')}</span>}>
                            {(released) => (
                              <>
                                <A href={`/runs/${run.id}/releases/${released().id}`}>{released().title}</A>{' '}
                                <span class="settings-note">{date(released().released_at)}</span>
                              </>
                            )}
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
