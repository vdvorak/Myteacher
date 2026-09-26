import { vi } from 'vitest'
import type { AnswerKey, LessonPublic } from '../generated/lesson'
import type { JobFailure } from '../jobs/api'
import { fakeJobsApi, type FakeJobs } from '../jobs/testing'
import { ApiError } from '../lesson/api'
import { sampleLesson } from '../lesson/testing'
import type { SourcesApi } from '../sources/api'
import { MaterialRefused, type Material, type MaterialsApi } from './api'

/** What the fake assistant writes: a lesson with its answer key, or why it failed. */
export type ScriptedMaterial =
  | { lesson: LessonPublic; answer_key: AnswerKey; proposed_answers?: string[] }
  | { fail: JobFailure }

export const serEstarKey: AnswerKey = {
  lesson_id: sampleLesson.id,
  entries: [
    {
      exercise_id: 'location',
      solution: { type: 'multiple_choice', option_id: 'esta', explanation: 'Location takes **estar**.' },
    },
  ],
}

export const written: ScriptedMaterial = { lesson: sampleLesson, answer_key: serEstarKey }

export const serEstarMaterial: Material = {
  id: 41,
  title: sampleLesson.title,
  version: 1,
  created_at: '2026-09-24T08:00:00Z',
  reviewed: false,
  job: null,
  target_student_ids: [],
  source_id: null,
  key_source_id: null,
  lesson: sampleLesson,
  answer_key: serEstarKey,
  proposed_answers: [],
  versions: [{ number: 1, instruction: null, previous: null, generated: true, created_at: '2026-09-24T08:00:00Z' }],
}

/** A stand-in for the classroom material endpoints, keyed by topic. */
export function fakeMaterialsApi(
  options: {
    materials?: Record<number, Material[]>
    script?: ScriptedMaterial[]
    jobs?: FakeJobs
    hasKey?: boolean
    /** Topics whose concept map is not approved. */
    unapproved?: number[]
    /** The course's sources: a transcription waits while the ones without text are read. */
    sources?: Pick<SourcesApi, 'get'>
  } = {},
) {
  const jobs = options.jobs ?? fakeJobsApi()
  const stored: Record<number, Material[]> = structuredClone(options.materials ?? {})
  const script = [...(options.script ?? [])]
  let nextId = 100
  const listOf = (topicId: number) => (stored[topicId] ??= [])
  const find = (topicId: number, materialId: number) => {
    const material = listOf(topicId).find((m) => m.id === materialId)
    if (!material) throw new ApiError(404)
    return material
  }
  const summary = ({ lesson: _l, answer_key: _a, versions: _v, ...rest }: Material) => structuredClone(rest)
  const busy = (material: Material) => material.job?.state === 'queued' || material.job?.state === 'running'
  // A generation as a job; the scripted material lands as a new version when the job ends.
  // What each material's first version was asked for with, for retrying it.
  const firstInstructions = new Map<number, string | null>()
  const fresh = (targetStudentIds: number[]): Material => ({
    id: nextId++,
    title: null,
    version: null,
    created_at: '2026-09-24T08:00:00Z',
    reviewed: false,
    job: null,
    target_student_ids: [...new Set(targetStudentIds)].sort((a, b) => a - b),
    source_id: null,
    key_source_id: null,
    lesson: null,
    answer_key: null,
    proposed_answers: [],
    versions: [],
  })
  const schedule = (material: Material, instruction: string | null, reading = false) => {
    if (options.hasKey === false) throw new MaterialRefused('no_provider_key')
    const job = jobs.start(
      'classroom_material',
      () => {
        const step = script.shift()
        if (!step) throw new Error('the fake assistant was asked more often than scripted')
        if ('fail' in step) {
          material.job = { ...job, state: 'failed', error_kind: step.fail, progress: null }
          return { state: 'failed', error_kind: step.fail, raw_output: null }
        }
        const number = (material.version ?? 0) + 1
        Object.assign(material, {
          title: step.lesson.title,
          version: number,
          lesson: step.lesson,
          answer_key: step.answer_key,
          proposed_answers: step.proposed_answers ?? [],
          job: null,
          // A new generated version is a draft again.
          reviewed: false,
        })
        material.versions.push({
          number,
          instruction,
          previous: number > 1 ? number - 1 : null,
          generated: true,
          created_at: '2026-09-24T09:00:00Z',
        })
        return { state: 'succeeded', error_kind: null, raw_output: null }
      },
      'asking_assistant',
      reading ? 'extracting' : 'waiting',
    )
    material.job = job
    return { material: summary(material), job }
  }
  const unread = async (courseId: number, sourceId: number | null) =>
    sourceId !== null && options.sources !== undefined && (await options.sources.get(courseId, sourceId)).characters === null

  return {
    list: vi.fn(async (_courseId: number, topicId: number) => listOf(topicId).map(summary)),
    get: vi.fn(async (_courseId: number, topicId: number, materialId: number) =>
      structuredClone(find(topicId, materialId)),
    ),
    generate: vi.fn(
      async (_courseId: number, topicId: number, targetStudentIds: number[], instruction: string | null) => {
        if (options.unapproved?.includes(topicId)) throw new MaterialRefused('map_not_approved')
        if (options.hasKey === false) throw new MaterialRefused('no_provider_key')
        const material = fresh(targetStudentIds)
        listOf(topicId).push(material)
        const asked = instruction?.trim() || null
        firstInstructions.set(material.id, asked)
        return schedule(material, asked)
      },
    ),
    transcribe: vi.fn(
      async (
        courseId: number,
        topicId: number,
        sourceId: number,
        keySourceId: number | null,
        targetStudentIds: number[],
      ) => {
        if (options.hasKey === false) throw new MaterialRefused('no_provider_key')
        const material = { ...fresh(targetStudentIds), source_id: sourceId, key_source_id: keySourceId }
        listOf(topicId).push(material)
        firstInstructions.set(material.id, null)
        const reading = (await unread(courseId, sourceId)) || (await unread(courseId, keySourceId))
        return schedule(material, null, reading)
      },
    ),
    retry: vi.fn(async (_courseId: number, topicId: number, materialId: number) => {
      const material = find(topicId, materialId)
      if (material.version !== null || material.job?.state !== 'failed') throw new MaterialRefused('nothing_to_retry')
      return schedule(material, firstInstructions.get(materialId) ?? null)
    }),
    regenerate: vi.fn(
      async (_courseId: number, topicId: number, materialId: number, instruction: string, basedOn: number) => {
        const material = find(topicId, materialId)
        if (busy(material)) throw new MaterialRefused('generation_running')
        if (material.version !== basedOn) throw new MaterialRefused('material_changed')
        return schedule(material, instruction.trim())
      },
    ),
    setTargets: vi.fn(async (_courseId: number, topicId: number, materialId: number, studentIds: number[]) => {
      const material = find(topicId, materialId)
      material.target_student_ids = [...new Set(studentIds)].sort((a, b) => a - b)
      return structuredClone(material)
    }),
    keep: vi.fn(async (_courseId: number, topicId: number, materialId: number) => {
      const material = find(topicId, materialId)
      // Moving on from a failed rework forgets it.
      if (material.job?.state === 'failed') material.job = null
      material.reviewed = true
    }),
    discard: vi.fn(async (_courseId: number, topicId: number, materialId: number) => {
      find(topicId, materialId)
      stored[topicId] = listOf(topicId).filter((m) => m.id !== materialId)
    }),
    lessonApi: vi.fn((_courseId: number, _topicId: number, _materialId: number) => ({
      assess: vi.fn(async (exerciseId: string) => ({
        status: 'assessed' as const,
        exercise_id: exerciseId,
        score: 1,
        correct: true,
        solution: null,
      })),
      secondRound: vi.fn(async () => ({ exercises: [] })),
    })),
  } satisfies MaterialsApi
}
