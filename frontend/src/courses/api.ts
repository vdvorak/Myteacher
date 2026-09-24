import { ApiError } from '../lesson/api'
import type { RenderedExercise } from '../lesson/schema'

/** An exercise type of the component catalog, which a brief chooses from. */
export type CatalogType = RenderedExercise['type']
export type FeedbackMode = 'immediate' | 'at_the_end'

export interface CourseBrief {
  audience: string | null
  level: string | null
  goals: string | null
  timeframe: string | null
  preferred_exercise_types: CatalogType[]
  forbidden_exercise_types: CatalogType[]
  tone: string | null
  feedback_mode: FeedbackMode
  /** With immediate feedback: one retry with a hint after a wrong answer. */
  retry_with_hint: boolean
  /** Exercises answered wrongly return at the end of the lesson. */
  second_round: boolean
  notes: string | null
}

export type BriefText = 'audience' | 'level' | 'goals' | 'timeframe' | 'tone' | 'notes'

export interface CourseBasics {
  name: string
  subject: string
  /** None when the subject is not a language. */
  taught_language: string | null
  /** The language explanations are written in. */
  instruction_language: string
}

export interface CourseSummary extends CourseBasics {
  id: number
}

export interface Course extends CourseSummary {
  owner_id: number
  created_at: string
  brief: CourseBrief
}

/** A type would be both preferred and forbidden. */
export class TypeConflict extends Error {}

export interface CoursesApi {
  list(): Promise<CourseSummary[]>
  get(id: number): Promise<Course>
  create(basics: CourseBasics): Promise<Course>
  change(id: number, change: Partial<CourseBasics>): Promise<Course>
  /** Only the fields given change. */
  changeBrief(id: number, change: Partial<CourseBrief>): Promise<CourseBrief>
}

async function json<T>(response: Response): Promise<T> {
  if (response.status === 409) throw new TypeConflict()
  if (!response.ok) throw new ApiError(response.status)
  return (await response.json()) as T
}

function send(method: string, url: string, body: unknown) {
  return fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

export const httpCoursesApi: CoursesApi = {
  list: async () => json(await fetch('/api/courses')),
  get: async (id) => json(await fetch(`/api/courses/${id}`)),
  create: async (basics) => json(await send('POST', '/api/courses', basics)),
  change: async (id, change) => json(await send('PATCH', `/api/courses/${id}`, change)),
  changeBrief: async (id, change) => json(await send('PATCH', `/api/courses/${id}/brief`, change)),
}
