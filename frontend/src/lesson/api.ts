import type {
  AssessmentResult,
  LessonPublic,
  MultipleChoiceAnswer,
} from '../generated/lesson'

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

export async function assessAnswer(
  lessonId: string,
  exerciseId: string,
  answer: MultipleChoiceAnswer,
): Promise<AssessmentResult> {
  const url = `/api/lessons/${encodeURIComponent(lessonId)}/exercises/${encodeURIComponent(exerciseId)}/assessment`
  return json(
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(answer),
    }),
  )
}
