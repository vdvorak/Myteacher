import { vi } from 'vitest'
import { ApiError } from '../lesson/api'
import type { Student } from '../students/api'
import { jana, petr } from '../students/testing'
import type { CourseRun, RunsApi } from './api'

interface StoredRun {
  id: number
  courseId: number
  name: string
  classIds: number[]
  studentIds: number[]
}

interface StoredClass {
  id: number
  name: string
  memberIds: number[]
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name)

/** A stand-in for the run endpoints over the given classes and students, resolving the roster on each read. */
export function fakeRunsApi(
  options: {
    runs?: StoredRun[]
    classes?: StoredClass[]
    students?: Student[]
    courseNames?: Record<number, string>
  } = {},
) {
  let runs = options.runs ?? []
  const classes = options.classes ?? [{ id: 1, name: '2.B 2026/27', memberIds: [jana.id] }]
  const students = options.students ?? [jana, petr]
  const find = (id: number) => {
    const stored = runs.find((r) => r.id === id)
    if (!stored) throw new ApiError(404)
    return stored
  }
  const resolve = (stored: StoredRun): CourseRun => {
    const enrolled = classes.filter((c) => stored.classIds.includes(c.id)).sort(byName)
    // Like the backend: deactivated students and minors awaiting consent are enrolled but not on the roster.
    const roster = students
      .filter((s) => s.state === 'active' || s.state === 'invited')
      .map((s) => ({
        id: s.id,
        name: s.name,
        email: s.email,
        direct: stored.studentIds.includes(s.id),
        classes: enrolled.filter((c) => c.memberIds.includes(s.id)).map((c) => c.name),
      }))
      .filter((s) => s.direct || s.classes.length > 0)
      .sort(byName)
    return {
      id: stored.id,
      name: stored.name,
      course: { id: stored.courseId, name: options.courseNames?.[stored.courseId] ?? 'Španělština 2.B' },
      teacher_id: 2,
      created_at: '2026-09-25T08:00:00Z',
      classes: enrolled.map((c) => ({ id: c.id, name: c.name, member_count: c.memberIds.length })),
      students: students
        .filter((s) => stored.studentIds.includes(s.id))
        .sort(byName)
        .map(({ id, name, email, state }) => ({ id, name, email, state })),
      roster,
    }
  }
  const store = (next: StoredRun) => {
    runs = [...runs.filter((r) => r.id !== next.id), next]
    return resolve(next)
  }
  return {
    list: vi.fn(async (courseId: number) =>
      runs
        .filter((r) => r.courseId === courseId)
        .sort(byName)
        .map((r) => ({ id: r.id, name: r.name, roster_size: resolve(r).roster.length })),
    ),
    start: vi.fn(async (courseId: number, name: string) =>
      store({ id: 50 + runs.length, courseId, name: name.trim(), classIds: [], studentIds: [] }),
    ),
    get: vi.fn(async (id: number) => resolve(find(id))),
    rename: vi.fn(async (id: number, name: string) => store({ ...find(id), name: name.trim() })),
    enrolClass: vi.fn(async (id: number, classId: number) => {
      const stored = find(id)
      return store({ ...stored, classIds: [...new Set([...stored.classIds, classId])] })
    }),
    unenrolClass: vi.fn(async (id: number, classId: number) => {
      const stored = find(id)
      return store({ ...stored, classIds: stored.classIds.filter((c) => c !== classId) })
    }),
    enrolStudent: vi.fn(async (id: number, studentId: number) => {
      const stored = find(id)
      return store({ ...stored, studentIds: [...new Set([...stored.studentIds, studentId])] })
    }),
    unenrolStudent: vi.fn(async (id: number, studentId: number) => {
      const stored = find(id)
      return store({ ...stored, studentIds: stored.studentIds.filter((s) => s !== studentId) })
    }),
  } satisfies RunsApi
}
