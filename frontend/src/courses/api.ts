import { ApiError } from '../lesson/api'
import type { Job } from '../jobs/api'
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

/** A right on a course's access list, each including the ones before it. */
export type CourseRight = 'view' | 'fork' | 'edit'
export const courseRights: CourseRight[] = ['view', 'fork', 'edit']

export interface CourseSummary extends CourseBasics {
  id: number
  /** What the teacher may do with the course. */
  access: CourseRight | 'owner'
}

export interface Course extends CourseSummary {
  owner_id: number
  created_at: string
  brief: CourseBrief
  /** Whether the teacher may change the course; viewers see it read-only. */
  can_edit: boolean
  /** Whether the teacher may change the access list and transfer the ownership. */
  can_manage_access: boolean
}

export interface AccessEntry {
  teacher_id: number
  email: string
  right: CourseRight
}

export type AccessRefusal =
  | 'not_a_teacher'
  | 'is_owner'
  /** Another request changed the same entry first. */
  | 'access_changed'

/** A change of the access list or of the ownership was refused. */
export class AccessConflict extends Error {
  readonly reason: AccessRefusal

  constructor(reason: AccessRefusal) {
    super(reason)
    this.reason = reason
  }
}

export interface Topic {
  id: number
  name: string
  position: number
  /** Whether the topic starts with a diagnostic lesson in a run. */
  diagnostic_wanted: boolean
}

export interface InterviewQuestion {
  number: number
  question: string
  recommended_answer: string
}

export interface InterviewRound {
  number: number
  questions: InterviewQuestion[]
  /** Null while the round waits for the teacher. */
  answers: string[] | null
}

export interface Interview {
  id: number
  /** Finished once the brief was patched; ended when the teacher stopped it early. */
  state: 'active' | 'finished' | 'ended'
  rounds: InterviewRound[]
  /** Set once finished: false means content will be generated without sources. */
  sources_offered: boolean | null
  summary: string | null
  /** The latest job working on the interview. */
  job: Job | null
}

export interface InterviewStarted {
  interview: Interview
  job: Job
}

export type InterviewRefusal =
  | 'interview_active'
  | 'no_provider_key'
  | 'no_open_round'
  | 'no_active_interview'
  | 'nothing_to_retry'
  /** Another request changed the interview first. */
  | 'interview_changed'

/** The interview is not in a state that allows the step. */
export class InterviewConflict extends Error {
  readonly reason: InterviewRefusal

  constructor(reason: InterviewRefusal) {
    super(reason)
    this.reason = reason
  }
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
  /** The course's latest interview, or null when there has been none. */
  interview(id: number): Promise<Interview | null>
  startInterview(id: number): Promise<InterviewStarted>
  /** One answer per question of the open round; an empty one leaves a question open. */
  answerInterview(id: number, answers: string[]): Promise<InterviewStarted>
  retryInterview(id: number): Promise<InterviewStarted>
  endInterview(id: number): Promise<Interview>
  /** Each access call answers with the whole access list, by email; only the owner may call. */
  access(id: number): Promise<AccessEntry[]>
  /** Replaces the right the teacher had, if any. */
  grantAccess(id: number, email: string, right: CourseRight): Promise<AccessEntry[]>
  changeAccess(id: number, teacherId: number, right: CourseRight): Promise<AccessEntry[]>
  removeAccess(id: number, teacherId: number): Promise<AccessEntry[]>
  /** The previous owner keeps the right named, or none. */
  transferOwnership(id: number, email: string, previousOwnerKeeps: CourseRight | null): Promise<void>
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

async function interviewStep<T>(response: Response): Promise<T> {
  if (response.status === 409) {
    const body = (await response.json()) as { detail: InterviewRefusal }
    throw new InterviewConflict(body.detail)
  }
  return json(response)
}

async function accessStep<T>(response: Response): Promise<T> {
  if (response.status === 409 || response.status === 422) {
    const body = (await response.json()) as { detail: unknown }
    if (typeof body.detail === 'string') throw new AccessConflict(body.detail as AccessRefusal)
  }
  return json(response)
}

const accessUrl = (id: number) => `/api/courses/${id}/access`
const interviewUrl = (id: number) => `/api/courses/${id}/interview`
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
  interview: async (id) => json(await fetch(interviewUrl(id))),
  startInterview: async (id) => interviewStep(await send('POST', interviewUrl(id))),
  answerInterview: async (id, answers) => interviewStep(await send('POST', `${interviewUrl(id)}/answers`, { answers })),
  retryInterview: async (id) => interviewStep(await send('POST', `${interviewUrl(id)}/retry`)),
  endInterview: async (id) => interviewStep(await send('POST', `${interviewUrl(id)}/end`)),
  access: async (id) => json(await fetch(accessUrl(id))),
  grantAccess: async (id, email, right) => accessStep(await send('POST', accessUrl(id), { email, right })),
  changeAccess: async (id, teacherId, right) => accessStep(await send('PUT', `${accessUrl(id)}/${teacherId}`, { right })),
  removeAccess: async (id, teacherId) => accessStep(await send('DELETE', `${accessUrl(id)}/${teacherId}`)),
  transferOwnership: async (id, email, previousOwnerKeeps) => {
    const response = await send('POST', `/api/courses/${id}/owner`, { email, previous_owner_keeps: previousOwnerKeeps })
    if (response.status !== 204) await accessStep(response)
  },
}
