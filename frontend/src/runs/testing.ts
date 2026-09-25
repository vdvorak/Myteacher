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
  type NewRelease,
  type ReleasableMaterial,
  type Release,
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
    jobs?: FakeJobs
  } = {},
) {
  let runs = options.runs ?? []
  const materials = options.materials ?? []
  const releases: Record<number, Release[]> = { ...options.releases }
  const classes = options.classes ?? [{ id: 1, name: '2.B 2026/27', memberIds: [jana.id] }]
  const students = options.students ?? [jana, petr]
  const jobs = options.jobs ?? fakeJobsApi()
  const results: Record<number, ReleaseResults> = structuredClone(options.results ?? {})
  const studentResults: Record<string, StudentAttempts> = structuredClone(options.studentResults ?? {})
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
    materials: vi.fn(async (id: number) => {
      find(id)
      return materials.map((m) => ({ ...m, versions: [...m.versions], target_student_ids: [...m.target_student_ids] }))
    }),
    releases: vi.fn(async (id: number) => {
      find(id)
      return (releases[id] ?? []).map((r) => ({ ...r, students: [...r.students] }))
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
      const review = reviewsOf(releaseId).find((r) => r.id === assessmentId)
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
      return count
    }),
  } satisfies RunsApi
}
