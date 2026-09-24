import { createResource, createSignal, For, Match, Show, Switch } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import type { MessageKey } from '../i18n/messages'
import type { Job } from '../jobs/api'
import { JobFailureMessage, JobStatus } from '../jobs/JobStatus'
import { InterviewConflict, type Interview, type InterviewRefusal, type InterviewRound, type InterviewStarted } from './api'
import './courses.css'

const refusals: Record<Exclude<InterviewRefusal, 'no_provider_key'>, MessageKey> = {
  interview_active: 'interview.changedMeanwhile',
  no_open_round: 'interview.changedMeanwhile',
  no_active_interview: 'interview.changedMeanwhile',
  nothing_to_retry: 'interview.changedMeanwhile',
  interview_changed: 'interview.changedMeanwhile',
}

type Problem = { kind: 'refused'; reason: InterviewRefusal } | { kind: 'failed' } | null

/**
 * The teacher interview: the assistant asks rounds of numbered questions with recommended
 * answers until the brief has what generation needs. Each step runs as a job.
 */
export function InterviewPanel(props: { courseId: number; onBriefChanged: () => void }) {
  const { t } = useI18n()
  const api = useApi().courses
  const [interview, { mutate, refetch }] = createResource(() => props.courseId, (id) => api.interview(id))
  // The last job this panel saw end, which a stale read of the interview must not undo.
  const [ended, setEnded] = createSignal<Job | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [problem, setProblem] = createSignal<Problem>(null)

  const current = () => (interview.error ? undefined : interview())
  const job = () => {
    const latest = current()?.job ?? null
    const seen = ended()
    return seen && latest && seen.id === latest.id ? seen : latest
  }
  const working = () => {
    const state = job()?.state
    return current()?.state === 'active' && (state === 'queued' || state === 'running')
  }
  const failedJob = () => (current()?.state === 'active' && job()?.state === 'failed' ? job() : null)
  const openRound = () => {
    const last = current()?.rounds.at(-1)
    return current()?.state === 'active' && !working() && !failedJob() && last && last.answers === null ? last : null
  }

  async function step(action: () => Promise<InterviewStarted | Interview>) {
    setBusy(true)
    setProblem(null)
    try {
      const result = await action()
      mutate('interview' in result ? result.interview : result)
    } catch (error) {
      setProblem(error instanceof InterviewConflict ? { kind: 'refused', reason: error.reason } : { kind: 'failed' })
      if (error instanceof InterviewConflict && error.reason !== 'no_provider_key') void refetch()
    } finally {
      setBusy(false)
    }
  }

  async function jobEnded(finishedJob: Job) {
    setEnded(finishedJob)
    const fresh = await refetch()
    if (fresh?.state === 'finished') props.onBriefChanged()
  }

  const start = () => step(() => api.startInterview(props.courseId))

  return (
    <section class="settings-form interview" aria-labelledby="interview-heading">
      <h2 id="interview-heading">{t('interview.heading')}</h2>
      <Show when={interview.error}>
        <p role="alert">{t('interview.loadFailed')}</p>
      </Show>
      <Show when={!interview.loading || interview.latest !== undefined}>
        <Switch>
          <Match when={current()?.state === 'active' && current()}>
            {(active) => (
              <>
                <Show when={working() && job()} keyed>
                  {(running) => <JobStatus job={running} onFinished={jobEnded} />}
                </Show>
                <Show when={failedJob()}>
                  {(failed) => (
                    <>
                      <JobFailureMessage kind={failed().error_kind ?? 'other'} rawOutput={failed().raw_output} />
                      <div class="settings-actions">
                        <button type="button" disabled={busy()} onClick={() => step(() => api.retryInterview(props.courseId))}>
                          {t('interview.retry')}
                        </button>
                      </div>
                    </>
                  )}
                </Show>
                <Show when={openRound()} keyed>
                  {(round) => (
                    <RoundForm
                      round={round}
                      busy={busy()}
                      onSubmit={(answers) => step(() => api.answerInterview(props.courseId, answers))}
                    />
                  )}
                </Show>
                <Show when={active().rounds.length > 0 && !openRound()}>
                  <p class="settings-note">{t('interview.roundsSoFar', { count: active().rounds.length })}</p>
                </Show>
                <div class="settings-actions">
                  <button type="button" disabled={busy()} onClick={() => step(() => api.endInterview(props.courseId))}>
                    {t('interview.end')}
                  </button>
                </div>
              </>
            )}
          </Match>
          <Match when={true}>
            <Show when={current()?.state === 'finished' && current()}>
              {(done) => (
                <div class="interview-outcome">
                  <p role="status">{t('interview.finished')}</p>
                  <Show when={done().summary}>{(summary) => <p>{summary()}</p>}</Show>
                  <Show when={done().sources_offered === false}>
                    <p class="settings-note">{t('interview.noSources')}</p>
                  </Show>
                </div>
              )}
            </Show>
            <Show when={current()?.state === 'ended'}>
              <p role="status">{t('interview.ended')}</p>
            </Show>
            <Show when={!current()}>
              <p class="settings-note">{t('interview.intro')}</p>
            </Show>
            <div class="settings-actions">
              <button type="button" disabled={busy()} onClick={start}>
                {t(current() ? 'interview.startAgain' : 'interview.start')}
              </button>
            </div>
          </Match>
        </Switch>
      </Show>
      <Show when={problem()}>
        {(shown) => {
          const value = shown()
          if (value.kind === 'refused' && value.reason === 'no_provider_key') return <JobFailureMessage kind="no_key" />
          return (
            <p role="alert">{t(value.kind === 'refused' ? refusals[value.reason as keyof typeof refusals] : 'courses.saveFailed')}</p>
          )
        }}
      </Show>
    </section>
  )
}

/** One round: each question with its recommended answer and the teacher's own answer. */
function RoundForm(props: { round: InterviewRound; busy: boolean; onSubmit: (answers: string[]) => void }) {
  const { t } = useI18n()
  const [answers, setAnswers] = createSignal(props.round.questions.map(() => ''))
  const setAnswer = (index: number, value: string) =>
    setAnswers(answers().map((answer, i) => (i === index ? value : answer)))

  return (
    <form
      class="interview-round"
      onSubmit={(event) => {
        event.preventDefault()
        props.onSubmit(answers().map((answer) => answer.trim()))
      }}
    >
      <h3>{t('interview.round', { n: props.round.number })}</h3>
      <For each={props.round.questions}>
        {(question, index) => (
          <fieldset class="interview-question">
            <legend>
              {question.number}. {question.question}
            </legend>
            <p class="settings-note">
              {t('interview.recommended')} {question.recommended_answer}
            </p>
            <label>
              {t('interview.yourAnswer')}
              <textarea
                rows={2}
                maxLength={5000}
                value={answers()[index()]}
                onInput={(e) => setAnswer(index(), e.currentTarget.value)}
              />
            </label>
            <div class="settings-actions">
              <button type="button" onClick={() => setAnswer(index(), question.recommended_answer)}>
                {t('interview.useRecommendation')}
              </button>
            </div>
          </fieldset>
        )}
      </For>
      <p class="settings-note">{t('interview.emptyAnswers')}</p>
      <div class="settings-actions">
        <button type="submit" disabled={props.busy}>
          {t('interview.send')}
        </button>
      </div>
    </form>
  )
}
