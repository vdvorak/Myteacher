import { vi } from 'vitest'
import type { Job, JobsApi, RecentJob } from './api'

type Outcome = Pick<Job, 'state' | 'error_kind' | 'raw_output'>

/**
 * A stand-in for the jobs endpoint. A started job is running on its first poll and ends on the
 * next one, when its `finish` runs and says how it ended.
 */
export function fakeJobsApi(options: { recent?: RecentJob[] } = {}) {
  let nextId = 500
  const jobs = new Map<number, { job: Job; finish?: () => Outcome; progress: Job['progress'] }>()
  let recent = structuredClone(options.recent ?? [])
  const api = {
    pollMs: 0,
    recent: vi.fn(async () => structuredClone(recent)),
    get: vi.fn(async (id: number): Promise<Job> => {
      const stored = jobs.get(id)
      if (!stored) throw new Error(`no job ${id}`)
      if (stored.job.state === 'queued') {
        stored.job = { ...stored.job, state: 'running', progress: stored.progress }
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
    start(kind: string, finish: () => Outcome, progress: Job['progress'] = 'asking_assistant'): Job {
      const job: Job = {
        id: nextId++,
        kind,
        state: 'queued',
        progress: 'waiting',
        result: null,
        error_kind: null,
        raw_output: null,
      }
      jobs.set(job.id, { job, finish, progress })
      return { ...job }
    },
    /** Ends a job of the recent list, as the server would. */
    endRecent(id: number, outcome: Outcome) {
      recent = recent.map((job) => (job.id === id ? { ...job, ...outcome, progress: null } : job))
    },
    /** A job already in the given state, for pages opened while a job runs. */
    put(job: Job, finish?: () => Outcome) {
      jobs.set(job.id, { job, finish, progress: 'asking_assistant' })
    },
  }
}

export type FakeJobs = ReturnType<typeof fakeJobsApi>
