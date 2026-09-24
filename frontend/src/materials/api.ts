import type { AnswerKey, LessonPublic, SecondRound, SecondRoundRequest } from '../generated/lesson'
import type { Job } from '../jobs/api'
import { ApiError } from '../lesson/api'
import type { LessonApi } from '../lesson/LessonPlayer'
import type { AssessmentOutcome, TryOutcome } from '../lesson/schema'

export interface MaterialSummary {
  id: number
  /** Of the latest version; null until the first one was generated. */
  title: string | null
  version: number | null
  created_at: string
  /** The latest generation job, until its result landed. */
  job: Job | null
  /** Stored for planning; they do not change what is generated yet. */
  target_student_ids: number[]
}

export interface MaterialVersion {
  number: number
  /** The instruction it was regenerated with. */
  instruction: string | null
  /** The number of the version it came from. */
  previous: number | null
  /** False for the teacher's edits. */
  generated: boolean
  created_at: string
}

export interface Material extends MaterialSummary {
  /** The latest version as it reaches the page, without solutions. */
  lesson: LessonPublic | null
  answer_key: AnswerKey | null
  versions: MaterialVersion[]
}

export interface MaterialStarted {
  material: MaterialSummary
  job: Job
}

export type MaterialRefusal =
  | 'map_not_approved'
  | 'no_provider_key'
  | 'nothing_to_retry'
  | 'generation_running'
  /** A newer version was saved since the one the teacher saw. */
  | 'material_changed'
  | 'unknown_student'

/** A generation or a change was refused; `reason` says why. */
export class MaterialRefused extends Error {
  readonly reason: MaterialRefusal

  constructor(reason: MaterialRefusal) {
    super(reason)
    this.reason = reason
  }
}

export interface MaterialsApi {
  /** The topic's material, without its content. */
  list(courseId: number, topicId: number): Promise<MaterialSummary[]>
  get(courseId: number, topicId: number, materialId: number): Promise<Material>
  /** Needs the topic's concept map approved; the content lands when the job ends. */
  generate(courseId: number, topicId: number, targetStudentIds: number[]): Promise<MaterialStarted>
  retry(courseId: number, topicId: number, materialId: number): Promise<MaterialStarted>
  /** Reworks version `basedOn` by the instruction into a new version; recorded as a reaction. */
  regenerate(
    courseId: number,
    topicId: number,
    materialId: number,
    instruction: string,
    basedOn: number,
  ): Promise<MaterialStarted>
  setTargets(courseId: number, topicId: number, materialId: number, studentIds: number[]): Promise<Material>
  /** Records that the teacher keeps the material as it is. */
  keep(courseId: number, topicId: number, materialId: number): Promise<void>
  /** Removes the material; the discard is recorded against the generation. */
  discard(courseId: number, topicId: number, materialId: number): Promise<void>
  /** Assesses answers on the preview against the latest version, as in class. */
  lessonApi(courseId: number, topicId: number, materialId: number): LessonApi
}

const refusals: ReadonlySet<string> = new Set<MaterialRefusal>([
  'map_not_approved',
  'no_provider_key',
  'nothing_to_retry',
  'generation_running',
  'material_changed',
  'unknown_student',
])

async function checked(response: Response): Promise<Response> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: unknown } | null
    if (typeof body?.detail === 'string' && refusals.has(body.detail)) {
      throw new MaterialRefused(body.detail as MaterialRefusal)
    }
    throw new ApiError(response.status)
  }
  return response
}

const json = async <T>(response: Response): Promise<T> => (await (await checked(response)).json()) as T

function send(method: string, url: string, body?: unknown) {
  return fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const materialsUrl = (courseId: number, topicId: number) =>
  `/api/courses/${courseId}/topics/${topicId}/classroom-materials`
const materialUrl = (courseId: number, topicId: number, materialId: number) =>
  `${materialsUrl(courseId, topicId)}/${materialId}`

export const httpMaterialsApi: MaterialsApi = {
  list: async (courseId, topicId) => json(await fetch(materialsUrl(courseId, topicId))),
  get: async (courseId, topicId, materialId) => json(await fetch(materialUrl(courseId, topicId, materialId))),
  generate: async (courseId, topicId, targetStudentIds) =>
    json(await send('POST', materialsUrl(courseId, topicId), { target_student_ids: targetStudentIds })),
  retry: async (courseId, topicId, materialId) =>
    json(await send('POST', `${materialUrl(courseId, topicId, materialId)}/retry`)),
  regenerate: async (courseId, topicId, materialId, instruction, basedOn) =>
    json(
      await send('POST', `${materialUrl(courseId, topicId, materialId)}/regeneration`, {
        instruction,
        based_on: basedOn,
      }),
    ),
  setTargets: async (courseId, topicId, materialId, studentIds) =>
    json(await send('PUT', `${materialUrl(courseId, topicId, materialId)}/targets`, { student_ids: studentIds })),
  keep: async (courseId, topicId, materialId) => {
    await checked(await send('POST', `${materialUrl(courseId, topicId, materialId)}/reactions`, { kind: 'kept' }))
  },
  discard: async (courseId, topicId, materialId) => {
    await checked(await send('DELETE', materialUrl(courseId, topicId, materialId)))
  },
  lessonApi: (courseId, topicId, materialId) => {
    const url = materialUrl(courseId, topicId, materialId)
    return {
      assess: async (exerciseId, answer, { reveal }): Promise<TryOutcome> => {
        const outcome = await json<AssessmentOutcome>(
          await send('POST', `${url}/exercises/${encodeURIComponent(exerciseId)}/assessment?reveal=${reveal}`, answer),
        )
        // The player only runs types that are assessed or awaited, so this is a contract breach.
        if (outcome.status === 'unavailable') throw new Error(`no assessor for exercise ${exerciseId}`)
        return outcome
      },
      secondRound: async (failedExerciseIds, seed): Promise<SecondRound> =>
        json(
          await send('POST', `${url}/second-round`, {
            failed_exercise_ids: failedExerciseIds,
            seed,
          } satisfies SecondRoundRequest),
        ),
    }
  },
}
