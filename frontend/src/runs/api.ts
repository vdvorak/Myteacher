import type { ClassSummary } from '../classes/api'
import type { FeedbackMode } from '../courses/api'
import { ApiError } from '../lesson/api'
import type { Student } from '../students/api'

export interface RunSummary {
  id: number
  name: string
  roster_size: number
}

export type EnrolledStudent = Pick<Student, 'id' | 'name' | 'email' | 'state'>

export interface RosterStudent {
  id: number
  name: string
  email: string
  /** Enrolled on their own, not only through a class. */
  direct: boolean
  /** The enrolled classes they are in, by name. */
  classes: string[]
}

export interface CourseRun {
  id: number
  name: string
  course: { id: number; name: string }
  teacher_id: number
  created_at: string
  classes: ClassSummary[]
  /** The students enrolled directly, whatever the state of their account. */
  students: EnrolledStudent[]
  /** Every student of the run now, without deactivated students or minors awaiting consent. */
  roster: RosterStudent[]
}

export interface ReleasableMaterial {
  id: number
  topic: string
  /** Of the latest version. */
  title: string
  /** The version numbers, newest first. */
  versions: number[]
  /** The students the material was made for, to preselect. */
  target_student_ids: number[]
}

export interface ReleaseSettings {
  feedback_mode: FeedbackMode
  /** ISO time with its zone; null for no due date. */
  due_at: string | null
  /** After the due date: accept and mark late, or refuse. */
  late_submissions: 'accept' | 'refuse'
  /** One attempt, or repeated ones where the last submitted counts. */
  attempts: 'one' | 'repeated'
  show_solutions: boolean
}

export const defaultSettings: ReleaseSettings = {
  feedback_mode: 'immediate',
  due_at: null,
  late_submissions: 'accept',
  attempts: 'one',
  show_solutions: true,
}

export interface NewRelease extends ReleaseSettings {
  material_id: number
  version: number
  /** The whole roster, including students who join later, or the chosen students of it. */
  audience: 'run' | 'chosen'
  student_ids: number[] | null
}

export interface Release extends ReleaseSettings {
  id: number
  material_id: number
  /** Of the released version. */
  title: string
  topic: string
  version: number
  audience: 'run' | 'chosen'
  /** The chosen students; empty for a release to the whole run. */
  students: { id: number; name: string }[]
  released_by_id: number
  released_at: string
}

export type ReleaseRefusal = 'unknown_material' | 'unknown_version' | 'not_in_run' | 'due_in_the_past'

/** A release was refused; `reason` says why. */
export class ReleaseRefused extends Error {
  readonly reason: ReleaseRefusal

  constructor(reason: ReleaseRefusal) {
    super(reason)
    this.reason = reason
  }
}

const refusals: ReleaseRefusal[] = ['unknown_material', 'unknown_version', 'not_in_run', 'due_in_the_past']

async function released(response: Response): Promise<Release> {
  if (response.status === 422) {
    const { detail } = (await response.clone().json()) as { detail: unknown }
    if (refusals.includes(detail as ReleaseRefusal)) throw new ReleaseRefused(detail as ReleaseRefusal)
  }
  return json(response)
}

export interface RunsApi {
  list(courseId: number): Promise<RunSummary[]>
  start(courseId: number, name: string): Promise<CourseRun>
  get(id: number): Promise<CourseRun>
  rename(id: number, name: string): Promise<CourseRun>
  enrolClass(id: number, classId: number): Promise<CourseRun>
  unenrolClass(id: number, classId: number): Promise<CourseRun>
  enrolStudent(id: number, studentId: number): Promise<CourseRun>
  unenrolStudent(id: number, studentId: number): Promise<CourseRun>
  /** The classroom material of the run's course that can be released, in topic order. */
  materials(id: number): Promise<ReleasableMaterial[]>
  releases(id: number): Promise<Release[]>
  release(id: number, release: NewRelease): Promise<Release>
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new ApiError(response.status)
  return (await response.json()) as T
}

function send(method: string, url: string, body?: unknown) {
  return fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const classUrl = (id: number, classId: number) => `/api/runs/${id}/classes/${classId}`
const studentUrl = (id: number, studentId: number) => `/api/runs/${id}/students/${studentId}`

export const httpRunsApi: RunsApi = {
  list: async (courseId) => json(await fetch(`/api/courses/${courseId}/runs`)),
  start: async (courseId, name) => json(await send('POST', `/api/courses/${courseId}/runs`, { name })),
  get: async (id) => json(await fetch(`/api/runs/${id}`)),
  rename: async (id, name) => json(await send('PATCH', `/api/runs/${id}`, { name })),
  enrolClass: async (id, classId) => json(await send('PUT', classUrl(id, classId))),
  unenrolClass: async (id, classId) => json(await send('DELETE', classUrl(id, classId))),
  enrolStudent: async (id, studentId) => json(await send('PUT', studentUrl(id, studentId))),
  unenrolStudent: async (id, studentId) => json(await send('DELETE', studentUrl(id, studentId))),
  materials: async (id) => json(await fetch(`/api/runs/${id}/materials`)),
  releases: async (id) => json(await fetch(`/api/runs/${id}/releases`)),
  release: async (id, release) => released(await send('POST', `/api/runs/${id}/releases`, release)),
}
