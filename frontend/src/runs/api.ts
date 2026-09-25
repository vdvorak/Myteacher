import type { AssessmentReview, Attempt } from '../attempts/api'
import type { Job } from '../jobs/api'
import type { ClassSummary } from '../classes/api'
import type { FeedbackMode } from '../courses/api'
import { ApiError } from '../lesson/api'
import type { Student } from '../students/api'

export interface RunSummary {
  id: number
  name: string
  roster_size: number
}

/** A run the teacher teaches, as listed across courses. */
export interface TaughtRun {
  id: number
  name: string
  course: { id: number; name: string }
  roster_size: number
  /** The last release not retracted; null before the first. */
  latest_release: { id: number; title: string; released_at: string } | null
}

export type EnrolledStudent = Pick<Student, 'id' | 'name' | 'email' | 'state'>

export interface RosterStudent {
  id: number
  name: string
  email: string
  /** Enrolled on their own, not only through a class. */
  direct: boolean
  /** The enrolled classes they are in, by name. */
  classes: string[]
}

export interface CourseRun {
  id: number
  name: string
  course: { id: number; name: string }
  teacher_id: number
  created_at: string
  classes: ClassSummary[]
  /** The students enrolled directly, whatever the state of their account. */
  students: EnrolledStudent[]
  /** Every student of the run now, without deactivated students or minors awaiting consent. */
  roster: RosterStudent[]
}

export interface ReleasableMaterial {
  id: number
  topic: string
  /** Of the latest version. */
  title: string
  /** The version numbers, newest first. */
  versions: number[]
  /** The students the material was made for, to preselect. */
  target_student_ids: number[]
}

export interface ReleaseSettings {
  feedback_mode: FeedbackMode
  /** ISO time with its zone; null for no due date. */
  due_at: string | null
  /** After the due date: accept and mark late, or refuse. */
  late_submissions: 'accept' | 'refuse'
  /** One attempt, or repeated ones where the last submitted counts. */
  attempts: 'one' | 'repeated'
  show_solutions: boolean
}

export const defaultSettings: ReleaseSettings = {
  feedback_mode: 'immediate',
  due_at: null,
  late_submissions: 'accept',
  attempts: 'one',
  show_solutions: true,
}

export interface NewRelease extends ReleaseSettings {
  material_id: number
  version: number
  /** The whole roster, including students who join later, or the chosen students of it. */
  audience: 'run' | 'chosen'
  student_ids: number[] | null
}

export interface Release extends ReleaseSettings {
  id: number
  material_id: number
  /** Of the released version. */
  title: string
  topic: string
  version: number
  audience: 'run' | 'chosen'
  /** The chosen students; empty for a release to the whole run. */
  students: { id: number; name: string }[]
  released_by_id: number
  released_at: string
  /** Set once the teacher retracted it, with the reason the students were told. */
  retracted_at: string | null
  retraction_reason: string | null
}

/** How an exercise went in the attempt that counts. */
export type ResultCell = 'right' | 'wrong' | 'open' | 'unanswered'

export interface ExerciseSummary {
  id: string
  type: string
  /** The exercise's prompt, or a translation's source text. */
  prompt: string | null
  /** How many counted attempts got it right, wrong, left it waiting for the teacher or empty. */
  right: number
  wrong: number
  open: number
  unanswered: number
}

export interface StudentResult {
  id: number
  name: string
  /** Still one of the release's recipients. */
  in_run: boolean
  state: 'not_started' | 'in_progress' | 'submitted'
  /** The attempt that counts was submitted late. */
  late: boolean
  attempts: number
  /** By exercise id, from the attempt that counts; empty without one. */
  cells: Record<string, ResultCell>
}

export interface OpenAnswers {
  /** Open answers of submitted attempts not assessed yet, flagged ones included. */
  waiting: number
  assessed: number
  /** The assistant's output did not fit; the teacher assesses them. */
  flagged: number
  /** Assessments and overrides the students have not been shown yet. */
  unpublished: number
}

export interface ReleaseResults {
  release: Release
  open_answers: OpenAnswers
  /** The first pass's exercises in lesson order. */
  exercises: ExerciseSummary[]
  students: StudentResult[]
}

export interface StudentAttempts {
  student: { id: number; name: string; in_run: boolean }
  /** The latest first, each with every assessment and its solution. */
  attempts: (Attempt & { counts: boolean; retracted_at: string | null; retraction_reason: string | null })[]
}

export type AssessmentRefusal = 'no_provider_key' | 'nothing_to_assess' | 'assessment_running'

/** Assessing the open answers was refused; `reason` says why. */
export class AssessmentRefused extends Error {
  readonly reason: AssessmentRefusal

  constructor(reason: AssessmentRefusal) {
    super(reason)
    this.reason = reason
  }
}

const assessmentRefusals: AssessmentRefusal[] = ['no_provider_key', 'nothing_to_assess', 'assessment_running']

export type ReleaseRefusal = 'unknown_material' | 'unknown_version' | 'not_in_run' | 'due_in_the_past'

/** A release was refused; `reason` says why. */
export class ReleaseRefused extends Error {
  readonly reason: ReleaseRefusal

  constructor(reason: ReleaseRefusal) {
    super(reason)
    this.reason = reason
  }
}

const refusals: ReleaseRefusal[] = ['unknown_material', 'unknown_version', 'not_in_run', 'due_in_the_past']

async function released(response: Response): Promise<Release> {
  if (response.status === 422) {
    const { detail } = (await response.clone().json()) as { detail: unknown }
    if (refusals.includes(detail as ReleaseRefusal)) throw new ReleaseRefused(detail as ReleaseRefusal)
  }
  return json(response)
}

export interface RunsApi {
  list(courseId: number): Promise<RunSummary[]>
  /** Every run the teacher teaches, across courses. */
  taught(): Promise<TaughtRun[]>
  start(courseId: number, name: string): Promise<CourseRun>
  get(id: number): Promise<CourseRun>
  rename(id: number, name: string): Promise<CourseRun>
  enrolClass(id: number, classId: number): Promise<CourseRun>
  unenrolClass(id: number, classId: number): Promise<CourseRun>
  enrolStudent(id: number, studentId: number): Promise<CourseRun>
  unenrolStudent(id: number, studentId: number): Promise<CourseRun>
  /** The classroom material of the run's course that can be released, in topic order. */
  materials(id: number): Promise<ReleasableMaterial[]>
  releases(id: number): Promise<Release[]>
  release(id: number, release: NewRelease): Promise<Release>
  /** The run teacher's view of a release: students × exercises from the attempts that count. */
  results(id: number, releaseId: number): Promise<ReleaseResults>
  studentResults(id: number, releaseId: number, studentId: number): Promise<StudentAttempts>
  /** Starts a job assessing every submitted open answer not assessed yet, on the run teacher's key. */
  assessOpenAnswers(id: number, releaseId: number): Promise<Job>
  /** Scores any assessment of the release with a reason; students see it once published. */
  override(id: number, releaseId: number, assessmentId: number, score: number, reason: string): Promise<AssessmentReview>
  /** Shows the students what they have not seen yet; says how many assessments that was. */
  publish(id: number, releaseId: number): Promise<number>
  /** Voids the student's attempt being worked on, or else the one that counts; they may start again. */
  retractAttempt(id: number, releaseId: number, studentId: number, reason: string): Promise<void>
  /** Takes the release from its students and voids every attempt; the answers stay with the teacher. */
  retractRelease(id: number, releaseId: number, reason: string): Promise<Release>
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new ApiError(response.status)
  return (await response.json()) as T
}

function send(method: string, url: string, body?: unknown) {
  return fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const classUrl = (id: number, classId: number) => `/api/runs/${id}/classes/${classId}`
const studentUrl = (id: number, studentId: number) => `/api/runs/${id}/students/${studentId}`

export const httpRunsApi: RunsApi = {
  list: async (courseId) => json(await fetch(`/api/courses/${courseId}/runs`)),
  taught: async () => json(await fetch('/api/runs')),
  start: async (courseId, name) => json(await send('POST', `/api/courses/${courseId}/runs`, { name })),
  get: async (id) => json(await fetch(`/api/runs/${id}`)),
  rename: async (id, name) => json(await send('PATCH', `/api/runs/${id}`, { name })),
  enrolClass: async (id, classId) => json(await send('PUT', classUrl(id, classId))),
  unenrolClass: async (id, classId) => json(await send('DELETE', classUrl(id, classId))),
  enrolStudent: async (id, studentId) => json(await send('PUT', studentUrl(id, studentId))),
  unenrolStudent: async (id, studentId) => json(await send('DELETE', studentUrl(id, studentId))),
  materials: async (id) => json(await fetch(`/api/runs/${id}/materials`)),
  releases: async (id) => json(await fetch(`/api/runs/${id}/releases`)),
  release: async (id, release) => released(await send('POST', `/api/runs/${id}/releases`, release)),
  results: async (id, releaseId) => json(await fetch(`/api/runs/${id}/releases/${releaseId}/results`)),
  studentResults: async (id, releaseId, studentId) =>
    json(await fetch(`/api/runs/${id}/releases/${releaseId}/results/${studentId}`)),
  assessOpenAnswers: async (id, releaseId) => {
    const response = await send('POST', `/api/runs/${id}/releases/${releaseId}/open-assessment`)
    if (response.status === 409) {
      const { detail } = (await response.clone().json()) as { detail: unknown }
      if (assessmentRefusals.includes(detail as AssessmentRefusal)) {
        throw new AssessmentRefused(detail as AssessmentRefusal)
      }
    }
    return (await json<{ job: Job }>(response)).job
  },
  override: async (id, releaseId, assessmentId, score, reason) =>
    json(
      await send('PUT', `/api/runs/${id}/releases/${releaseId}/assessments/${assessmentId}/override`, { score, reason }),
    ),
  retractAttempt: async (id, releaseId, studentId, reason) => {
    const response = await send('POST', `/api/runs/${id}/releases/${releaseId}/students/${studentId}/retraction`, {
      reason,
    })
    if (!response.ok) throw new ApiError(response.status)
  },
  retractRelease: async (id, releaseId, reason) =>
    json(await send('POST', `/api/runs/${id}/releases/${releaseId}/retraction`, { reason })),
  publish: async (id, releaseId) =>
    (await json<{ published: number }>(await send('POST', `/api/runs/${id}/releases/${releaseId}/publication`)))
      .published,
}
