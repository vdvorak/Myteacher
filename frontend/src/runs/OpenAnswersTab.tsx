import { A } from '@solidjs/router'
import { createEffect, createResource, createSignal, Show } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import type { MessageKey } from '../i18n/messages'
import { finished, type Job } from '../jobs/api'
import { JobStatus } from '../jobs/JobStatus'
import { AssessmentRefused, type OpenAnswer, type OpenAnswers } from './api'
import { AssessmentDetails, OverrideForm } from './Assessment'

/** The open answers of a release one at a time, the flagged first: the answer, the assistant's
 * assessment and the teacher's own score; then publishing what the students have not seen. */
export function OpenAnswersTab(props: { runId: number; releaseId: number; counts: OpenAnswers; onChanged: () => void }) {
  const { t } = useI18n()
  const api = useApi().runs
  const [answers, { refetch }] = createResource(
    () => [props.runId, props.releaseId] as const,
    ([runId, releaseId]) => api.openAnswers(runId, releaseId),
  )
  // The answer shown, by id: scoring it may move it in the order, and it stays shown.
  const [shownId, setShownId] = createSignal<number>()
  const list = () => (answers.error ? [] : (answers() ?? []))
  const shown = (): OpenAnswer | undefined => list().find((a) => a.id === shownId()) ?? list()[0]
  const position = () => list().findIndex((a) => a.id === shown()?.id)
  const move = (by: number) => setShownId(list()[position() + by]?.id)
  // The first answer shown is pinned by its id too, once the list is read.
  createEffect(() => {
    if (shownId() === undefined && list().length > 0) setShownId(list()[0].id)
  })

  const changed = () => {
    void refetch()
    props.onChanged()
  }

  return (
    <div class="home">
      <AssessAndPublish runId={props.runId} releaseId={props.releaseId} counts={props.counts} onChanged={changed} />
      <Show when={answers.error}>
        <p role="alert">{t('openAnswers.loadFailed')}</p>
      </Show>
      <Show when={answers.state === 'ready' && list().length === 0}>
        <p>{t('openAnswers.none')}</p>
      </Show>
      {/* Keyed by the id: a refreshed list keeps what is being typed into the shown answer. */}
      <Show when={shown()?.id} keyed>
        {(_id) => {
          const answer = shown()!
          return (
          <section class="home-card open-answer" aria-labelledby="open-answer-heading">
            <div class="step-heading">
              <h2 id="open-answer-heading">
                {t('openAnswers.position', { number: position() + 1, total: list().length })}
              </h2>
              <div class="settings-actions">
                <button type="button" disabled={position() === 0} onClick={() => move(-1)}>
                  {t('openAnswers.previous')}
                </button>
                <button
                  type="button"
                  disabled={position() >= list().length - 1}
                  onClick={() => move(1)}
                >
                  {t('openAnswers.next')}
                </button>
              </div>
            </div>
            <p>
              <A href={`/runs/${props.runId}/releases/${props.releaseId}/students/${answer.student.id}`}>
                {answer.student.name}
              </A>
              <Show when={shown()!.review.flagged && shown()!.review.score === null}>
                {' '}
                <span class="badge" data-tone="attention">
                  {t('openAnswers.flagged')}
                </span>
              </Show>
            </p>
            <Show when={answer.round === 'second'}>
              <p>
                <span class="badge" data-tone="quiet">
                  {t('openAnswers.secondRound')}
                </span>
              </p>
            </Show>
            <Show when={answer.prompt}>{(prompt) => <p class="settings-note">{prompt()}</p>}</Show>
            <blockquote class="open-answer-text" aria-label={t('openAnswers.answer')}>
              {'text' in answer.answer && answer.answer.text ? answer.answer.text : t('openAnswers.empty')}
            </blockquote>
            <AssessmentDetails review={shown()!.review} />
            <OverrideForm review={answer.review} runId={props.runId} releaseId={props.releaseId} onSaved={changed} />
            <section class="student-view" aria-label={t('openAnswers.studentSees', { name: answer.student.name })}>
              <h3>{t('openAnswers.studentSees', { name: answer.student.name })}</h3>
              <Show when={shown()!.student_view} fallback={<p class="settings-note">{t('openAnswers.nothingToSee')}</p>}>
                {(view) => (
                  <>
                    <p>
                      {view().score === null
                        ? '–'
                        : t('assessments.percent', { percent: Math.round(view().score! * 100) })}
                    </p>
                    <Show when={view().feedback}>{(text) => <p>{text()}</p>}</Show>
                    <Show when={view().reason}>{(text) => <p>{t('openAnswers.teacherSays', { reason: text() })}</p>}</Show>
                    <p class="settings-note">
                      {t(shown()!.review.published ? 'openAnswers.seen' : 'openAnswers.onPublishing')}
                    </p>
                  </>
                )}
              </Show>
            </section>
          </section>
          )
        }}
      </Show>
    </div>
  )
}

/** Assessing the open answers with the assistant and publishing the results to the students. */
function AssessAndPublish(props: { runId: number; releaseId: number; counts: OpenAnswers; onChanged: () => void }) {
  const { t } = useI18n()
  const api = useApi().runs
  const [job, setJob] = createSignal<Job>()
  const [problem, setProblem] = createSignal<MessageKey>()
  const [published, setPublished] = createSignal<number>()
  const [busy, setBusy] = createSignal(false)

  async function assess() {
    setProblem(undefined)
    setPublished(undefined)
    setBusy(true)
    try {
      setJob(await api.assessOpenAnswers(props.runId, props.releaseId))
    } catch (error) {
      setProblem(error instanceof AssessmentRefused ? `assessing.refused.${error.reason}` : 'assessing.failed')
    } finally {
      setBusy(false)
    }
  }

  function assessed(ended: Job) {
    if (ended.state === 'succeeded') setJob(undefined)
    props.onChanged()
  }

  async function publish() {
    setProblem(undefined)
    setBusy(true)
    try {
      setPublished(await api.publish(props.runId, props.releaseId))
      props.onChanged()
    } catch {
      setProblem('assessing.publishFailed')
    } finally {
      setBusy(false)
    }
  }

  const running = () => job() !== undefined && !finished(job()!)

  return (
    <section aria-labelledby="open-answers-heading">
      <h2 id="open-answers-heading">{t('assessing.heading')}</h2>
      <p>{t('assessing.counts', { ...props.counts })}</p>
      <div class="settings-actions">
        <button type="button" disabled={busy() || running() || props.counts.waiting === 0} onClick={assess}>
          {t('assessing.assess')}
        </button>
        <button type="button" disabled={busy() || props.counts.unpublished === 0} onClick={publish}>
          {t('assessing.publish')}
        </button>
      </div>
      <Show when={props.counts.unpublished > 0}>
        <p class="settings-note">{t('assessing.unpublished', { count: props.counts.unpublished })}</p>
      </Show>
      <Show when={job()}>
        {(current) => <JobStatus job={current()} working="assessing.working" onFinished={assessed} />}
      </Show>
      <Show when={problem()}>
        {(key) => (
          <p role="alert">
            {t(key())}
            <Show when={key() === 'assessing.refused.no_provider_key'}>
              {' '}
              <A href="/settings">{t('nav.settings')}</A>
            </Show>
          </p>
        )}
      </Show>
      <Show when={published() !== undefined}>
        <p role="status">{t('assessing.published', { count: published()! })}</p>
      </Show>
    </section>
  )
}
