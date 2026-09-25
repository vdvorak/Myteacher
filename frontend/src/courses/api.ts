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
  /** Whether the teacher may make their own copy of the course. */
  can_fork: boolean
  /** The course this one was forked from; null when it was not, or the origin is gone. */
  forked_from_id: number | null
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

/** What a topic adds to the course brief, from the topic interview or by hand. */
export interface TopicAdditions {
  goals: string | null
  prior_knowledge: string | null
  emphasis: string | null
  notes: string | null
}

export const additionFields = ['goals', 'prior_knowledge', 'emphasis', 'notes'] as const

/** The assistant's offer of a diagnostic lesson; only accepting it sets `diagnostic_wanted`. */
export interface DiagnosticOffer {
  reason: string
  /** Null while the offer waits for the teacher. */
  answer: 'accepted' | 'declined' | null
}

export interface Topic {
  id: number
  name: string
  position: number
  /** Whether the topic starts with a diagnostic lesson in a run. */
  diagnostic_wanted: boolean
  additions: TopicAdditions
  diagnostic_offer: DiagnosticOffer | null
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

/** What the course interview and a topic interview have in common. */
export interface InterviewBase {
  id: number
  /** Finished once its result landed; ended when the teacher stopped it early. */
  state: 'active' | 'finished' | 'ended'
  rounds: InterviewRound[]
  summary: string | null
  /** The latest job working on the interview. */
  job: Job | null
}

export interface Interview extends InterviewBase {
  /** Set once finished: false means content will be generated without sources. */
  sources_offered: boolean | null
}

/** The short interview about one topic; it ends in the topic's additions. */
export interface TopicInterview extends InterviewBase {
  topic_id: number
}

export interface InterviewStarted<I extends InterviewBase = Interview> {
  interview: I
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

export type TopicChange = Partial<Pick<Topic, 'name' | 'diagnostic_wanted'>> & {
  /** Only the additions given change; null clears one. */
  additions?: Partial<TopicAdditions>
}

/** A type would be both preferred and forbidden. */
export class TypeConflict extends Error {}

/** Material of the topic was released to students, so the topic stays. */
export class TopicReleased extends Error {}

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
  /** Accepting sets the topic's diagnostic flag, declining leaves it; a 409 `ApiError` when no offer is open. */
  answerDiagnosticOffer(id: number, topicId: number, accept: boolean): Promise<Topic[]>
  /** The topic's latest interview, or null when there has been none. */
  topicInterview(id: number, topicId: number): Promise<TopicInterview | null>
  startTopicInterview(id: number, topicId: number): Promise<InterviewStarted<TopicInterview>>
  answerTopicInterview(id: number, topicId: number, answers: string[]): Promise<InterviewStarted<TopicInterview>>
  retryTopicInterview(id: number, topicId: number): Promise<InterviewStarted<TopicInterview>>
  endTopicInterview(id: number, topicId: number): Promise<TopicInterview>
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
  /** A new course of the teacher's own, copied from this one; it does not follow the original. */
  fork(id: number): Promise<Course>
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
const topicInterviewUrl = (id: number, topicId: number) => `${topicsUrl(id)}/${topicId}/interview`

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
  removeTopic: async (id, topicId) => {
    const response = await send('DELETE', `${topicsUrl(id)}/${topicId}`)
    if (response.status === 409 && (await response.clone().json()).detail === 'topic_released') throw new TopicReleased()
    return json(response)
  },
  answerDiagnosticOffer: async (id, topicId, accept) =>
    json(await send('POST', `${topicsUrl(id)}/${topicId}/diagnostic-offer`, { accept })),
  topicInterview: async (id, topicId) => json(await fetch(topicInterviewUrl(id, topicId))),
  startTopicInterview: async (id, topicId) => interviewStep(await send('POST', topicInterviewUrl(id, topicId))),
  answerTopicInterview: async (id, topicId, answers) =>
    interviewStep(await send('POST', `${topicInterviewUrl(id, topicId)}/answers`, { answers })),
  retryTopicInterview: async (id, topicId) => interviewStep(await send('POST', `${topicInterviewUrl(id, topicId)}/retry`)),
  endTopicInterview: async (id, topicId) => interviewStep(await send('POST', `${topicInterviewUrl(id, topicId)}/end`)),
  interview: async (id) => json(await fetch(interviewUrl(id))),
  startInterview: async (id) => interviewStep(await send('POST', interviewUrl(id))),
  answerInterview: async (id, answers) => interviewStep(await send('POST', `${interviewUrl(id)}/answers`, { answers })),
  retryInterview: async (id) => interviewStep(await send('POST', `${interviewUrl(id)}/retry`)),
  endInterview: async (id) => interviewStep(await send('POST', `${interviewUrl(id)}/end`)),
  access: async (id) => json(await fetch(accessUrl(id))),
  grantAccess: async (id, email, right) => accessStep(await send('POST', accessUrl(id), { email, right })),
  changeAccess: async (id, teacherId, right) => accessStep(await send('PUT', `${accessUrl(id)}/${teacherId}`, { right })),
  removeAccess: async (id, teacherId) => accessStep(await send('DELETE', `${accessUrl(id)}/${teacherId}`)),
  fork: async (id) => json(await send('POST', `/api/courses/${id}/fork`)),
  transferOwnership: async (id, email, previousOwnerKeeps) => {
    const response = await send('POST', `/api/courses/${id}/owner`, { email, previous_owner_keeps: previousOwnerKeeps })
    if (response.status !== 204) await accessStep(response)
  },
}
