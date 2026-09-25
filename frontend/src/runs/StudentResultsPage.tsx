import { A, useLocation, useParams } from '@solidjs/router'
import { createEffect, createResource, For, Show } from 'solid-js'
import { useApi } from '../api/context'
import { progressOf, type Attempt } from '../attempts/api'
import { useI18n } from '../i18n/i18n'
import { ApiError } from '../lesson/api'
import { LessonPlayer, type LessonApi } from '../lesson/LessonPlayer'
import { PageHeader } from '../shell/PageHeader'
import { TeachersOnly } from '../students/StudentsPage'
import { AssessmentDetails, OverrideForm } from './Assessment'
import { RetractionForm } from './RetractionForm'
import { useRunTrail } from './trail'
import './runs.css'

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

/** The assessment of one exercise of an attempt's first pass, under the exercise itself, with the
 * teacher's own score once the attempt is submitted. */
function InlineAssessment(props: {
  attempt: Attempt
  exerciseId: string
  anchor: boolean
  runId: number
  releaseId: number
  onChanged: () => void
}) {
  const { t } = useI18n()
  const review = () => props.attempt.first.answers[props.exerciseId]?.tries.at(-1)?.assessment
  return (
    <Show
      when={review()}
      fallback={
        // A cell of an unanswered exercise still leads here.
        <Show when={props.anchor}>
          <span id={`exercise-${props.exerciseId}`} />
        </Show>
      }
    >
      {(found) => (
        <aside
          class="inline-assessment"
          id={props.anchor ? `exercise-${props.exerciseId}` : undefined}
          aria-label={t('assessments.assessment')}
        >
          <AssessmentDetails review={found()} />
          {/* Results are of submitted attempts; an attempt in progress is not scored yet. */}
          <Show when={props.attempt.submitted_at} fallback={<p class="settings-note">{t('results.notSubmitted')}</p>}>
            <OverrideForm review={found()} runId={props.runId} releaseId={props.releaseId} onSaved={props.onChanged} />
          </Show>
        </aside>
      )}
    </Show>
  )
}

function StudentResults() {
  const { t, locale } = useI18n()
  const api = useApi().runs
  const params = useParams<{ runId: string; releaseId: string; studentId: string }>()
  const location = useLocation()
  const ids = () => [Number(params.runId), Number(params.releaseId), Number(params.studentId)] as const
  const [detail, { refetch }] = createResource(ids, ([runId, releaseId, studentId]) =>
    api.studentResults(runId, releaseId, studentId),
  )
  // The release's students, for the previous and the next one.
  const [results] = createResource(
    () => [Number(params.runId), Number(params.releaseId)] as const,
    ([runId, releaseId]) => api.results(runId, releaseId),
  )
  useRunTrail(() => ({
    runId: Number(params.runId),
    releaseId: Number(params.releaseId),
    page: (!detail.error && detail()?.student.name) || '…',
  }))
  const date = (at: string) => new Date(at).toLocaleString(locale())
  const neighbours = () => {
    const students = results.error ? [] : (results()?.students ?? [])
    const at = students.findIndex((s) => s.id === Number(params.studentId))
    return at < 0 ? {} : { previous: students[at - 1], next: students[at + 1] }
  }
  const studentHref = (id: number) => `/runs/${params.runId}/releases/${params.releaseId}/students/${id}`

  // A cell of the results opens the answer it stands for: once per student and answer, not again
  // when the page is read afresh after a score is saved.
  let scrolledTo: string | undefined
  createEffect(() => {
    const target = `${params.studentId}${location.hash}`
    if (!detail() || !location.hash || scrolledTo === target) return
    scrolledTo = target
    document.getElementById(location.hash.slice(1))?.scrollIntoView?.()
  })

  return (
    <>
      <Show when={detail.error}>
        <p role="alert">
          {detail.error instanceof ApiError && detail.error.status === 404 ? t('results.notFound') : t('results.loadFailed')}
        </p>
      </Show>
      <Show when={!detail.error && detail()}>
        {(loaded) => (
          <>
            <PageHeader
              title={loaded().student.name}
              meta={!loaded().student.in_run ? t('results.notInRun') : undefined}
              more={
                loaded().attempts.some((attempt) => attempt.retracted_at === null) ? (
                  <RetractionForm
                    intro="retraction.attemptIntro"
                    question="retraction.confirmAttempt"
                    action="retraction.retractAttempt"
                    onRetract={async (reason) => {
                      await api.retractAttempt(ids()[0], ids()[1], ids()[2], reason)
                      // Not awaited: reading the page again failing does not make the retraction fail.
                      void refetch()
                    }}
                  />
                ) : undefined
              }
            />
            <nav class="student-pager" aria-label={t('studentResults.pager')}>
              <Show when={neighbours().previous}>
                {(student) => (
                  <A href={studentHref(student().id)} rel="prev">
                    ← {t('studentResults.previous', { name: student().name })}
                  </A>
                )}
              </Show>
              <Show when={neighbours().next}>
                {(student) => (
                  <A href={studentHref(student().id)} rel="next">
                    {t('studentResults.next', { name: student().name })} →
                  </A>
                )}
              </Show>
            </nav>
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
                  <Show when={attempt.retraction_reason}>
                    {(reason) => <p role="status">{t('retraction.retracted', { reason: reason() })}</p>}
                  </Show>
                  <LessonPlayer
                    lesson={attempt.lesson}
                    seed={attempt.seed}
                    initial={progressOf(attempt)}
                    api={nothingToAsk}
                    readOnly
                    aside={(round, exerciseId) =>
                      round === 'first' ? (
                        <InlineAssessment
                          attempt={attempt}
                          exerciseId={exerciseId}
                          anchor={attempt.counts}
                          runId={ids()[0]}
                          releaseId={ids()[1]}
                          onChanged={() => void refetch()}
                        />
                      ) : undefined
                    }
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
