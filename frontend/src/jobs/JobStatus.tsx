import { A } from '@solidjs/router'
import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import type { MessageKey } from '../i18n/messages'
import { finished, type Job, type JobFailure } from './api'
import './jobs.css'

const failureMessages: Record<JobFailure, MessageKey> = {
  authentication: 'jobs.failed.authentication',
  quota: 'jobs.failed.quota',
  transient: 'jobs.failed.transient',
  other: 'jobs.failed.other',
  invalid_output: 'jobs.failed.invalid_output',
  no_key: 'jobs.failed.no_key',
  interrupted: 'jobs.failed.interrupted',
}

// Failures fixed in the teacher's settings, not by trying again.
const fixedInSettings: ReadonlySet<JobFailure> = new Set(['authentication', 'no_key'])

/** Why assistant work failed, in plain words, with where to fix it. */
export function JobFailureMessage(props: { kind: JobFailure; rawOutput?: string | null }) {
  const { t } = useI18n()
  return (
    <div class="job-failure" role="alert">
      <p>
        {t(failureMessages[props.kind])}
        <Show when={fixedInSettings.has(props.kind)}>
          {' '}
          <A href="/settings">{t('nav.settings')}</A>
        </Show>
      </p>
      <Show when={props.rawOutput}>
        {(raw) => (
          <details>
            <summary>{t('jobs.rawOutput')}</summary>
            <pre class="job-raw-output">{raw()}</pre>
          </details>
        )}
      </Show>
    </div>
  )
}

/** The status of a job: polled while it runs, reported to `onFinished` once it ends. */
export function JobStatus(props: { job: Job; onFinished: (job: Job) => void }) {
  const { t } = useI18n()
  const api = useApi().jobs
  const [job, setJob] = createSignal(props.job)
  const [pollFailed, setPollFailed] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  async function poll() {
    try {
      const current = await api.get(job().id)
      if (stopped) return
      setPollFailed(false)
      setJob(current)
      if (finished(current)) return props.onFinished(current)
    } catch {
      // A lost connection is not a failed job: keep asking.
      if (stopped) return
      setPollFailed(true)
    }
    timer = setTimeout(poll, api.pollMs)
  }

  onMount(() => {
    if (finished(job())) props.onFinished(job())
    else timer = setTimeout(poll, api.pollMs)
  })
  onCleanup(() => {
    stopped = true
    clearTimeout(timer)
  })

  return (
    <Show when={job().state === 'failed' && job().error_kind} fallback={
      <Show when={!finished(job())}>
        <p class="job-status" role="status">
          <span class="job-spinner" aria-hidden="true" />
          {t('jobs.working')}
          <Show when={pollFailed()}> {t('jobs.pollFailed')}</Show>
        </p>
      </Show>
    }>
      {(kind) => <JobFailureMessage kind={kind()} rawOutput={job().raw_output} />}
    </Show>
  )
}
