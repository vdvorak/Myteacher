import { vi } from 'vitest'
import type { JobFailure } from '../jobs/api'
import { fakeJobsApi, type FakeJobs } from '../jobs/testing'
import { ApiError } from '../lesson/api'
import { SourceRefused, type Source, type SourceDetail, type SourceKind, type SourcesApi } from './api'

/** How the fake reads a file: its text, or why it found none. */
export type ScriptedExtraction = { text: string } | { fail: JobFailure }

export const textbook: SourceDetail = {
  id: 1,
  name: 'Učebnice, kapitola 1.pdf',
  kind: 'pdf',
  media_type: 'application/pdf',
  size: 245_760,
  visible_to_students: false,
  created_at: '2026-09-24T08:00:00Z',
  extracted_with: 'file',
  characters: 27,
  job: null,
  text: 'Unidad 1\n\nEl presente de ser',
}

const kinds: Record<string, SourceKind> = {
  'application/pdf': 'pdf',
  'text/plain': 'text',
  'text/markdown': 'text',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
}

/**
 * A stand-in for the source endpoints. A text file is read as it is; a PDF or an image gets the
 * next scripted extraction, or has no text unless read with OCR.
 */
export function fakeSourcesApi(
  options: {
    sources?: Record<number, SourceDetail[]>
    jobs?: FakeJobs
    /** Whether the teacher has a provider key to pay OCR with. */
    hasKey?: boolean
    extractions?: ScriptedExtraction[]
  } = {},
) {
  const jobs = options.jobs ?? fakeJobsApi()
  const stored: Record<number, SourceDetail[]> = structuredClone(options.sources ?? {})
  const script = [...(options.extractions ?? [])]
  let nextId = 100
  const listOf = (courseId: number) => (stored[courseId] ??= [])
  const find = (courseId: number, sourceId: number) => {
    const source = listOf(courseId).find((s) => s.id === sourceId)
    if (!source) throw new ApiError(404)
    return source
  }
  // Without the text, as the list endpoint answers; fresh objects, as over HTTP.
  const summary = ({ text: _text, ...source }: SourceDetail): Source => structuredClone(source)

  const extract = (source: SourceDetail, ocr: boolean, content: string | null) => {
    if (ocr && options.hasKey === false) throw new SourceRefused('no_provider_key')
    const job = jobs.start(
      'source_extraction',
      () => {
        const scripted: ScriptedExtraction =
          script.shift() ??
          (content !== null ? { text: content } : ocr ? { text: `Read by OCR from ${source.name}` } : { fail: 'no_text' })
        if ('fail' in scripted) {
          source.job = { ...source.job!, state: 'failed', error_kind: scripted.fail, progress: null }
          return { state: 'failed', error_kind: scripted.fail, raw_output: null }
        }
        source.text = scripted.text
        source.characters = scripted.text.length
        source.extracted_with = ocr && content === null ? 'ocr' : 'file'
        source.job = { ...source.job!, state: 'succeeded', progress: null }
        return { state: 'succeeded', error_kind: null, raw_output: null }
      },
      'extracting',
    )
    source.job = job
    return { source: summary(source), job }
  }

  return {
    list: vi.fn(async (courseId: number) => listOf(courseId).map(summary)),
    get: vi.fn(async (courseId: number, sourceId: number) => structuredClone(find(courseId, sourceId))),
    upload: vi.fn(async (courseId: number, file: File, ocr: boolean) => {
      const kind = kinds[file.type]
      if (!kind) throw new SourceRefused('unsupported_type')
      if (file.size === 0) throw new SourceRefused('empty_file')
      if (ocr && options.hasKey === false) throw new SourceRefused('no_provider_key')
      const source: SourceDetail = {
        id: nextId++,
        name: file.name,
        kind,
        media_type: file.type,
        size: file.size,
        visible_to_students: false,
        created_at: '2026-09-24T08:00:00Z',
        extracted_with: null,
        characters: null,
        job: null,
        text: null,
      }
      listOf(courseId).push(source)
      return extract(source, ocr, kind === 'text' ? await file.text() : null)
    }),
    change: vi.fn(async (courseId: number, sourceId: number, change) => {
      const source = find(courseId, sourceId)
      Object.assign(source, change)
      return summary(source)
    }),
    extract: vi.fn(async (courseId: number, sourceId: number, ocr: boolean) => {
      const source = find(courseId, sourceId)
      if (source.job && (source.job.state === 'queued' || source.job.state === 'running')) {
        throw new SourceRefused('extraction_running')
      }
      return extract(source, ocr, source.kind === 'text' ? source.text : null)
    }),
    remove: vi.fn(async (courseId: number, sourceId: number) => {
      find(courseId, sourceId)
      stored[courseId] = listOf(courseId).filter((s) => s.id !== sourceId)
    }),
    fileUrl: (courseId: number, sourceId: number) => `/api/courses/${courseId}/sources/${sourceId}/file`,
  } satisfies SourcesApi
}
