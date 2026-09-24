import { ApiError } from '../lesson/api'
import type { Student } from '../students/api'

export interface ClassSummary {
  id: number
  name: string
  member_count: number
}

export type Member = Pick<Student, 'id' | 'name' | 'email' | 'state'>

export interface SchoolClass {
  id: number
  name: string
  /** The current members by name, deactivated ones included. */
  members: Member[]
}

/** The name belongs to another class already. */
export class NameTaken extends Error {}

export interface ClassesApi {
  list(): Promise<ClassSummary[]>
  get(id: number): Promise<SchoolClass>
  create(name: string): Promise<SchoolClass>
  rename(id: number, name: string): Promise<SchoolClass>
  addMember(id: number, studentId: number): Promise<SchoolClass>
  removeMember(id: number, studentId: number): Promise<SchoolClass>
}

async function json<T>(response: Response): Promise<T> {
  if (response.status === 409) throw new NameTaken()
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

const memberUrl = (id: number, studentId: number) => `/api/classes/${id}/members/${studentId}`

export const httpClassesApi: ClassesApi = {
  list: async () => json(await fetch('/api/classes')),
  get: async (id) => json(await fetch(`/api/classes/${id}`)),
  create: async (name) => json(await send('POST', '/api/classes', { name })),
  rename: async (id, name) => json(await send('PATCH', `/api/classes/${id}`, { name })),
  addMember: async (id, studentId) => json(await send('PUT', memberUrl(id, studentId))),
  removeMember: async (id, studentId) => json(await send('DELETE', memberUrl(id, studentId))),
}
