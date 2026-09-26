import { A, useParams } from '@solidjs/router'
import { createEffect, createResource, createSignal, on, Show } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import { ApiError } from '../lesson/api'
import { LessonPlayer } from '../lesson/LessonPlayer'
import { lessonFinished, roundComplete, type RoundProgress } from '../lesson/progress'
import {
  attemptLessonApi,
  AttemptRefused,
  progressOf,
  type Attempt,
  type AttemptRefusal,
  type ReleaseDetail,
} from './api'
import { useWorkLinks } from './links'
import './work.css'

/** Written answers of the round still waiting for the teacher's published assessment. */
const waitingWritten = (round: RoundProgress) =>
  Object.values(round.answers).filter((answer) => {
    const last = answer.tries.at(-1)
    return last?.result.status === 'pending' && !last.review
  }).length

/** The due date passed and late work is refused. `can_start` said so when the release was read, which
 * may be before the attempt now shown was finished. */
function pastDue(release: ReleaseDetail): boolean {
  return release.late_submissions === 'refuse' && release.due_at !== null && Date.now() > Date.parse(release.due_at)
}

/** One released material: opening it starts an attempt, or resumes it wherever it was left, on
 * any device; after submission it shows the results, and another attempt where the release allows. */
export function WorkPage(props: { participant?: boolean } = {}) {
  const { t, locale } = useI18n()
  const api = useApi().attempts
  const links = useWorkLinks()
  const params = useParams<{ releaseId: string }>()
  const [detail, { refetch }] = createResource(() => Number(params.releaseId), (id) => api.release(id))
  const [attempt, setAttempt] = createSignal<Attempt>()
  const [refused, setRefused] = createSignal<AttemptRefusal | 'failed'>()
  const [passDone, setPassDone] = createSignal(false)
  // The first pass and any second round it earned, so the result comes after both.
  const [finished, setFinished] = createSignal(false)
  const [waiting, setWaiting] = createSignal(0)
  // Nothing begun and a start possible: the intro says what the work is like first.
  const [introduced, setIntroduced] = createSignal(false)
  const [starting, setStarting] = createSignal(false)

  async function begin(releaseId: number) {
    setStarting(true)
    setRefused(undefined)
    try {
      setPassDone(false)
      setFinished(false)
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
        setFinished(false)
        setRefused(undefined)
        setAttempt(loaded.attempt ?? undefined)
        setIntroduced(false)
        if (loaded.attempt || loaded.retraction?.whole_release) return
        if (loaded.can_start) setIntroduced(true)
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
            {detail.error instanceof ApiError && detail.error.status === 404
              ? t('work.notFound')
              : props.participant && detail.error instanceof ApiError && detail.error.status === 401
                ? t('participant.unknownLink')
                : t('work.loadFailed')}
          </p>
        </Show>
      }
    >
      {(release) => (
        <>
          {/* Outside the shell, no page header names the work. */}
          <Show when={props.participant}>
            <h1>{release().title}</h1>
          </Show>
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
                  : release().can_start
                    ? t('work.retracted.attempt', { reason: notice().reason })
                    : t('work.retracted.attemptOver', { reason: notice().reason })}
              </p>
            )}
          </Show>
          <Show when={introduced() && !attempt()}>
            <section class="work-step" aria-labelledby="intro-heading">
              <h2 id="intro-heading">{t('work.intro.heading')}</h2>
              <ul>
                <li>{t(release().feedback_mode === 'immediate' ? 'work.intro.immediate' : 'work.intro.atTheEnd')}</li>
                <li>{t(release().attempts === 'one' ? 'work.intro.one' : 'work.intro.repeated')}</li>
                <li>
                  {release().due_at
                    ? t('work.intro.due', { date: new Date(release().due_at!).toLocaleString(locale()) })
                    : t('work.intro.noDue')}
                  <Show when={release().due_at && release().late_submissions === 'refuse'}>
                    {' '}
                    {t('work.intro.lateRefused')}
                  </Show>
                </li>
                <li>{t(release().show_solutions ? 'work.intro.solutions' : 'work.intro.noSolutions')}</li>
              </ul>
              <button type="button" disabled={starting()} onClick={() => void begin(release().id)}>
                {t('work.start')}
              </button>
            </section>
          </Show>
          <Show when={attempt()} keyed>
            {(current) => {
              // One backend per attempt: it queues the drafts, so it must outlive every save.
              // Retracted or submitted at the due date meanwhile: the release says what next.
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
                    onProgress={(progress) => {
                      setPassDone(roundComplete(current.lesson.feedback_mode, progress.first))
                      setFinished(lessonFinished(current.lesson.feedback_mode, progress))
                      setWaiting(waitingWritten(progress.first))
                    }}
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
          <Show when={attempt() && finished()}>
            <section class="work-step" aria-labelledby="result-heading">
              <h2 id="result-heading">{t('work.result.heading')}</h2>
              <Show when={waiting() > 0}>
                <p>{t('work.result.pending')}</p>
              </Show>
              <A href={links.home} class="work-action" data-variant="outlined">
                {t('work.result.back')}
              </A>
            </section>
          </Show>
          <Show when={passDone() && release().attempts === 'repeated' && !pastDue(release())}>
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
