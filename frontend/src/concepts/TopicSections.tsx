import { createSignal, For, Show } from 'solid-js'
import { useApi } from '../api/context'
import { additionFields, type Topic, type TopicAdditions } from '../courses/api'
import { InterviewPanel, type InterviewSteps, type InterviewTexts } from '../courses/InterviewPanel'
import { useI18n } from '../i18n/i18n'
import type { MessageKey } from '../i18n/messages'
import { ApiError } from '../lesson/api'

const topicTexts: InterviewTexts = {
  heading: 'topicInterview.heading',
  intro: 'topicInterview.intro',
  start: 'topicInterview.start',
  finished: 'topicInterview.finished',
  ended: 'topicInterview.ended',
}

const additionLabels: Record<keyof TopicAdditions, MessageKey> = {
  goals: 'topicAdditions.goals',
  prior_knowledge: 'topicAdditions.priorKnowledge',
  emphasis: 'topicAdditions.emphasis',
  notes: 'topicAdditions.notes',
}

/** The short interview about one topic; it ends in the topic's additions. */
export function TopicInterviewPanel(props: { courseId: number; topicId: number; onFinished: () => void }) {
  const api = useApi().courses
  const steps: InterviewSteps = {
    read: () => api.topicInterview(props.courseId, props.topicId),
    start: () => api.startTopicInterview(props.courseId, props.topicId),
    answer: (answers) => api.answerTopicInterview(props.courseId, props.topicId, answers),
    retry: () => api.retryTopicInterview(props.courseId, props.topicId),
    end: () => api.endTopicInterview(props.courseId, props.topicId),
  }
  return (
    <InterviewPanel
      source={`${props.courseId}-${props.topicId}`}
      steps={steps}
      texts={topicTexts}
      onFinished={props.onFinished}
    />
  )
}

/** What the topic adds to the course brief: edited by editors, read by viewers. */
export function AdditionsSection(props: {
  courseId: number
  topic: Topic
  canEdit: boolean
  onChanged: (topics: Topic[]) => void
}) {
  const { t } = useI18n()
  const api = useApi().courses
  // What the teacher typed; a field left untouched follows the topic.
  const [drafts, setDrafts] = createSignal<Partial<Record<keyof TopicAdditions, string>>>({})
  const [busy, setBusy] = createSignal(false)
  const [saved, setSaved] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  const valueOf = (field: keyof TopicAdditions) => drafts()[field] ?? props.topic.additions[field] ?? ''
  const shown = () => additionFields.filter((field) => props.topic.additions[field])

  async function save(event: SubmitEvent) {
    event.preventDefault()
    // Only what the teacher changed, so that a co-editor's or the interview's other additions stay.
    const change: Partial<TopicAdditions> = {}
    for (const field of additionFields) {
      const value = valueOf(field).trim() || null
      if (value !== props.topic.additions[field]) change[field] = value
    }
    setSaved(false)
    setFailed(false)
    if (Object.keys(change).length === 0) return setDrafts({})
    setBusy(true)
    try {
      props.onChanged(await api.changeTopic(props.courseId, props.topic.id, { additions: change }))
      setDrafts({})
      setSaved(true)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section class="settings-form" aria-labelledby="additions-heading">
      <h2 id="additions-heading">{t('topicAdditions.heading')}</h2>
      <Show
        when={props.canEdit}
        fallback={
          <Show when={shown().length > 0} fallback={<p class="settings-note">{t('topicAdditions.none')}</p>}>
            <dl class="topic-additions">
              <For each={shown()}>
                {(field) => (
                  <>
                    <dt>{t(additionLabels[field])}</dt>
                    <dd>{props.topic.additions[field]}</dd>
                  </>
                )}
              </For>
            </dl>
          </Show>
        }
      >
        <p class="settings-note">{t('topicAdditions.intro')}</p>
        <form class="concept-form" onSubmit={save}>
          <For each={additionFields}>
            {(field) => (
              <label>
                {t(additionLabels[field])}
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={valueOf(field)}
                  onInput={(e) => {
                    setSaved(false)
                    setDrafts({ ...drafts(), [field]: e.currentTarget.value })
                  }}
                />
              </label>
            )}
          </For>
          <div class="settings-actions">
            <button type="submit" disabled={busy()}>
              {t('topicAdditions.save')}
            </button>
          </div>
        </form>
        <Show when={saved()}>
          <p role="status">{t('topicAdditions.saved')}</p>
        </Show>
        <Show when={failed()}>
          <p role="alert">{t('courses.saveFailed')}</p>
        </Show>
      </Show>
    </section>
  )
}

/** The assistant's offer of a diagnostic lesson; only accepting it sets the topic's flag. */
export function DiagnosticOfferSection(props: {
  courseId: number
  topic: Topic
  canEdit: boolean
  onChanged: (topics: Topic[]) => void
  onStale: () => void
}) {
  const { t } = useI18n()
  const api = useApi().courses
  const [busy, setBusy] = createSignal(false)
  const [problem, setProblem] = createSignal<MessageKey | null>(null)

  async function answer(accept: boolean) {
    setBusy(true)
    setProblem(null)
    try {
      props.onChanged(await api.answerDiagnosticOffer(props.courseId, props.topic.id, accept))
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // Answered or withdrawn meanwhile.
        setProblem('diagnosticOffer.changedMeanwhile')
        props.onStale()
      } else {
        setProblem('courses.saveFailed')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Show when={props.topic.diagnostic_offer}>
      {(offer) => (
        <section class="settings-form" aria-labelledby="diagnostic-offer-heading">
          <h2 id="diagnostic-offer-heading">{t('diagnosticOffer.heading')}</h2>
          <p>{offer().reason}</p>
          <Show when={offer().answer === 'accepted'}>
            <p role="status">{t('diagnosticOffer.accepted')}</p>
          </Show>
          <Show when={offer().answer === 'declined'}>
            <p role="status">{t('diagnosticOffer.declined')}</p>
          </Show>
          <Show when={props.canEdit && offer().answer === null}>
            <div class="settings-actions">
              <button type="button" disabled={busy()} onClick={() => answer(true)}>
                {t('diagnosticOffer.accept')}
              </button>
              <button type="button" disabled={busy()} onClick={() => answer(false)}>
                {t('diagnosticOffer.decline')}
              </button>
            </div>
          </Show>
          <Show when={problem()}>{(key) => <p role="alert">{t(key())}</p>}</Show>
        </section>
      )}
    </Show>
  )
}
