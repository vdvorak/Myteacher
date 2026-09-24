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

export interface AdminApi {
  readSmtp(): Promise<SmtpSettings>
  saveSmtp(update: SmtpSettingsUpdate): Promise<SmtpSettings>
  sendTestEmail(to: string, language: string): Promise<TestEmailResult>
}

async function json<T>(response: Response): Promise<T> {
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
}
