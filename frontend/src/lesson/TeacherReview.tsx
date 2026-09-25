import { Show } from 'solid-js'
import { useI18n } from '../i18n/i18n'
import type { Review } from './progress'

/** What the teacher published of an answer's assessment: the score, feedback and any reason. */
export function TeacherReview(props: { review: Review }) {
  const { t } = useI18n()
  return (
    <section class="lesson-review" aria-label={t('review.heading')}>
      <p>
        <strong>{t('review.heading')}</strong>
        <Show when={props.review.score !== null}>
          {': '}
          {t('review.score', { percent: Math.round(props.review.score! * 100) })}
        </Show>
      </p>
      <Show when={props.review.feedback}>{(feedback) => <p>{feedback()}</p>}</Show>
      <Show when={props.review.reason}>{(reason) => <p>{t('review.reason', { reason: reason() })}</p>}</Show>
    </section>
  )
}
