import { A, useParams } from '@solidjs/router'
import { createResource, For, Show } from 'solid-js'
import { useApi } from '../api/context'
import { progressOf } from '../attempts/api'
import { useI18n } from '../i18n/i18n'
import { ApiError } from '../lesson/api'
import { LessonPlayer, type LessonApi } from '../lesson/LessonPlayer'
import { TeachersOnly } from '../students/StudentsPage'

// A read-only player asks nothing of its backend.
const nothingToAsk: LessonApi = {
  assess: () => Promise.reject(new Error('read only')),
  secondRound: () => Promise.reject(new Error('read only')),
}

/** One student's attempts at a release, the latest first, each answer with its assessment and
 * solution, as the run teacher sees them. */
export function StudentResultsPage() {
  return (
    <TeachersOnly>
      <StudentResults />
    </TeachersOnly>
  )
}

function StudentResults() {
  const { t, locale } = useI18n()
  const api = useApi().runs
  const params = useParams<{ runId: string; releaseId: string; studentId: string }>()
  const ids = () => [Number(params.runId), Number(params.releaseId), Number(params.studentId)] as const
  const [detail] = createResource(ids, ([runId, releaseId, studentId]) =>
    api.studentResults(runId, releaseId, studentId),
  )
  const date = (at: string) => new Date(at).toLocaleString(locale())

  return (
    <>
      <A href={`/runs/${params.runId}/releases/${params.releaseId}`}>{t('results.backToResults')}</A>
      <Show when={detail.error}>
        <p role="alert">
          {detail.error instanceof ApiError && detail.error.status === 404 ? t('results.notFound') : t('results.loadFailed')}
        </p>
      </Show>
      <Show when={!detail.error && detail()}>
        {(loaded) => (
          <>
            <h1>{loaded().student.name}</h1>
            <Show when={!loaded().student.in_run}>
              <p class="settings-note">{t('results.notInRun')}</p>
            </Show>
            <For each={loaded().attempts} fallback={<p>{t('results.noAttempts')}</p>}>
              {(attempt) => (
                <section aria-label={t('results.attempt', { number: attempt.number })}>
                  <h2>{t('results.attempt', { number: attempt.number })}</h2>
                  <p class="settings-note">
                    {t('results.startedAt', { date: date(attempt.started_at) })} ·{' '}
                    {attempt.submitted_at
                      ? t('results.submittedAt', { date: date(attempt.submitted_at) })
                      : t('results.notSubmitted')}
                    <Show when={attempt.late}> · {t('results.late')}</Show>
                  </p>
                  <Show when={attempt.counts}>
                    <p>{t('results.counts')}</p>
                  </Show>
                  <LessonPlayer
                    lesson={attempt.lesson}
                    seed={attempt.seed}
                    initial={progressOf(attempt)}
                    api={nothingToAsk}
                    readOnly
                  />
                </section>
              )}
            </For>
          </>
        )}
      </Show>
    </>
  )
}
