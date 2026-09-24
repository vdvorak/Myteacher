import { Conflict, type InvitationResult } from '../admin/api'
import type { Locale } from '../i18n/messages'
import { ApiError } from '../lesson/api'

export interface Student {
  id: number
  name: string
  email: string
  language: Locale | null
  state: 'invited' | 'active' | 'inactive'
}

export interface StudentBasics {
  name: string
  email: string
  language: Locale
}

export type CreatedStudent = Student & InvitationResult

/** Only the fields present change. */
export interface StudentChange {
  name?: string
  email?: string
  language?: Locale
  active?: boolean
}

export interface StudentsApi {
  list(): Promise<Student[]>
  get(id: number): Promise<Student>
  create(basics: StudentBasics): Promise<CreatedStudent>
  change(id: number, change: StudentChange): Promise<Student>
  resendInvitation(id: number): Promise<InvitationResult>
  revokeInvitation(id: number): Promise<void>
}

async function checked(response: Response): Promise<Response> {
  if (response.status === 409) {
    const { detail } = (await response.json()) as { detail: Conflict['reason'] }
    throw new Conflict(detail)
  }
  if (!response.ok) throw new ApiError(response.status)
  return response
}

async function json<T>(response: Response): Promise<T> {
  return (await (await checked(response)).json()) as T
}

function send(method: string, url: string, body?: unknown) {
  return fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export const httpStudentsApi: StudentsApi = {
  list: async () => json(await fetch('/api/students')),
  get: async (id) => json(await fetch(`/api/students/${id}`)),
  create: async (basics) => json(await send('POST', '/api/students', basics)),
  change: async (id, change) => json(await send('PATCH', `/api/students/${id}`, change)),
  resendInvitation: async (id) => json(await send('POST', `/api/students/${id}/invitation`)),
  revokeInvitation: async (id) => {
    await checked(await send('DELETE', `/api/students/${id}/invitation`))
  },
}
