import { vi } from 'vitest'
import { ApiError } from '../lesson/api'
import type { JobFailure } from '../jobs/api'
import { fakeJobsApi, type FakeJobs } from '../jobs/testing'
import {
  AccessConflict,
  InterviewConflict,
  type AccessEntry,
  TypeConflict,
  type CatalogType,
  type Course,
  type CourseBrief,
  type CoursesApi,
  type Interview,
  type InterviewQuestion,
  type Topic,
} from './api'

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
  access: 'owner',
  can_edit: true,
  can_manage_access: true,
}

/** The emails the fake knows as teachers, besides those on an access list. */
export const knownTeachers = ['svoboda@skola.example', 'kralova@skola.example', 'novak@skola.example']

/** What the fake assistant does at each interview step, in order. */
export type ScriptedStep =
  | { round: Omit<InterviewQuestion, 'number'>[] }
  | { brief: Partial<CourseBrief>; sources_offered: boolean; summary: string }
  | { fail: JobFailure; raw_output?: string }

const trimmed = (value: string | null) => (value === null ? null : value.trim() || null)

/** A stand-in for the course endpoints, keeping the courses it was given in memory. */
export function fakeCoursesApi(
  options: {
    courses?: Course[]
    topics?: Record<number, Topic[]>
    interviews?: Record<number, Interview>
    access?: Record<number, AccessEntry[]>
    /** The assistant's answers to interview steps, in order. */
    script?: ScriptedStep[]
    jobs?: FakeJobs
    /** Whether the teacher has a provider key to pay with. */
    hasKey?: boolean
  } = {},
) {
  let courses = options.courses ?? [spanish]
  const interviews: Record<number, Interview> = { ...options.interviews }
  const script = [...(options.script ?? [])]
  const jobs = options.jobs ?? fakeJobsApi()
  const interviewOf = (id: number) => {
    find(id)
    return interviews[id] ?? null
  }
  const activeInterview = (id: number) => {
    const current = interviewOf(id)
    if (!current || current.state !== 'active') throw new InterviewConflict('no_active_interview')
    return current
  }
  // The next step of the interview as a job; the scripted step lands when the job ends.
  const schedule = (id: number) => {
    if (options.hasKey === false) throw new InterviewConflict('no_provider_key')
    const job = jobs.start('course_interview', () => {
      const current = interviews[id]
      const step = script.shift()
      if (!step) throw new Error('the fake assistant was asked more often than scripted')
      let outcome: Pick<typeof job, 'state' | 'error_kind' | 'raw_output'>
      if ('fail' in step) {
        outcome = { state: 'failed', error_kind: step.fail, raw_output: step.raw_output ?? null }
      } else {
        outcome = { state: 'succeeded', error_kind: null, raw_output: null }
        if ('round' in step) {
          current.rounds = [
            ...current.rounds,
            {
              number: current.rounds.length + 1,
              questions: step.round.map((q, i) => ({ ...q, number: i + 1 })),
              answers: null,
            },
          ]
        } else {
          const course = find(id)
          store({ ...course, brief: { ...course.brief, ...step.brief } })
          current.state = 'finished'
          current.sources_offered = step.sources_offered
          current.summary = step.summary
        }
      }
      current.job = { ...job, ...outcome, progress: null }
      return outcome
    })
    interviews[id].job = job
    return { interview: structuredClone(interviews[id]), job }
  }
  const access: Record<number, AccessEntry[]> = { ...options.access }
  const accessOf = (id: number) => {
    find(id)
    return access[id] ?? []
  }
  const storeAccess = (id: number, list: AccessEntry[]) => {
    access[id] = [...list].sort((a, b) => a.email.localeCompare(b.email))
    return access[id].map((entry) => ({ ...entry }))
  }
  const listed = (id: number, teacherId: number) => {
    const entry = accessOf(id).find((e) => e.teacher_id === teacherId)
    if (!entry) throw new ApiError(404)
    return entry
  }
  const teacherId = (email: string) => {
    const known = [...knownTeachers, ...Object.values(access).flat().map((e) => e.email)]
    if (!known.includes(email)) throw new AccessConflict('not_a_teacher')
    return 10 + known.indexOf(email)
  }
  const topics: Record<number, Topic[]> = { ...options.topics }
  let nextTopicId = 1000
  const topicsOf = (id: number) => {
    find(id)
    return topics[id] ?? []
  }
  const storeTopics = (id: number, list: Topic[]) => {
    topics[id] = list.map((topic, position) => ({ ...topic, position }))
    return copies(topics[id])
  }
  // Fresh objects on every answer, as over HTTP: callers may keep and change what they get.
  const copies = (list: Topic[]) => list.map((topic) => ({ ...topic }))
  const topicOf = (id: number, topicId: number) => {
    const topic = topicsOf(id).find((t) => t.id === topicId)
    if (!topic) throw new ApiError(404)
    return topic
  }
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
        .map(({ id, name, subject, taught_language, instruction_language, access }) => ({
          id,
          name,
          subject,
          taught_language,
          instruction_language,
          access,
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
        access: 'owner',
        can_edit: true,
        can_manage_access: true,
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
    topics: vi.fn(async (id: number) => copies(topicsOf(id))),
    interview: vi.fn(async (id: number) => structuredClone(interviewOf(id))),
    startInterview: vi.fn(async (id: number) => {
      if (interviewOf(id)?.state === 'active') throw new InterviewConflict('interview_active')
      if (options.hasKey === false) throw new InterviewConflict('no_provider_key')
      interviews[id] = { id: 700 + id, state: 'active', rounds: [], sources_offered: null, summary: null, job: null }
      return schedule(id)
    }),
    answerInterview: vi.fn(async (id: number, answers: string[]) => {
      const current = activeInterview(id)
      const last = current.rounds.at(-1)
      if (!last || last.answers !== null) throw new InterviewConflict('no_open_round')
      current.rounds = [...current.rounds.slice(0, -1), { ...last, answers }]
      return schedule(id)
    }),
    retryInterview: vi.fn(async (id: number) => {
      const current = activeInterview(id)
      if (current.job?.state !== 'failed') throw new InterviewConflict('nothing_to_retry')
      return schedule(id)
    }),
    endInterview: vi.fn(async (id: number) => {
      const current = activeInterview(id)
      current.state = 'ended'
      return structuredClone(current)
    }),
    access: vi.fn(async (id: number) => storeAccess(id, accessOf(id))),
    grantAccess: vi.fn(async (id: number, email: string, right) => {
      const trimmed = email.trim().toLowerCase()
      const existing = accessOf(id).find((e) => e.email === trimmed)
      const entry = { teacher_id: existing?.teacher_id ?? teacherId(trimmed), email: trimmed, right }
      return storeAccess(id, [...accessOf(id).filter((e) => e.email !== trimmed), entry])
    }),
    changeAccess: vi.fn(async (id: number, teacherId: number, right) => {
      listed(id, teacherId)
      return storeAccess(
        id,
        accessOf(id).map((e) => (e.teacher_id === teacherId ? { ...e, right } : e)),
      )
    }),
    removeAccess: vi.fn(async (id: number, teacherId: number) => {
      listed(id, teacherId)
      return storeAccess(id, accessOf(id).filter((e) => e.teacher_id !== teacherId))
    }),
    transferOwnership: vi.fn(async (id: number, email: string, previousOwnerKeeps) => {
      const course = find(id)
      const newOwner = teacherId(email.trim().toLowerCase())
      storeAccess(id, accessOf(id).filter((e) => e.teacher_id !== newOwner))
      if (previousOwnerKeeps === null) {
        courses = courses.filter((c) => c.id !== id)
      } else {
        store({
          ...course,
          owner_id: newOwner,
          access: previousOwnerKeeps,
          can_edit: previousOwnerKeeps === 'edit',
          can_manage_access: false,
        })
      }
    }),
    addTopic: vi.fn(async (id: number, name: string) =>
      storeTopics(id, [...topicsOf(id), { id: nextTopicId++, name: name.trim(), position: 0, diagnostic_wanted: false }]),
    ),
    changeTopic: vi.fn(async (id: number, topicId: number, change) => {
      topicOf(id, topicId)
      return storeTopics(
        id,
        topicsOf(id).map((t) => (t.id === topicId ? { ...t, ...change } : t)),
      )
    }),
    reorderTopics: vi.fn(async (id: number, topicIds: number[]) => {
      const current = topicsOf(id)
      if (topicIds.length !== current.length || current.some((t) => !topicIds.includes(t.id))) {
        throw new ApiError(409)
      }
      return storeTopics(id, topicIds.map((topicId) => topicOf(id, topicId)))
    }),
    removeTopic: vi.fn(async (id: number, topicId: number) => {
      topicOf(id, topicId)
      return storeTopics(id, topicsOf(id).filter((t) => t.id !== topicId))
    }),
  } satisfies CoursesApi
}
