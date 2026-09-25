import { useParams } from '@solidjs/router'
import { createEffect, createResource, createSignal, on, Show } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import { ApiError } from '../lesson/api'
import { LessonPlayer } from '../lesson/LessonPlayer'
import { roundComplete } from '../lesson/progress'
import { attemptLessonApi, AttemptRefused, progressOf, type Attempt, type AttemptRefusal } from './api'

/** One released material: opening it starts an attempt, or resumes it wherever it was left, on
 * any device; after submission it shows the results, and another attempt where the release allows. */
export function WorkPage() {
  const { t, locale } = useI18n()
  const api = useApi().attempts
  const params = useParams<{ releaseId: string }>()
  const [detail, { refetch }] = createResource(() => Number(params.releaseId), (id) => api.release(id))
  const [attempt, setAttempt] = createSignal<Attempt>()
  const [refused, setRefused] = createSignal<AttemptRefusal | 'failed'>()
  const [passDone, setPassDone] = createSignal(false)
  const [starting, setStarting] = createSignal(false)

  async function begin(releaseId: number) {
    setStarting(true)
    setRefused(undefined)
    try {
      setPassDone(false)
      setAttempt(await api.start(releaseId))
    } catch (error) {
      setRefused(error instanceof AttemptRefused ? error.reason : 'failed')
    } finally {
      setStarting(false)
    }
  }

  createEffect(
    on(
      () => !detail.error && detail(),
      (loaded) => {
        if (!loaded) return
        // Read afresh, as after a retraction: what the page knew of the attempt before is gone.
        setPassDone(false)
        setRefused(undefined)
        setAttempt(loaded.attempt ?? undefined)
        if (loaded.attempt || loaded.retraction?.whole_release) return
        if (loaded.can_start) void begin(loaded.id)
        // Nothing started yet and nothing may be: only the due date can stand in the way.
        else setRefused('past_due')
      },
    ),
  )

  return (
    <Show
      when={!detail.error && detail()}
      fallback={
        <Show when={detail.error} fallback={<p>{t('work.loading')}</p>}>
          <p role="alert">
            {detail.error instanceof ApiError && detail.error.status === 404 ? t('work.notFound') : t('work.loadFailed')}
          </p>
        </Show>
      }
    >
      {(release) => (
        <>
          <p class="settings-note">
            {t('work.meta', { topic: release().topic, run: release().run })}
            <Show when={release().due_at}>
              {(due) => <> · {t('work.due', { date: new Date(due()).toLocaleString(locale()) })}</>}
            </Show>
          </p>
          <Show when={release().retraction}>
            {(notice) => (
              <p role="alert">
                {notice().whole_release
                  ? t('work.retracted.release', { reason: notice().reason })
                  : t('work.retracted.attempt', { reason: notice().reason })}
              </p>
            )}
          </Show>
          <Show when={attempt()} keyed>
            {(current) => {
              // One backend per attempt: it queues the drafts, so it must outlive every save.
              // The teacher retracted the attempt meanwhile: the release says why, and what next.
              const lessonApi = attemptLessonApi(api, current.id, () => void refetch())
              return (
                <>
                  <Show when={current.number > 1}>
                    <p class="settings-note">{t('work.attempt', { number: current.number })}</p>
                  </Show>
                  <Show when={current.late}>
                    <p class="settings-note">{t('work.late')}</p>
                  </Show>
                  <LessonPlayer
                    lesson={current.lesson}
                    seed={current.seed}
                    initial={progressOf(current)}
                    api={lessonApi}
                    onProgress={(progress) => setPassDone(roundComplete(current.lesson.feedback_mode, progress.first))}
                  />
                </>
              )
            }}
          </Show>
          <Show when={refused()}>
            {(reason) => (
              <p role="alert">{reason() === 'failed' ? t('work.startFailed') : t(`work.refused.${reason() as AttemptRefusal}`)}</p>
            )}
          </Show>
          <Show when={passDone() && release().attempts === 'repeated'}>
            <div class="settings-actions">
              <button type="button" disabled={starting()} onClick={() => begin(release().id)}>
                {t('work.startAgain')}
              </button>
            </div>
          </Show>
        </>
      )}
    </Show>
  )
}
