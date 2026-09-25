import { createSignal, Show } from 'solid-js'
import { useApi } from '../api/context'
import type { AssessmentReview } from '../attempts/api'
import { useI18n } from '../i18n/i18n'

/** An assessment as the run teacher sees it: the score that counts, the assistant's justification
 * and feedback, the teacher's reason, and whether the student has seen it. */
export function AssessmentDetails(props: { review: AssessmentReview }) {
  const { t } = useI18n()
  const percent = (score: number) => t('assessments.percent', { percent: Math.round(score * 100) })
  return (
    <div class="assessment">
      <p>
        <strong>{t('assessments.score')}:</strong> {props.review.score === null ? '–' : percent(props.review.score)}
      </p>
      <Show when={props.review.flagged && props.review.score === null}>
        <p>{t('assessments.flagged')}</p>
      </Show>
      <Show when={!props.review.flagged && props.review.score === null}>
        <p>{t('assessments.waiting')}</p>
      </Show>
      <Show when={props.review.justification}>{(text) => <p>{text()}</p>}</Show>
      <Show when={props.review.feedback}>{(text) => <p>{t('assessments.feedback', { feedback: text() })}</p>}</Show>
      <Show when={props.review.override_reason}>
        {(text) => <p>{t('assessments.reason', { reason: text() })}</p>}
      </Show>
      <Show when={!props.review.published && (props.review.assistant_score !== null || props.review.override_score !== null)}>
        <p class="settings-note">{t('assessments.unpublished')}</p>
      </Show>
    </div>
  )
}

/** The teacher's own score for an assessment, with the reason the student is told. */
export function OverrideForm(props: { review: AssessmentReview; runId: number; releaseId: number; onSaved: () => void }) {
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
    <form class="override-form" onSubmit={save}>
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
