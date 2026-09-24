import type { Locale } from '../i18n/messages'
import { ApiError } from '../lesson/api'

export type Security = 'starttls' | 'ssl' | 'none'

export interface SmtpSettings {
  configured: boolean
  host: string
  port: number
  security: Security
  username: string
  sender: string
  password_set: boolean
}

/** Without `password` the stored one is kept; an empty string removes it. */
export interface SmtpSettingsUpdate {
  host: string
  port: number
  security: Security
  username: string
  password?: string
  sender: string
}

export interface TestEmailResult {
  delivered: boolean
  error: string | null
}

export interface Teacher {
  id: number
  email: string
  language: Locale | null
  is_admin: boolean
  state: 'invited' | 'active' | 'inactive'
}

export interface InvitationResult {
  invitation_sent: boolean
  /** The mail error in plain words when the invitation was not sent. */
  error: string | null
}

export type CreatedTeacher = Teacher & InvitationResult

export interface TeacherChange {
  active?: boolean
  is_admin?: boolean
}

/** A refusal the admin can act on, from the backend's 409 answers. */
export class Conflict extends Error {
  readonly reason:
    | 'email_taken'
    | 'last_active_admin'
    | 'already_accepted'
    | 'account_inactive'
    | 'consent_missing'
    | 'not_a_minor'

  constructor(reason: Conflict['reason']) {
    super(reason)
    this.reason = reason
  }
}

export interface AdminApi {
  readSmtp(): Promise<SmtpSettings>
  saveSmtp(update: SmtpSettingsUpdate): Promise<SmtpSettings>
  sendTestEmail(to: string, language: string): Promise<TestEmailResult>
  listTeachers(): Promise<Teacher[]>
  createTeacher(email: string, language: Locale): Promise<CreatedTeacher>
  changeTeacher(id: number, change: TeacherChange): Promise<Teacher>
  resendInvitation(id: number): Promise<InvitationResult>
}

async function json<T>(response: Response): Promise<T> {
  if (response.status === 409) {
    const { detail } = (await response.json()) as { detail: Conflict['reason'] }
    throw new Conflict(detail)
  }
  if (!response.ok) throw new ApiError(response.status)
  return (await response.json()) as T
}

function send(method: string, url: string, body: unknown) {
  return fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

export const httpAdminApi: AdminApi = {
  readSmtp: async () => json(await fetch('/api/admin/smtp')),
  saveSmtp: async (update) => json(await send('PUT', '/api/admin/smtp', update)),
  sendTestEmail: async (to, language) => json(await send('POST', '/api/admin/smtp/test', { to, language })),
  listTeachers: async () => json(await fetch('/api/admin/teachers')),
  createTeacher: async (email, language) => json(await send('POST', '/api/admin/teachers', { email, language })),
  changeTeacher: async (id, change) => json(await send('PATCH', `/api/admin/teachers/${id}`, change)),
  resendInvitation: async (id) => json(await fetch(`/api/admin/teachers/${id}/invitation`, { method: 'POST' })),
}
