import { ApiError } from '../lesson/api'

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed'
/** Why a job failed, in terms the teacher can act on. */
export type JobFailure =
  | 'authentication'
  | 'quota'
  | 'transient'
  | 'other'
  | 'invalid_output'
  | 'no_key'
  | 'interrupted'
  /** An extraction found no text: a scan or an image read without OCR. */
  | 'no_text'
  | 'unreadable_file'
  /** Taking a web page's snapshot: the site did not answer, answered with an error, sent no
   * page (a PDF, an image), sent too much, or is inside the network, which is never fetched. */
  | 'unreachable'
  | 'page_error'
  | 'not_a_page'
  | 'too_large'
  | 'blocked_address'

export interface Job {
  id: number
  kind: string
  state: JobState
  /** What the job is doing now; null once it ended. */
  progress: 'waiting' | 'asking_assistant' | 'extracting' | null
  result: Record<string, unknown> | null
  error_kind: JobFailure | null
  /** The assistant's answer when it did not have the expected shape. */
  raw_output: string | null
}

export const finished = (job: Job) => job.state === 'succeeded' || job.state === 'failed'

export interface JobsApi {
  get(id: number): Promise<Job>
  /** How long to wait between two polls of a running job. */
  pollMs: number
}

export const httpJobsApi: JobsApi = {
  get: async (id) => {
    const response = await fetch(`/api/jobs/${id}`)
    if (!response.ok) throw new ApiError(response.status)
    return (await response.json()) as Job
  },
  pollMs: 1500,
}
