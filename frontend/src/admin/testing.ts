import { vi } from 'vitest'
import type { Locale } from '../i18n/messages'
import {
  Conflict,
  type AdminApi,
  type CreatedTeacher,
  type SmtpSettings,
  type SmtpSettingsUpdate,
  type Teacher,
  type TeacherChange,
} from './api'

export const unconfigured: SmtpSettings = {
  configured: false,
  host: '',
  port: 587,
  security: 'starttls',
  username: '',
  sender: '',
  password_set: false,
}

export const adminTeacher: Teacher = {
  id: 1,
  email: 'admin@skola.example',
  language: null,
  is_admin: true,
  state: 'active',
}

export function fakeAdminApi(
  initial: SmtpSettings = unconfigured,
  testError: string | null = null,
  options: { teachers?: Teacher[]; mailError?: string } = {},
) {
  let stored = initial
  let teachers = options.teachers ?? [adminTeacher]
  const invitation = () =>
    options.mailError === undefined
      ? { invitation_sent: true, error: null }
      : { invitation_sent: false, error: options.mailError }
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
    listTeachers: vi.fn(async () => teachers),
    createTeacher: vi.fn(async (email: string, language: Locale): Promise<CreatedTeacher> => {
      if (teachers.some((teacher) => teacher.email === email)) throw new Conflict('email_taken')
      const teacher: Teacher = { id: teachers.length + 1, email, language, is_admin: false, state: 'invited' }
      teachers = [...teachers, teacher]
      return { ...teacher, ...invitation() }
    }),
    changeTeacher: vi.fn(async (id: number, change: TeacherChange) => {
      const teacher = teachers.find((t) => t.id === id)!
      const next: Teacher = {
        ...teacher,
        is_admin: change.is_admin ?? teacher.is_admin,
        state: change.active === undefined ? teacher.state : change.active ? 'active' : 'inactive',
      }
      const activeAdmins = teachers.filter((t) => t.id !== id && t.is_admin && t.state !== 'inactive')
      if (teacher.is_admin && !(next.is_admin && next.state !== 'inactive') && activeAdmins.length === 0) {
        throw new Conflict('last_active_admin')
      }
      teachers = teachers.map((t) => (t.id === id ? next : t))
      return next
    }),
    resendInvitation: vi.fn(async (_id: number) => invitation()),
  } satisfies AdminApi
}
