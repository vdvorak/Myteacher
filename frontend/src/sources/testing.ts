import { vi } from 'vitest'
import type { JobFailure } from '../jobs/api'
import { fakeJobsApi, type FakeJobs } from '../jobs/testing'
import { ApiError } from '../lesson/api'
import { SourceRefused, type Source, type SourceDetail, type SourceKind, type SourcesApi } from './api'

/** How the fake reads a file: its text, or why it found none. */
export type ScriptedExtraction = { text: string } | { fail: JobFailure }
/** What the fake finds at a web address: a page with a title and text, or why it found none. */
export type ScriptedPage = { title: string | null; text: string } | { fail: JobFailure }

export const textbook: SourceDetail = {
  id: 1,
  name: 'Učebnice, kapitola 1.pdf',
  kind: 'pdf',
  media_type: 'application/pdf',
  size: 245_760,
  visible_to_students: false,
  created_at: '2026-09-24T08:00:00Z',
  extracted_with: 'file',
  url: null,
  fetched_at: null,
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
    /** What each web address serves; with none given, every page has text. */
    pages?: Record<string, ScriptedPage>
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

  // A web page is fetched by its own job: its snapshot, or why there is none.
  const snapshot = (source: SourceDetail, named: boolean) => {
    const job = jobs.start(
      'source_extraction',
      () => {
        const page: ScriptedPage = options.pages
          ? (options.pages[source.url!] ?? { fail: 'unreachable' })
          : { title: null, text: `The text of ${source.url}` }
        if ('fail' in page) {
          source.job = { ...source.job!, state: 'failed', error_kind: page.fail, progress: null }
          return { state: 'failed', error_kind: page.fail, raw_output: null }
        }
        Object.assign(source, {
          text: page.text,
          characters: page.text.length,
          extracted_with: 'page',
          media_type: 'text/html',
          size: page.text.length,
          fetched_at: '2026-09-24T08:00:00Z',
          name: !named && page.title ? page.title : source.name,
        })
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
        url: null,
        fetched_at: null,
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
    addPage: vi.fn(async (courseId: number, url: string, name: string | null) => {
      if (!/^https?:\/\/[^/]+/.test(url)) throw new ApiError(422)
      const source: SourceDetail = {
        id: nextId++,
        name: name ?? url,
        kind: 'url',
        media_type: '',
        size: 0,
        visible_to_students: false,
        created_at: '2026-09-24T08:00:00Z',
        extracted_with: null,
        url,
        fetched_at: null,
        characters: null,
        job: null,
        text: null,
      }
      listOf(courseId).push(source)
      return snapshot(source, name !== null)
    }),
    extract: vi.fn(async (courseId: number, sourceId: number, ocr: boolean) => {
      const source = find(courseId, sourceId)
      if (source.job && (source.job.state === 'queued' || source.job.state === 'running')) {
        throw new SourceRefused('extraction_running')
      }
      if (source.kind === 'url') {
        if (source.text !== null) throw new SourceRefused('snapshot_taken')
        return snapshot(source, source.name !== source.url)
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
