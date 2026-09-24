import { vi } from 'vitest'
import { ApiError } from '../lesson/api'
import { TypeConflict, type CatalogType, type Course, type CourseBrief, type CoursesApi } from './api'

export const emptyBrief: CourseBrief = {
  audience: null,
  level: null,
  goals: null,
  timeframe: null,
  preferred_exercise_types: [],
  forbidden_exercise_types: [],
  tone: null,
  feedback_mode: 'immediate',
  retry_with_hint: true,
  second_round: true,
  notes: null,
}

export const spanish: Course = {
  id: 1,
  name: 'Španělština 2.B',
  subject: 'Spanish',
  taught_language: 'es',
  instruction_language: 'cs',
  owner_id: 2,
  created_at: '2026-09-24T08:00:00Z',
  brief: { ...emptyBrief, level: 'A2', preferred_exercise_types: ['cloze'] },
}

const trimmed = (value: string | null) => (value === null ? null : value.trim() || null)

/** A stand-in for the course endpoints, keeping the courses it was given in memory. */
export function fakeCoursesApi(options: { courses?: Course[] } = {}) {
  let courses = options.courses ?? [spanish]
  const find = (id: number) => {
    const course = courses.find((c) => c.id === id)
    if (!course) throw new ApiError(404)
    return course
  }
  const store = (course: Course) => {
    courses = [...courses.filter((c) => c.id !== course.id), course]
    return course
  }
  return {
    list: vi.fn(async () =>
      [...courses]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ id, name, subject, taught_language, instruction_language }) => ({
          id,
          name,
          subject,
          taught_language,
          instruction_language,
        })),
    ),
    get: vi.fn(async (id: number) => find(id)),
    create: vi.fn(async (basics) =>
      store({
        ...basics,
        name: basics.name.trim(),
        subject: basics.subject.trim(),
        id: 100 + courses.length,
        owner_id: 2,
        created_at: '2026-09-24T08:00:00Z',
        brief: emptyBrief,
      }),
    ),
    change: vi.fn(async (id, change) => store({ ...find(id), ...change })),
    changeBrief: vi.fn(async (id, change) => {
      const course = find(id)
      const brief = { ...course.brief, ...change }
      for (const key of ['audience', 'level', 'goals', 'timeframe', 'tone', 'notes'] as const) {
        brief[key] = trimmed(brief[key])
      }
      if (brief.preferred_exercise_types.some((type: CatalogType) => brief.forbidden_exercise_types.includes(type))) {
        throw new TypeConflict()
      }
      store({ ...course, brief })
      return brief
    }),
  } satisfies CoursesApi
}
