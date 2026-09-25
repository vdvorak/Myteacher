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
  type InterviewBase,
  type InterviewQuestion,
  type Topic,
  type TopicAdditions,
  type TopicInterview,
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
  can_fork: true,
  forked_from_id: null,
  setup: { interview_finished: false, brief_confirmed: false, read_sources: 0, sources_skipped: false },
}

export const noAdditions: TopicAdditions = { goals: null, prior_knowledge: null, emphasis: null, notes: null }

/** A topic with no additions and no diagnostic offer, unless given. */
export const topicFixture = (topic: Pick<Topic, 'id' | 'name' | 'position'> & Partial<Topic>): Topic => ({
  diagnostic_wanted: false,
  additions: noAdditions,
  diagnostic_offer: null,
  concept_map: 'none',
  documents: 0,
  materials: 0,
  ...topic,
})

/** The emails the fake knows as teachers, besides those on an access list. */
export const knownTeachers = ['svoboda@skola.example', 'kralova@skola.example', 'novak@skola.example']

/** What the fake assistant does at each interview step, in order. */
export type ScriptedStep =
  | { round: Omit<InterviewQuestion, 'number'>[] }
  | { brief: Partial<CourseBrief>; sources_offered: boolean; summary: string }
  | { fail: JobFailure; raw_output?: string }

/** What the fake assistant does at each topic interview step, in order. */
export type ScriptedTopicStep =
  | { round: Omit<InterviewQuestion, 'number'>[] }
  | { additions: Partial<TopicAdditions>; summary: string }
  | { fail: JobFailure; raw_output?: string }

const trimmed = (value: string | null) => (value === null ? null : value.trim() || null)
const trimmedAdditions = (additions: Partial<TopicAdditions>) =>
  Object.fromEntries(Object.entries(additions).map(([k, v]) => [k, trimmed(v ?? null)])) as Partial<TopicAdditions>

/** A stand-in for the course endpoints, keeping the courses it was given in memory. */
export function fakeCoursesApi(
  options: {
    courses?: Course[]
    topics?: Record<number, Topic[]>
    interviews?: Record<number, Interview>
    /** Topic interviews by topic id. */
    topicInterviews?: Record<number, TopicInterview>
    access?: Record<number, AccessEntry[]>
    /** The assistant's answers to interview steps, in order. */
    script?: ScriptedStep[]
    /** The assistant's answers to topic interview steps, in order. */
    topicScript?: ScriptedTopicStep[]
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
  const topicInterviews: Record<number, TopicInterview> = structuredClone(options.topicInterviews ?? {})
  const topicScript = [...(options.topicScript ?? [])]
  // The next step of an interview as a job; the scripted step lands when the job ends.
  const scheduleStep = <I extends InterviewBase, S extends ScriptedStep | ScriptedTopicStep>(
    kind: string,
    current: () => I,
    steps: S[],
    finish: (interview: I, step: Exclude<S, { round: unknown } | { fail: unknown }>) => void,
  ) => {
    if (options.hasKey === false) throw new InterviewConflict('no_provider_key')
    const job = jobs.start(kind, () => {
      const interview = current()
      const step = steps.shift()
      if (!step) throw new Error('the fake assistant was asked more often than scripted')
      let outcome: Pick<typeof job, 'state' | 'error_kind' | 'raw_output'>
      if ('fail' in step) {
        outcome = { state: 'failed', error_kind: step.fail, raw_output: step.raw_output ?? null }
      } else {
        outcome = { state: 'succeeded', error_kind: null, raw_output: null }
        if ('round' in step) {
          interview.rounds = [
            ...interview.rounds,
            {
              number: interview.rounds.length + 1,
              questions: step.round.map((q, i) => ({ ...q, number: i + 1 })),
              answers: null,
            },
          ]
        } else {
          finish(interview, step as Exclude<S, { round: unknown } | { fail: unknown }>)
        }
      }
      interview.job = { ...job, ...outcome, progress: null }
      return outcome
    })
    current().job = job
    return { interview: structuredClone(current()), job }
  }
  const schedule = (id: number) =>
    scheduleStep('course_interview', () => interviews[id], script, (interview, step) => {
      if (!('brief' in step)) throw new Error('a course interview ends in a brief')
      const course = find(id)
      store({ ...course, brief: { ...course.brief, ...step.brief } })
      interview.state = 'finished'
      interview.sources_offered = step.sources_offered
      interview.summary = step.summary
    })
  // Told when a topic interview finishes, as the server then proposes the topic's map.
  const topicInterviewListeners: ((id: number, topicId: number) => void)[] = []
  const scheduleTopic = (id: number, topicId: number) =>
    scheduleStep('topic_interview', () => topicInterviews[topicId], topicScript, (interview, step) => {
      if (!('additions' in step)) throw new Error('a topic interview ends in additions')
      const topic = topicOf(id, topicId)
      topic.additions = { ...topic.additions, ...step.additions }
      interview.state = 'finished'
      interview.summary = step.summary
      for (const listener of topicInterviewListeners) listener(id, topicId)
    })
  const topicInterviewOf = (id: number, topicId: number) => {
    topicOf(id, topicId)
    return topicInterviews[topicId] ?? null
  }
  const activeTopicInterview = (id: number, topicId: number) => {
    const current = topicInterviewOf(id, topicId)
    if (!current || current.state !== 'active') throw new InterviewConflict('no_active_interview')
    return current
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
  const topics: Record<number, Topic[]> = structuredClone(options.topics ?? {})
  let nextTopicId = 1000
  function topicsOf(id: number) {
    find(id)
    return topics[id] ?? []
  }
  const storeTopics = (id: number, list: Topic[]) => {
    topics[id] = list.map((topic, position) => ({ ...topic, position }))
    return copies(topics[id])
  }
  // Fresh objects on every answer, as over HTTP: callers may keep and change what they get.
  const copies = (list: Topic[]) => structuredClone(list)
  function topicOf(id: number, topicId: number) {
    const topic = topicsOf(id).find((t) => t.id === topicId)
    if (!topic) throw new ApiError(404)
    return topic
  }
  function find(id: number) {
    const course = courses.find((c) => c.id === id)
    if (!course) throw new ApiError(404)
    return course
  }
  function store(course: Course) {
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
        can_fork: true,
        forked_from_id: null,
        setup: { interview_finished: false, brief_confirmed: false, read_sources: 0, sources_skipped: false },
      }),
    ),
    fork: vi.fn(async (id: number) =>
      structuredClone(
        store({
          ...structuredClone(find(id)),
          id: 100 + courses.length,
          name: `${find(id).name} (copy)`,
          owner_id: 2,
          access: 'owner',
          can_edit: true,
          can_manage_access: true,
          can_fork: true,
          forked_from_id: id,
          setup: { interview_finished: false, brief_confirmed: false, read_sources: 0, sources_skipped: false },
        }),
      ),
    ),
    change: vi.fn(async (id, change) => {
      const { brief_confirmed, sources_skipped, ...basics } = change
      const course = find(id)
      const setup = {
        ...course.setup,
        ...(brief_confirmed === undefined ? {} : { brief_confirmed }),
        ...(sources_skipped === undefined ? {} : { sources_skipped }),
      }
      return store({ ...course, ...basics, setup })
    }),
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
      storeTopics(id, [...topicsOf(id), topicFixture({ id: nextTopicId++, name: name.trim(), position: 0 })]),
    ),
    changeTopic: vi.fn(async (id: number, topicId: number, change) => {
      topicOf(id, topicId)
      const { additions, ...rest } = change
      return storeTopics(
        id,
        topicsOf(id).map((t) =>
          t.id === topicId ? { ...t, ...rest, additions: { ...t.additions, ...trimmedAdditions(additions ?? {}) } } : t,
        ),
      )
    }),
    answerDiagnosticOffer: vi.fn(async (id: number, topicId: number, accept: boolean) => {
      const topic = topicOf(id, topicId)
      if (!topic.diagnostic_offer || topic.diagnostic_offer.answer !== null) throw new ApiError(409)
      topic.diagnostic_offer.answer = accept ? 'accepted' : 'declined'
      if (accept) topic.diagnostic_wanted = true
      return copies(topicsOf(id))
    }),
    topicInterview: vi.fn(async (id: number, topicId: number) => structuredClone(topicInterviewOf(id, topicId))),
    startTopicInterview: vi.fn(async (id: number, topicId: number) => {
      if (topicInterviewOf(id, topicId)?.state === 'active') throw new InterviewConflict('interview_active')
      if (options.hasKey === false) throw new InterviewConflict('no_provider_key')
      topicInterviews[topicId] = { id: 800 + topicId, topic_id: topicId, state: 'active', rounds: [], summary: null, job: null }
      return scheduleTopic(id, topicId)
    }),
    answerTopicInterview: vi.fn(async (id: number, topicId: number, answers: string[]) => {
      const current = activeTopicInterview(id, topicId)
      const last = current.rounds.at(-1)
      if (!last || last.answers !== null) throw new InterviewConflict('no_open_round')
      current.rounds = [...current.rounds.slice(0, -1), { ...last, answers }]
      return scheduleTopic(id, topicId)
    }),
    retryTopicInterview: vi.fn(async (id: number, topicId: number) => {
      const current = activeTopicInterview(id, topicId)
      if (current.job?.state !== 'failed') throw new InterviewConflict('nothing_to_retry')
      return scheduleTopic(id, topicId)
    }),
    endTopicInterview: vi.fn(async (id: number, topicId: number) => {
      const current = activeTopicInterview(id, topicId)
      current.state = 'ended'
      return structuredClone(current)
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
    /** What a finished proposal does to the topic: the assistant's diagnostic offer, if any. */
    whenTopicInterviewFinishes(listener: (id: number, topicId: number) => void) {
      topicInterviewListeners.push(listener)
    },
    offerDiagnostic(id: number, topicId: number, reason: string | null) {
      const topic = topicOf(id, topicId)
      topic.diagnostic_offer = reason && !topic.diagnostic_wanted ? { reason, answer: null } : null
    },
  } satisfies CoursesApi & Record<string, unknown>
}

export type FakeCourses = ReturnType<typeof fakeCoursesApi>
