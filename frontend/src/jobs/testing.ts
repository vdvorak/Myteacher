import { vi } from 'vitest'
import type { Job, JobsApi } from './api'

type Outcome = Pick<Job, 'state' | 'error_kind' | 'raw_output'>

/**
 * A stand-in for the jobs endpoint. A started job is running on its first poll and ends on the
 * next one, when its `finish` runs and says how it ended.
 */
export function fakeJobsApi() {
  let nextId = 500
  const jobs = new Map<number, { job: Job; finish?: () => Outcome }>()
  const api = {
    pollMs: 0,
    get: vi.fn(async (id: number): Promise<Job> => {
      const stored = jobs.get(id)
      if (!stored) throw new Error(`no job ${id}`)
      if (stored.job.state === 'queued') {
        stored.job = { ...stored.job, state: 'running', progress: 'asking_assistant' }
      } else if (stored.finish) {
        stored.job = { ...stored.job, ...stored.finish(), progress: null }
        stored.finish = undefined
      }
      return { ...stored.job }
    }),
  } satisfies JobsApi
  return {
    ...api,
    /** A queued job whose end `finish` decides, for the fakes of the endpoints that start jobs. */
    start(kind: string, finish: () => Outcome): Job {
      const job: Job = {
        id: nextId++,
        kind,
        state: 'queued',
        progress: 'waiting',
        result: null,
        error_kind: null,
        raw_output: null,
      }
      jobs.set(job.id, { job, finish })
      return { ...job }
    },
    /** A job already in the given state, for pages opened while a job runs. */
    put(job: Job, finish?: () => Outcome) {
      jobs.set(job.id, { job, finish })
    },
  }
}

export type FakeJobs = ReturnType<typeof fakeJobsApi>
