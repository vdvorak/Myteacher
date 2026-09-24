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
  /** Whether the teacher may change the course; viewers see it read-only. */
  can_edit: boolean
}

export interface Topic {
  id: number
  name: string
  position: number
  /** Whether the topic starts with a diagnostic lesson in a run. */
  diagnostic_wanted: boolean
}

export type TopicChange = Partial<Pick<Topic, 'name' | 'diagnostic_wanted'>>

/** A type would be both preferred and forbidden. */
export class TypeConflict extends Error {}

export interface CoursesApi {
  list(): Promise<CourseSummary[]>
  get(id: number): Promise<Course>
  create(basics: CourseBasics): Promise<Course>
  change(id: number, change: Partial<CourseBasics>): Promise<Course>
  /** Only the fields given change. */
  changeBrief(id: number, change: Partial<CourseBrief>): Promise<CourseBrief>
  /** Each topic call answers with the course's whole ordered topic list. */
  topics(id: number): Promise<Topic[]>
  addTopic(id: number, name: string): Promise<Topic[]>
  changeTopic(id: number, topicId: number, change: TopicChange): Promise<Topic[]>
  /** Refused with a 409 `ApiError` when the list no longer holds exactly these topics. */
  reorderTopics(id: number, topicIds: number[]): Promise<Topic[]>
  removeTopic(id: number, topicId: number): Promise<Topic[]>
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new ApiError(response.status)
  return (await response.json()) as T
}

async function brief(response: Response): Promise<CourseBrief> {
  if (response.status === 409) throw new TypeConflict()
  return json(response)
}

function send(method: string, url: string, body?: unknown) {
  return fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const topicsUrl = (id: number) => `/api/courses/${id}/topics`

export const httpCoursesApi: CoursesApi = {
  list: async () => json(await fetch('/api/courses')),
  get: async (id) => json(await fetch(`/api/courses/${id}`)),
  create: async (basics) => json(await send('POST', '/api/courses', basics)),
  change: async (id, change) => json(await send('PATCH', `/api/courses/${id}`, change)),
  changeBrief: async (id, change) => brief(await send('PATCH', `/api/courses/${id}/brief`, change)),
  topics: async (id) => json(await fetch(topicsUrl(id))),
  addTopic: async (id, name) => json(await send('POST', topicsUrl(id), { name })),
  changeTopic: async (id, topicId, change) => json(await send('PATCH', `${topicsUrl(id)}/${topicId}`, change)),
  reorderTopics: async (id, topicIds) => json(await send('PUT', `${topicsUrl(id)}/order`, { topic_ids: topicIds })),
  removeTopic: async (id, topicId) => json(await send('DELETE', `${topicsUrl(id)}/${topicId}`)),
}
