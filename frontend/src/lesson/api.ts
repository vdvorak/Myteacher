import type {
  AnswerKey,
  AssessmentResult,
  LessonPublic,
  SecondRound,
  SecondRoundRequest,
} from '../generated/lesson'
import type { AssessmentOutcome } from './schema'
import type { LessonApi } from './LessonPlayer'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`API request failed with status ${status}`)
    this.status = status
  }
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new ApiError(response.status)
  return (await response.json()) as T
}

export async function fetchLesson(lessonId: string): Promise<LessonPublic> {
  return json(await fetch(`/api/lessons/${encodeURIComponent(lessonId)}`))
}

export async function fetchAnswerKey(lessonId: string): Promise<AnswerKey> {
  return json(await fetch(`/api/lessons/${encodeURIComponent(lessonId)}/answer-key`))
}

async function post<T>(url: string, body: unknown): Promise<T> {
  return json(
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

export function lessonApi(lessonId: string): LessonApi {
  const lesson = `/api/lessons/${encodeURIComponent(lessonId)}`
  return {
    assess: async (exerciseId, answer, { reveal }): Promise<AssessmentResult> => {
      const outcome = await post<AssessmentOutcome>(
        `${lesson}/exercises/${encodeURIComponent(exerciseId)}/assessment?reveal=${reveal}`,
        answer,
      )
      // The player only runs types that have an assessor, so this is a contract breach.
      if (outcome.status !== 'assessed') throw new Error(`no assessor for exercise ${exerciseId}`)
      return outcome
    },
    secondRound: (failedExerciseIds, seed): Promise<SecondRound> =>
      post(`${lesson}/second-round`, {
        failed_exercise_ids: failedExerciseIds,
        seed,
      } satisfies SecondRoundRequest),
  }
}
