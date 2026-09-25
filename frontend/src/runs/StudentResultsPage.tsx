import { A, useParams } from '@solidjs/router'
import { createResource, createSignal, For, Show } from 'solid-js'
import { useApi } from '../api/context'
import { progressOf, type AssessmentReview, type Attempt } from '../attempts/api'
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

/** Each assessed answer of an attempt's first pass: the score that counts, the assistant's
 * justification and feedback, and the teacher's own score with a reason. */
function AssessmentsTable(props: { attempt: Attempt; runId: number; releaseId: number; onChanged: () => void }) {
  const { t } = useI18n()
  const rows = () =>
    props.attempt.first.exercises.flatMap((exercise, index) => {
      const review = props.attempt.first.answers[exercise.id]?.tries.at(-1)?.assessment
      return review ? [{ number: index + 1, review }] : []
    })
  const percent = (score: number) => t('assessments.percent', { percent: Math.round(score * 100) })

  return (
    <Show when={rows().length > 0}>
      <div class="table-scroll">
        <table class="admin-table" aria-label={t('assessments.heading', { number: props.attempt.number })}>
          <thead>
            <tr>
              <th scope="col">{t('assessments.exercise')}</th>
              <th scope="col">{t('assessments.score')}</th>
              <th scope="col">{t('assessments.assessment')}</th>
              <th scope="col">{t('assessments.override')}</th>
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>
              {(row) => (
                <tr>
                  <th scope="row">{row.number}</th>
                  <td>{row.review.score === null ? '–' : percent(row.review.score)}</td>
                  <td>
                    <Show when={row.review.flagged && row.review.score === null}>
                      <p>{t('assessments.flagged')}</p>
                    </Show>
                    <Show when={!row.review.flagged && row.review.score === null}>
                      <p>{t('assessments.waiting')}</p>
                    </Show>
                    <Show when={row.review.justification}>{(text) => <p>{text()}</p>}</Show>
                    <Show when={row.review.feedback}>
                      {(text) => <p>{t('assessments.feedback', { feedback: text() })}</p>}
                    </Show>
                    <Show when={row.review.override_reason}>
                      {(text) => <p>{t('assessments.reason', { reason: text() })}</p>}
                    </Show>
                    <Show when={!row.review.published && (row.review.assistant_score !== null || row.review.override_score !== null)}>
                      <p class="settings-note">{t('assessments.unpublished')}</p>
                    </Show>
                  </td>
                  <td>
                    {/* Results are of submitted attempts; an attempt in progress is not scored yet. */}
                    <Show when={props.attempt.submitted_at} fallback={t('results.notSubmitted')}>
                      <OverrideForm
                        review={row.review}
                        runId={props.runId}
                        releaseId={props.releaseId}
                        onSaved={props.onChanged}
                      />
                    </Show>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </Show>
  )
}

function OverrideForm(props: {
  review: AssessmentReview
  runId: number
  releaseId: number
  onSaved: () => void
}) {
  const { t } = useI18n()
  const api = useApi().runs
  const [score, setScore] = createSignal(
    props.review.override_score === null ? '' : String(Math.round(props.review.override_score * 100)),
  )
  const [reason, setReason] = createSignal(props.review.override_reason ?? '')
  const [busy, setBusy] = createSignal(false)
  const [failed, setFailed] = createSignal(false)

  async function save(event: SubmitEvent) {
    event.preventDefault()
    if (reason().trim() === '') return
    setBusy(true)
    setFailed(false)
    try {
      await api.override(props.runId, props.releaseId, props.review.id, Number(score()) / 100, reason().trim())
      props.onSaved()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save}>
      <label>
        {t('assessments.scoreInput')}
        <input
          type="number"
          required
          min={0}
          max={100}
          step={1}
          value={score()}
          onInput={(e) => setScore(e.currentTarget.value)}
        />
      </label>
      <label>
        {t('assessments.reasonInput')}
        <input required maxLength={1000} value={reason()} onInput={(e) => setReason(e.currentTarget.value)} />
      </label>
      <button type="submit" disabled={busy()}>
        {t('assessments.save')}
      </button>
      <Show when={failed()}>
        <p role="alert">{t('assessments.saveFailed')}</p>
      </Show>
    </form>
  )
}

function StudentResults() {
  const { t, locale } = useI18n()
  const api = useApi().runs
  const params = useParams<{ runId: string; releaseId: string; studentId: string }>()
  const ids = () => [Number(params.runId), Number(params.releaseId), Number(params.studentId)] as const
  const [detail, { refetch }] = createResource(ids, ([runId, releaseId, studentId]) =>
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
                  <AssessmentsTable
                    attempt={attempt}
                    runId={ids()[0]}
                    releaseId={ids()[1]}
                    onChanged={() => void refetch()}
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
