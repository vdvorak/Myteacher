import type { LessonPublic } from '../generated/lesson'
import { ApiError } from '../lesson/api'
import type { LessonApi } from '../lesson/LessonPlayer'
import type { LessonProgress, RoundKey, Try } from '../lesson/progress'
import { isRendered, type ExercisePublic, type RenderedAnswer, type TryOutcome } from '../lesson/schema'
import type { ReleaseSettings } from '../runs/api'

/** Material released to the signed-in student. */
export interface StudentRelease {
  id: number
  title: string
  topic: string
  /** The run's name. */
  run: string
  released_at: string
  due_at: string | null
  state: 'not_started' | 'in_progress' | 'submitted'
  /** Whether the attempt that counts was submitted after the due date. */
  late: boolean
  /** The last submitted attempt, which is the one that counts. */
  counting_attempt_id: number | null
}

export interface ServedRound {
  exercises: ExercisePublic[]
  /** The order to show a matching's right items and the tokens to order in, by exercise id. */
  layouts: Record<string, string[]>
  answers: Record<string, { draft: RenderedAnswer | null; tries: Try[] }>
  /** Submitted as a round, with feedback at the end. */
  submitted: boolean
}

/** One pass through a release, owned by the server: it counts the tries and decides on solutions. */
export interface Attempt {
  id: number
  release_id: number
  number: number
  seed: string
  /** The released version in the release's feedback mode, without its key. */
  lesson: LessonPublic
  first: ServedRound
  second: ServedRound | null
  started_at: string
  submitted_at: string | null
  late: boolean
}

export interface ReleaseDetail extends StudentRelease, Omit<ReleaseSettings, 'due_at'> {
  /** Whether a new attempt may be started now. */
  can_start: boolean
  /** The attempt being worked on, or else the one that counts. */
  attempt: Attempt | null
}

export type AttemptRefusal = 'no_more_attempts' | 'past_due'

/** Starting an attempt was refused; `reason` says why. */
export class AttemptRefused extends Error {
  readonly reason: AttemptRefusal

  constructor(reason: AttemptRefusal) {
    super(reason)
    this.reason = reason
  }
}

export interface AttemptsApi {
  /** What is released to the student in the runs they are on, the latest first. */
  releases(): Promise<StudentRelease[]>
  release(id: number): Promise<ReleaseDetail>
  /** Starts an attempt at the release, or resumes the one being worked on. */
  start(releaseId: number): Promise<Attempt>
  saveDraft(attemptId: number, round: RoundKey, exerciseId: string, answer: RenderedAnswer): Promise<void>
  /** One try with immediate feedback. */
  tryAnswer(attemptId: number, round: RoundKey, exerciseId: string, answer: RenderedAnswer): Promise<TryOutcome>
  /** A round with feedback at the end, with the answers not saved yet. */
  submitRound(
    attemptId: number,
    round: RoundKey,
    answers: Record<string, RenderedAnswer>,
  ): Promise<Record<string, Try>>
  secondRound(attemptId: number): Promise<ServedRound>
}

async function checked(response: Response): Promise<Response> {
  if (!response.ok) {
    if (response.status === 409) {
      const { detail } = (await response.clone().json()) as { detail: unknown }
      if (detail === 'no_more_attempts' || detail === 'past_due') throw new AttemptRefused(detail)
    }
    throw new ApiError(response.status)
  }
  return response
}

const json = async <T>(response: Response): Promise<T> => (await (await checked(response)).json()) as T

function send(method: string, url: string, body?: unknown) {
  return fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const roundUrl = (attemptId: number, round: RoundKey) => `/api/attempts/${attemptId}/rounds/${round}`

export const httpAttemptsApi: AttemptsApi = {
  releases: async () => json(await fetch('/api/my/releases')),
  release: async (id) => json(await fetch(`/api/my/releases/${id}`)),
  start: async (releaseId) => json(await send('POST', `/api/my/releases/${releaseId}/attempts`)),
  saveDraft: async (attemptId, round, exerciseId, answer) => {
    await checked(await send('PUT', `${roundUrl(attemptId, round)}/drafts/${encodeURIComponent(exerciseId)}`, answer))
  },
  tryAnswer: async (attemptId, round, exerciseId, answer) =>
    json(await send('POST', `${roundUrl(attemptId, round)}/exercises/${encodeURIComponent(exerciseId)}/tries`, answer)),
  submitRound: async (attemptId, round, answers) =>
    (
      await json<{ tries: Record<string, Try> }>(
        await send('POST', `${roundUrl(attemptId, round)}/submission`, { answers }),
      )
    ).tries,
  secondRound: async (attemptId) => json(await send('POST', `/api/attempts/${attemptId}/second-round`)),
}

/** The attempt as the lesson player resumes it. */
export function progressOf(attempt: Attempt): LessonProgress {
  const round = (served: ServedRound) => ({
    exercises: served.exercises.filter(isRendered),
    answers: Object.fromEntries(
      Object.entries(served.answers).map(([id, progress]) => [
        id,
        { draft: progress.draft ?? undefined, tries: progress.tries },
      ]),
    ),
    submitted: served.submitted,
    layouts: served.layouts,
  })
  return {
    version: 2,
    lessonId: attempt.lesson.id,
    seed: attempt.seed,
    first: round(attempt.first),
    second: attempt.second && round(attempt.second),
  }
}

/** The lesson player's backend for an attempt: the server assesses, counts the tries and draws the
 * second round, so what the player asks for (`reveal`, the failed exercises, the seed) is decided there. */
export function attemptLessonApi(api: AttemptsApi, attemptId: number): LessonApi {
  // Drafts of one exercise are sent one at a time, the latest last, so a slower earlier request
  // never overwrites a later answer; the ones typed meanwhile collapse into the latest.
  const sending = new Map<string, Promise<void>>()
  const waiting = new Map<string, RenderedAnswer>()
  const drain = async (round: RoundKey, exerciseId: string, key: string) => {
    while (waiting.has(key)) {
      const answer = waiting.get(key)!
      waiting.delete(key)
      await api.saveDraft(attemptId, round, exerciseId, answer).catch(() => undefined)
    }
    sending.delete(key)
  }
  return {
    assess: (exerciseId, answer, { round }) => api.tryAnswer(attemptId, round, exerciseId, answer),
    secondRound: async () => {
      const round = await api.secondRound(attemptId)
      return { exercises: round.exercises, layouts: round.layouts }
    },
    saveDraft: (round, exerciseId, answer) => {
      const key = `${round}:${exerciseId}`
      waiting.set(key, answer)
      if (!sending.has(key)) sending.set(key, drain(round, exerciseId, key))
    },
    submitRound: async (round, answers) => {
      // The server assesses the drafts it holds too, so the ones typed before go first.
      await Promise.all(sending.values())
      return api.submitRound(attemptId, round, answers)
    },
  }
}
