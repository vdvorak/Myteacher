import { vi } from 'vitest'
import type { AnswerKey, LessonPublic } from '../generated/lesson'
import type { JobFailure } from '../jobs/api'
import { fakeJobsApi, type FakeJobs } from '../jobs/testing'
import { ApiError } from '../lesson/api'
import { sampleLesson } from '../lesson/testing'
import type { SourcesApi } from '../sources/api'
import { MaterialRefused, type Material, type MaterialsApi, type Transcription } from './api'

/** The pages written as the server reads them, in order and each once; null for the whole file. */
function parsedPages(written: string | null): number[] | null {
  if (written === null || written.trim() === '') return null
  const pages = new Set<number>()
  for (const part of written.replace(/–/g, '-').split(',')) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part.trim())
    if (!match) throw new MaterialRefused('bad_pages')
    const [first, last] = [Number(match[1]), Number(match[2] ?? match[1])]
    if (last < first) throw new MaterialRefused('bad_pages')
    for (let page = first; page <= last; page++) pages.add(page)
  }
  return [...pages].sort((a, b) => a - b)
}

/** A transcription as the forms ask for it, for the whole class: whole files, or the pages written. */
export const transcription = (
  source_id: number,
  key_source_id: number | null,
  pages: Partial<Pick<Transcription, 'source_pages' | 'key_pages'>> = {},
): Transcription => ({
  source_id,
  key_source_id,
  target_student_ids: [],
  source_pages: null,
  key_pages: null,
  ...pages,
})

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
  source_pages: null,
  key_pages: null,
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
    source_pages: null,
    key_pages: null,
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
    transcribe: vi.fn(async (courseId: number, topicId: number, transcription: Transcription) => {
      const { source_id, key_source_id } = transcription
      const [sourcePages, keyPages] = [parsedPages(transcription.source_pages), parsedPages(transcription.key_pages)]
      // Pages are of a PDF, and within it once its pages are known.
      for (const [id, pages] of [
        [source_id, sourcePages],
        [key_source_id, keyPages],
      ] as const) {
        if (id === null || pages === null || options.sources === undefined) continue
        const source = await options.sources.get(courseId, id)
        if (source.kind !== 'pdf') throw new MaterialRefused('pages_not_pdf')
        if (source.page_count !== null && pages.some((page) => page < 1 || page > source.page_count!)) {
          throw new MaterialRefused('pages_outside')
        }
      }
      if (options.hasKey === false) throw new MaterialRefused('no_provider_key')
      const material: Material = {
        ...fresh(transcription.target_student_ids),
        source_id,
        key_source_id,
        source_pages: sourcePages,
        key_pages: keyPages,
      }
      listOf(topicId).push(material)
      firstInstructions.set(material.id, null)
      const reading = (await unread(courseId, source_id)) || (await unread(courseId, key_source_id))
      return schedule(material, null, reading)
    }),
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
