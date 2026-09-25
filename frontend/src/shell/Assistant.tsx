import { A } from '@solidjs/router'
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import type { MessageKey } from '../i18n/messages'
import { finished, type RecentJob } from '../jobs/api'
import { Disclosure } from './Disclosure'

const kindNames: Record<string, MessageKey> = {
  course_interview: 'assistant.kind.course_interview',
  source_extraction: 'assistant.kind.source_extraction',
  topic_interview: 'assistant.kind.topic_interview',
  concept_map: 'assistant.kind.concept_map',
  reference_document: 'assistant.kind.reference_document',
  classroom_material: 'assistant.kind.classroom_material',
  open_assessment: 'assistant.kind.open_assessment',
}

const topicTabs: Record<string, string> = {
  topic_interview: 'additions',
  concept_map: 'map',
  reference_document: 'documents',
  classroom_material: 'materials',
}

// Failures fixed in the teacher's settings, not where the work was.
const fixedInSettings: ReadonlySet<string> = new Set(['authentication', 'no_key'])

/** Where a job's result is shown. */
export function placeOf(job: RecentJob): string | null {
  const { course_id: course, topic_id: topic, run_id: run, release_id: release } = job.place
  if (run !== null && release !== null) return `/runs/${run}/releases/${release}`
  if (course === null) return null
  if (topic !== null) return `/courses/${course}/topics/${topic}?tab=${topicTabs[job.kind] ?? 'map'}`
  if (job.kind === 'course_interview') return `/courses/${course}?tab=brief`
  if (job.kind === 'source_extraction') return `/courses/${course}?tab=sources`
  return `/courses/${course}`
}

const running = (job: RecentJob) => !finished(job)

// Pages showing a job they started ask the indicator to look again, so it follows at once.
const [asked, setAsked] = createSignal(0)
export const noticeJobs = () => setAsked((n) => n + 1)

/** The assistant's recent work in the top bar, and a notice when some ends while the teacher is here. */
export function AssistantIndicator() {
  const { t } = useI18n()
  const api = useApi().jobs
  const [jobs, setJobs] = createSignal<RecentJob[]>([])
  const [notices, setNotices] = createSignal<RecentJob[]>([])
  let known: Map<number, RecentJob> | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  // Each look is numbered; an answer to an earlier look than the latest is out of date.
  let looks = 0
  const again = (ms: number) => {
    clearTimeout(timer)
    timer = setTimeout(() => void look(), ms)
  }

  async function look() {
    clearTimeout(timer)
    const mine = ++looks
    let recent: RecentJob[]
    try {
      recent = await api.recent()
    } catch {
      // A lost connection is not ended work: keep watching what ran, a little later.
      if (!stopped && mine === looks && jobs().some(running)) again(Math.max(api.pollMs * 4, 100))
      return
    }
    if (stopped || mine !== looks) return
    // Work that was running when last seen and has ended since is announced; what had ended
    // before the page opened is not.
    if (known) {
      const ended = recent.filter((job) => finished(job) && known!.has(job.id) && running(known!.get(job.id)!))
      if (ended.length > 0) setNotices([...ended, ...notices()].slice(0, 3))
    }
    known = new Map(recent.map((job) => [job.id, job]))
    setJobs(recent)
    if (recent.some(running)) again(Math.max(api.pollMs, 20))
  }

  onMount(() => void look())
  // A page started work: look again now rather than at the next poll.
  createEffect(on(asked, () => void look(), { defer: true }))
  onCleanup(() => {
    stopped = true
    clearTimeout(timer)
  })

  const count = () => jobs().filter(running).length
  const title = (job: RecentJob) =>
    [t(kindNames[job.kind] ?? 'assistant.kind.other'), job.course_name].filter(Boolean).join(' · ')
  const dismiss = (job: RecentJob) => setNotices(notices().filter((shown) => shown.id !== job.id))

  return (
    <>
      <Show when={jobs().length > 0}>
        <Disclosure
          class="assistant-menu"
          label={
            <>
              <span class="assistant-dot" data-running={count() > 0} aria-hidden="true" />
              {count() > 0 ? t('assistant.working', { count: count() }) : t('assistant.label')}
            </>
          }
          name={count() > 0 ? t('assistant.working', { count: count() }) : t('assistant.label')}
        >
          {(close) => (
            <ul class="assistant-jobs" aria-label={t('assistant.recent')}>
              <For each={jobs()}>
                {(job) => (
                  <li>
                    <span>{title(job)}</span>
                    <span class="badge" data-tone={job.state === 'failed' ? 'attention' : running(job) ? 'quiet' : 'done'}>
                      {t(job.state === 'failed' ? 'assistant.failed' : running(job) ? 'assistant.running' : 'assistant.done')}
                    </span>
                    <Show when={placeOf(job)}>
                      {(href) => (
                        <A href={href()} onClick={close}>
                          {t('assistant.show')}
                        </A>
                      )}
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          )}
        </Disclosure>
      </Show>
      <div class="notices">
        <For each={notices()}>
          {(job) => (
            <div
              class="notice"
              data-tone={job.state === 'failed' ? 'failed' : 'done'}
              role={job.state === 'failed' ? 'alert' : 'status'}
              aria-label={t(job.state === 'failed' ? 'assistant.noticeFailed' : 'assistant.noticeDone')}
            >
              <p>{t(job.state === 'failed' ? 'assistant.failedTitle' : 'assistant.doneTitle', { work: title(job) })}</p>
              <Show
                when={job.state === 'failed' && fixedInSettings.has(job.error_kind ?? '')}
                fallback={
                  <Show when={placeOf(job)}>
                    {(href) => (
                      <A href={href()} onClick={() => dismiss(job)}>
                        {t(job.state === 'failed' ? 'assistant.seeWhy' : 'assistant.show')}
                      </A>
                    )}
                  </Show>
                }
              >
                <A href="/settings" onClick={() => dismiss(job)}>
                  {t('assistant.fix')}
                </A>
              </Show>
              <button type="button" class="button-secondary" onClick={() => dismiss(job)}>
                {t('assistant.close')}
              </button>
            </div>
          )}
        </For>
      </div>
    </>
  )
}
