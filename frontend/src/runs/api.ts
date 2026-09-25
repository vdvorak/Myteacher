import type { ClassSummary } from '../classes/api'
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

export interface RunsApi {
  list(courseId: number): Promise<RunSummary[]>
  start(courseId: number, name: string): Promise<CourseRun>
  get(id: number): Promise<CourseRun>
  rename(id: number, name: string): Promise<CourseRun>
  enrolClass(id: number, classId: number): Promise<CourseRun>
  unenrolClass(id: number, classId: number): Promise<CourseRun>
  enrolStudent(id: number, studentId: number): Promise<CourseRun>
  unenrolStudent(id: number, studentId: number): Promise<CourseRun>
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
}
