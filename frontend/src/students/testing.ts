import { vi } from 'vitest'
import { Conflict } from '../admin/api'
import { ApiError } from '../lesson/api'
import type { CreatedStudent, Student, StudentBasics, StudentChange, StudentsApi } from './api'

/** Signs the consent the fake records. */
export const attester = { id: 1, email: 'admin@skola.example' }

const base = { minor: false, consent: null, classes: [] }
export const jana: Student = { ...base, id: 10, name: 'Jana Veselá', email: 'jana@skola.example', language: 'cs', state: 'active' }
export const petr: Student = { ...base, id: 11, name: 'Petr Malý', email: 'petr@skola.example', language: 'en', state: 'invited' }
export const eva: Student = {
  ...base,
  id: 12,
  name: 'Eva Malá',
  email: 'eva@skola.example',
  language: 'cs',
  minor: true,
  state: 'awaiting_consent',
}

/** A stand-in for the students endpoints, keeping the students it was given in memory. */
export function fakeStudentsApi(options: { students?: Student[]; mailError?: string } = {}) {
  let students = options.students ?? [jana, petr]
  const invitation = () =>
    options.mailError === undefined
      ? { invitation_sent: true, error: null }
      : { invitation_sent: false, error: options.mailError }
  const find = (id: number) => {
    const student = students.find((s) => s.id === id)
    if (!student) throw new ApiError(404)
    return student
  }
  const emailTaken = (email: string, id?: number) =>
    students.some((s) => s.id !== id && s.email === email.trim().toLowerCase())
  return {
    list: vi.fn(async () => [...students].sort((a, b) => a.name.localeCompare(b.name))),
    get: vi.fn(async (id: number) => find(id)),
    create: vi.fn(async (basics: StudentBasics): Promise<CreatedStudent> => {
      if (emailTaken(basics.email)) throw new Conflict('email_taken')
      const awaiting = basics.minor
      const student: Student = {
        id: 100 + students.length,
        ...basics,
        consent: null,
        classes: [],
        state: awaiting ? 'awaiting_consent' : 'invited',
      }
      students = [...students, student]
      return { ...student, ...(awaiting ? { invitation_sent: false, error: null } : invitation()) }
    }),
    change: vi.fn(async (id: number, change: StudentChange) => {
      const { active, ...basics } = change
      if (basics.email !== undefined && emailTaken(basics.email, id)) throw new Conflict('email_taken')
      const student = find(id)
      const next: Student = { ...student, ...basics }
      const withoutConsent = next.minor && next.consent === null
      if (active === true && withoutConsent) throw new Conflict('consent_missing')
      if (active !== undefined) next.state = active ? 'active' : 'inactive'
      // Like the backend: a minor without consent is never active, invited or merely inactive.
      if (withoutConsent) next.state = 'awaiting_consent'
      else if (next.state === 'awaiting_consent') next.state = 'inactive'
      students = students.map((s) => (s.id === id ? next : s))
      return next
    }),
    resendInvitation: vi.fn(async (_id: number) => invitation()),
    revokeInvitation: vi.fn(async (_id: number) => {}),
    recordConsent: vi.fn(async (id: number, note: string | null) => {
      const student = find(id)
      if (!student.minor) throw new Conflict('not_a_minor')
      const consent = { attested_by_id: attester.id, attested_by_email: attester.email, recorded_at: '2026-09-24T10:00:00Z', note }
      const next: Student = { ...student, consent, state: student.state === 'awaiting_consent' ? 'inactive' : student.state }
      students = students.map((s) => (s.id === id ? next : s))
      return next
    }),
  } satisfies StudentsApi
}
