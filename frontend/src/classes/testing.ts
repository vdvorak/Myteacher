import { vi } from 'vitest'
import { ApiError } from '../lesson/api'
import type { Student } from '../students/api'
import { jana, petr } from '../students/testing'
import { NameTaken, type ClassesApi, type SchoolClass } from './api'

interface Stored {
  id: number
  name: string
  memberIds: number[]
}

/** A stand-in for the classes endpoints over the given students, resolving members on each read. */
export function fakeClassesApi(
  options: { classes?: Stored[]; students?: Student[] } = {},
) {
  let classes = options.classes ?? [{ id: 1, name: '2.B 2026/27', memberIds: [jana.id] }]
  const students = options.students ?? [jana, petr]
  const find = (id: number) => {
    const stored = classes.find((c) => c.id === id)
    if (!stored) throw new ApiError(404)
    return stored
  }
  const resolve = (stored: Stored): SchoolClass => ({
    id: stored.id,
    name: stored.name,
    members: students
      .filter((s) => stored.memberIds.includes(s.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ id, name, email, state }) => ({ id, name, email, state })),
  })
  const store = (next: Stored) => {
    classes = [...classes.filter((c) => c.id !== next.id), next]
    return resolve(next)
  }
  const nameTaken = (name: string, id?: number) => classes.some((c) => c.id !== id && c.name === name.trim())
  return {
    list: vi.fn(async () =>
      [...classes]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ id: c.id, name: c.name, member_count: c.memberIds.length })),
    ),
    get: vi.fn(async (id: number) => resolve(find(id))),
    create: vi.fn(async (name: string) => {
      if (nameTaken(name)) throw new NameTaken()
      return store({ id: 100 + classes.length, name: name.trim(), memberIds: [] })
    }),
    rename: vi.fn(async (id: number, name: string) => {
      if (nameTaken(name, id)) throw new NameTaken()
      return store({ ...find(id), name: name.trim() })
    }),
    addMember: vi.fn(async (id: number, studentId: number) => {
      const stored = find(id)
      return store({ ...stored, memberIds: [...new Set([...stored.memberIds, studentId])] })
    }),
    removeMember: vi.fn(async (id: number, studentId: number) => {
      const stored = find(id)
      return store({ ...stored, memberIds: stored.memberIds.filter((m) => m !== studentId) })
    }),
  } satisfies ClassesApi
}
