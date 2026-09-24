import { vi } from 'vitest'
import type { AdminApi, SmtpSettings, SmtpSettingsUpdate } from './api'

export const unconfigured: SmtpSettings = {
  configured: false,
  host: '',
  port: 587,
  security: 'starttls',
  username: '',
  sender: '',
  password_set: false,
}

export function fakeAdminApi(initial: SmtpSettings = unconfigured, testError: string | null = null) {
  let stored = initial
  return {
    readSmtp: vi.fn(async () => stored),
    saveSmtp: vi.fn(async (update: SmtpSettingsUpdate) => {
      const { password, ...rest } = update
      stored = {
        ...rest,
        configured: true,
        password_set: password === undefined ? stored.password_set : password !== '',
      }
      return stored
    }),
    sendTestEmail: vi.fn(async (_to: string, _language: string) =>
      testError === null ? { delivered: true, error: null } : { delivered: false, error: testError },
    ),
  } satisfies AdminApi
}
