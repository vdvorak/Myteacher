import { vi } from 'vitest'
import { ApiError } from '../lesson/api'
import type { Student } from '../students/api'
import { jana, petr } from '../students/testing'
import type { Job } from '../jobs/api'
import { fakeJobsApi, type FakeJobs } from '../jobs/testing'
import {
  AssessmentRefused,
  ReleaseRefused,
  type CourseRun,
  type Lobby,
  type NewRun,
  type NewRelease,
  type ReleasableMaterial,
  type Release,
  type ListedRelease,
  type OpenAnswer,
  type ReleaseResults,
  type RunsApi,
  type StudentAttempts,
} from './api'

interface StoredRun {
  id: number
  courseId: number
  name: string
  classIds: number[]
  studentIds: number[]
  /** A link run: how many it takes, the secret of its join link and who joined. */
  link?: {
    capacity: number
    joinToken: string
    /** One device each, unless told otherwise. */
    participants: (Omit<Lobby['participants'][number], 'devices'> & { devices?: number })[]
    closed?: boolean
    erasedAt?: string
  }
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
    /** The releasable material of every run. */
    materials?: ReleasableMaterial[]
    releases?: Record<number, Release[]>
    /** By release id. */
    results?: Record<number, ReleaseResults>
    /** By `${releaseId}:${studentId}`. */
    studentResults?: Record<string, StudentAttempts>
    /** By release id. */
    openAnswers?: Record<number, OpenAnswer[]>
    jobs?: FakeJobs
    /** What the fake takes for now, for due dates. */
    now?: string
  } = {},
) {
  let runs = options.runs ?? []
  const materials = options.materials ?? []
  const releases: Record<number, Release[]> = structuredClone(options.releases ?? {})
  const classes = options.classes ?? [{ id: 1, name: '2.B 2026/27', memberIds: [jana.id] }]
  const students = options.students ?? [jana, petr]
  const jobs = options.jobs ?? fakeJobsApi()
  const results: Record<number, ReleaseResults> = structuredClone(options.results ?? {})
  const studentResults: Record<string, StudentAttempts> = structuredClone(options.studentResults ?? {})
  const openAnswers: Record<number, OpenAnswer[]> = structuredClone(options.openAnswers ?? {})
  const now = new Date(options.now ?? '2026-09-25T12:00:00Z')
  // Like the backend: the flagged first, then those waiting, then the assessed, each by student.
  const rank = (a: OpenAnswer) => (a.review.flagged && a.review.score === null ? 0 : a.review.score === null ? 1 : 2)
  const sorted = (list: OpenAnswer[]) =>
    [...list].sort((a, b) => rank(a) - rank(b) || a.student.name.localeCompare(b.student.name) || a.id - b.id)
  const resultsOf = (releaseId: number) => {
    const found = results[releaseId]
    if (!found) throw new ApiError(404)
    return found
  }
  const reviewsOf = (releaseId: number) =>
    Object.entries(studentResults)
      .filter(([key]) => key.startsWith(`${releaseId}:`))
      .flatMap(([, detail]) => detail.attempts)
      .flatMap((attempt) => Object.values(attempt.first.answers))
      .flatMap((answer) => answer.tries.flatMap((done) => (done.assessment ? [done.assessment] : [])))
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
      mode: stored.link ? 'link' : 'enrolled',
      capacity: stored.link?.capacity ?? null,
      join_token: stored.link?.joinToken ?? null,
      participant_count: stored.link?.participants.length ?? 0,
      participants: (stored.link?.participants ?? []).map(({ id, name }) => ({ id, name })),
      joining_open: !stored.link?.closed,
      participants_erased_at: stored.link?.erasedAt ?? null,
    }
  }
  const store = (next: StoredRun) => {
    runs = [...runs.filter((r) => r.id !== next.id), next]
    return resolve(next)
  }
  const linked = (id: number) => {
    const stored = find(id)
    if (!stored.link) throw new ApiError(404)
    return stored
  }
  const sizeOf = (stored: StoredRun) => stored.link?.participants.length ?? resolve(stored).roster.length
  const enrolled = (id: number) => {
    const stored = find(id)
    // Like the backend: a link run's roster is its participants.
    if (stored.link) throw new ApiError(409)
    return stored
  }
  const api = {
    list: vi.fn(async (courseId: number) =>
      runs
        .filter((r) => r.courseId === courseId)
        .sort(byName)
        .map((r) => ({ id: r.id, name: r.name, roster_size: sizeOf(r), mode: resolve(r).mode })),
    ),
    taught: vi.fn(async () =>
      runs
        .map((r) => {
          const run = resolve(r)
          const latest = (releases[r.id] ?? []).filter((released) => !released.retracted_at).at(-1)
          return {
            id: run.id,
            name: run.name,
            course: run.course,
            roster_size: sizeOf(r),
            mode: run.mode,
            latest_release: latest
              ? {
                  id: latest.id,
                  title: latest.title,
                  released_at: latest.released_at,
                  submitted: (results[latest.id]?.students ?? []).filter((s) => s.in_run && s.state === 'submitted')
                    .length,
                  total: latest.audience === 'chosen' ? latest.students.length : run.roster.length,
                }
              : null,
          }
        })
        .sort((a, b) => a.course.name.localeCompare(b.course.name) || a.name.localeCompare(b.name)),
    ),
    start: vi.fn(async (courseId: number, run: NewRun) =>
      store({
        id: 50 + runs.length,
        courseId,
        name: run.name.trim(),
        classIds: [],
        studentIds: [],
        link:
          run.mode === 'link'
            ? { capacity: run.capacity ?? 30, joinToken: `join-${50 + runs.length}`, participants: [] }
            : undefined,
      }),
    ),
    setJoining: vi.fn(async (id: number, open: boolean) => {
      const stored = linked(id)
      return store({ ...stored, link: { ...stored.link!, closed: !open } })
    }),
    replaceJoinLink: vi.fn(async (id: number) => {
      const stored = linked(id)
      return store({ ...stored, link: { ...stored.link!, joinToken: `${stored.link!.joinToken}-new` } })
    }),
    renameParticipant: vi.fn(async (id: number, participantId: number, name: string) => {
      const found = linked(id).link!.participants.find((p) => p.id === participantId)
      if (!found) throw new ApiError(404)
      found.name = name.trim()
      return { devices: 1, ...found }
    }),
    eraseParticipants: vi.fn(async (id: number) => {
      const stored = linked(id)
      const participants = stored.link!.participants.map((p, index) => ({ ...p, name: `Participant ${index + 1}` }))
      return store({
        ...stored,
        link: { ...stored.link!, participants, closed: true, erasedAt: stored.link!.erasedAt ?? now.toISOString() },
      })
    }),
    removeParticipant: vi.fn(async (id: number, participantId: number) => {
      const link = linked(id).link!
      if (!link.participants.some((p) => p.id === participantId)) throw new ApiError(404)
      link.participants = link.participants.filter((p) => p.id !== participantId)
    }),
    lobby: vi.fn(async (id: number): Promise<Lobby> => {
      const link = find(id).link
      if (!link) throw new ApiError(404)
      const participants = link.participants.map((p) => ({ devices: 1, ...p }))
      return structuredClone({ capacity: link.capacity, participants })
    }),
    get: vi.fn(async (id: number) => resolve(find(id))),
    rename: vi.fn(async (id: number, name: string) => store({ ...find(id), name: name.trim() })),
    enrolClass: vi.fn(async (id: number, classId: number) => {
      const stored = enrolled(id)
      return store({ ...stored, classIds: [...new Set([...stored.classIds, classId])] })
    }),
    unenrolClass: vi.fn(async (id: number, classId: number) => {
      const stored = find(id)
      return store({ ...stored, classIds: stored.classIds.filter((c) => c !== classId) })
    }),
    enrolStudent: vi.fn(async (id: number, studentId: number) => {
      const stored = enrolled(id)
      return store({ ...stored, studentIds: [...new Set([...stored.studentIds, studentId])] })
    }),
    unenrolStudent: vi.fn(async (id: number, studentId: number) => {
      const stored = find(id)
      return store({ ...stored, studentIds: stored.studentIds.filter((s) => s !== studentId) })
    }),
    materials: vi.fn(async (id: number) => {
      find(id)
      return materials.map((m) => ({ ...m, versions: [...m.versions], target_student_ids: [...m.target_student_ids] }))
    }),
    releases: vi.fn(async (id: number): Promise<ListedRelease[]> => {
      const stored = find(id)
      // Like the backend: a link run's releases are for its participants.
      const roster = stored.link?.participants ?? resolve(stored).roster
      return (releases[id] ?? []).map((r) => {
        const recipients = r.audience === 'chosen' ? r.students.map((s) => s.id) : roster.map((s) => s.id)
        const done = (results[r.id]?.students ?? []).filter((s) => s.state === 'submitted').map((s) => s.id)
        const overdue = r.due_at !== null && new Date(r.due_at) < now && !r.retracted_at
        return {
          ...structuredClone(r),
          submitted: recipients.filter((s) => done.includes(s)).length,
          total: recipients.length,
          waiting: results[r.id]?.open_answers.waiting ?? 0,
          overdue_student_ids: overdue ? recipients.filter((s) => !done.includes(s)) : [],
        }
      })
    }),
    materialReleases: vi.fn(async (_courseId: number, _topicId: number, materialId: number) =>
      runs.flatMap((run) =>
        (releases[run.id] ?? [])
          .filter((r) => r.material_id === materialId && !r.retracted_at)
          .map((r) => ({
            run_id: run.id,
            run_name: run.name,
            release_id: r.id,
            version: r.version,
            released_at: r.released_at,
          })),
      ),
    ),
    openAnswers: vi.fn(async (id: number, releaseId: number) => {
      find(id)
      return structuredClone(sorted(openAnswers[releaseId] ?? []))
    }),
    release: vi.fn(async (id: number, release: NewRelease) => {
      const roster = resolve(find(id)).roster
      const material = materials.find((m) => m.id === release.material_id)
      if (!material) throw new ReleaseRefused('unknown_material')
      if (!material.versions.includes(release.version)) throw new ReleaseRefused('unknown_version')
      const chosen = roster.filter((s) => release.student_ids?.includes(s.id))
      if (release.audience === 'chosen' && (chosen.length === 0 || chosen.length !== release.student_ids?.length)) {
        throw new ReleaseRefused('not_in_run')
      }
      const { material_id, version, audience, student_ids: _, ...settings } = release
      const stored: Release = {
        id: 300 + Object.values(releases).flat().length,
        material_id,
        title: material.title,
        topic: material.topic,
        topic_id: 2,
        version,
        audience,
        students: chosen.map(({ id, name }) => ({ id, name })),
        released_by_id: 2,
        released_at: '2026-09-25T08:00:00Z',
        retracted_at: null,
        retraction_reason: null,
        ...settings,
      }
      releases[id] = [...(releases[id] ?? []), stored]
      return { ...stored, students: [...stored.students] }
    }),
    results: vi.fn(async (id: number, releaseId: number) => {
      find(id)
      return structuredClone(resultsOf(releaseId))
    }),
    studentResults: vi.fn(async (id: number, releaseId: number, studentId: number) => {
      find(id)
      const found = studentResults[`${releaseId}:${studentId}`]
      if (!found) throw new ApiError(404)
      return structuredClone(found)
    }),
    // The job assesses every waiting answer when it ends.
    assessOpenAnswers: vi.fn(async (id: number, releaseId: number): Promise<Job> => {
      find(id)
      const open = resultsOf(releaseId).open_answers
      if (open.waiting === 0) throw new AssessmentRefused('nothing_to_assess')
      return jobs.start('open_assessment', () => {
        open.assessed += open.waiting
        open.unpublished += open.waiting
        open.waiting = 0
        return { state: 'succeeded', error_kind: null, raw_output: null }
      })
    }),
    override: vi.fn(async (id: number, releaseId: number, assessmentId: number, score: number, reason: string) => {
      find(id)
      const answer = (openAnswers[releaseId] ?? []).find((a) => a.id === assessmentId)
      if (answer) {
        Object.assign(answer.review, { score, override_score: score, override_reason: reason, published: false })
        answer.student_view = { score, feedback: answer.review.feedback, reason }
      }
      const review = reviewsOf(releaseId).find((r) => r.id === assessmentId) ?? answer?.review
      if (!review) throw new ApiError(404)
      Object.assign(review, { score, override_score: score, override_reason: reason, published: false })
      resultsOf(releaseId).open_answers.unpublished += 1
      return structuredClone(review)
    }),
    retractAttempt: vi.fn(async (id: number, releaseId: number, studentId: number, reason: string) => {
      find(id)
      const detail = studentResults[`${releaseId}:${studentId}`]
      const target = detail?.attempts.find((a) => a.retracted_at === null)
      if (!target) throw new ApiError(409)
      Object.assign(target, { retracted_at: '2026-09-25T09:00:00Z', retraction_reason: reason, counts: false })
    }),
    retractRelease: vi.fn(async (id: number, releaseId: number, reason: string) => {
      const release = (releases[id] ?? []).find((r) => r.id === releaseId)
      if (!release) throw new ApiError(404)
      Object.assign(release, { retracted_at: '2026-09-25T09:00:00Z', retraction_reason: reason })
      const found = results[releaseId]
      if (found) found.release = { ...release }
      return { ...release, students: [...release.students] }
    }),
    publish: vi.fn(async (id: number, releaseId: number) => {
      find(id)
      const open = resultsOf(releaseId).open_answers
      const count = open.unpublished
      open.unpublished = 0
      for (const review of reviewsOf(releaseId)) review.published = true
      for (const answer of openAnswers[releaseId] ?? []) answer.review.published = true
      return count
    }),
  } satisfies RunsApi
  return Object.assign(api, {
    /** Someone joins the link run through its join link, as the join page would. */
    join(id: number, name: string, joinedAt = '2026-09-25T08:05:00Z') {
      const link = find(id).link!
      link.participants.push({ id: 900 + link.participants.length, name, joined_at: joinedAt })
    },
  })
}
