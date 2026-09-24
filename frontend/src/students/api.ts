import { Conflict, type InvitationResult } from '../admin/api'
import type { Locale } from '../i18n/messages'
import { ApiError } from '../lesson/api'

export interface Consent {
  attested_by_id: number
  attested_by_email: string
  recorded_at: string
  note: string | null
}

export interface Student {
  id: number
  name: string
  email: string
  language: Locale | null
  minor: boolean
  /** The latest guardian consent recorded; null when there is none. */
  consent: Consent | null
  /** A minor without consent is never active; they are awaiting consent instead. */
  state: 'invited' | 'active' | 'inactive' | 'awaiting_consent'
}

export interface StudentBasics {
  name: string
  email: string
  language: Locale
  minor: boolean
}

export type CreatedStudent = Student & InvitationResult

/** Only the fields present change. */
export interface StudentChange {
  name?: string
  email?: string
  language?: Locale
  minor?: boolean
  active?: boolean
}

export interface StudentsApi {
  list(): Promise<Student[]>
  get(id: number): Promise<Student>
  create(basics: StudentBasics): Promise<CreatedStudent>
  change(id: number, change: StudentChange): Promise<Student>
  resendInvitation(id: number): Promise<InvitationResult>
  revokeInvitation(id: number): Promise<void>
  /** Records the signed-in teacher's attestation of a guardian's consent; it activates nobody. */
  recordConsent(id: number, note: string | null): Promise<Student>
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
  recordConsent: async (id, note) => json(await send('POST', `/api/students/${id}/consent`, { note })),
  revokeInvitation: async (id) => {
    await checked(await send('DELETE', `/api/students/${id}/invitation`))
  },
}
