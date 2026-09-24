import { vi } from 'vitest'
import { Conflict } from '../admin/api'
import { ApiError } from '../lesson/api'
import type { CreatedStudent, Student, StudentBasics, StudentChange, StudentsApi } from './api'

export const jana: Student = { id: 10, name: 'Jana Veselá', email: 'jana@skola.example', language: 'cs', state: 'active' }
export const petr: Student = { id: 11, name: 'Petr Malý', email: 'petr@skola.example', language: 'en', state: 'invited' }

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
      const student: Student = { id: 100 + students.length, ...basics, state: 'invited' }
      students = [...students, student]
      return { ...student, ...invitation() }
    }),
    change: vi.fn(async (id: number, change: StudentChange) => {
      const { active, ...basics } = change
      if (basics.email !== undefined && emailTaken(basics.email, id)) throw new Conflict('email_taken')
      const student = find(id)
      const state = active === undefined ? student.state : active ? 'active' : 'inactive'
      const next: Student = { ...student, ...basics, state }
      students = students.map((s) => (s.id === id ? next : s))
      return next
    }),
    resendInvitation: vi.fn(async (_id: number) => invitation()),
    revokeInvitation: vi.fn(async (_id: number) => {}),
  } satisfies StudentsApi
}
