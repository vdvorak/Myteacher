import { vi } from 'vitest'
import type { JobFailure } from '../jobs/api'
import { fakeJobsApi, type FakeJobs } from '../jobs/testing'
import { ApiError } from '../lesson/api'
import {
  DocumentRefused,
  type DocumentContent,
  type DocumentsApi,
  type Passage,
  type ReferenceDocument,
  type ReferenceKind,
} from './api'

/** What the fake assistant writes: a document, or why it failed. */
export type ScriptedDocument = Pick<ReferenceDocument, 'title' | 'passages'> | { fail: JobFailure }

export const cheatSheet: ReferenceDocument = {
  id: 31,
  kind: 'grammar',
  title: 'Pretérito indefinido',
  version: 1,
  created_at: '2026-09-24T08:00:00Z',
  reviewed: false,
  job: null,
  passages: [
    {
      markdown: '## Regular -ar verbs\n\n**hablar**: hablé, hablaste, habló',
      citations: [{ source_id: 1, source_name: 'Učebnice 3.pdf', location: 'Unidad 3' }],
      unsourced: false,
    },
    {
      markdown: '**ser** and **ir** share their forms: fui, fuiste, fue.',
      citations: [
        { source_id: 1, source_name: 'Učebnice 3.pdf', location: 'Unidad 3' },
        { source_id: 2, source_name: null, location: 'p. 12' },
      ],
      unsourced: false,
    },
    { markdown: 'Use it for finished actions.', citations: [], unsourced: true },
  ],
  unsourced_passages: 1,
}

/** A stand-in for the reference document endpoints, keyed by topic. */
export function fakeDocumentsApi(
  options: {
    documents?: Record<number, ReferenceDocument[]>
    script?: ScriptedDocument[]
    jobs?: FakeJobs
    hasKey?: boolean
    /** Topics whose concept map is not approved. */
    unapproved?: number[]
  } = {},
) {
  const jobs = options.jobs ?? fakeJobsApi()
  const stored: Record<number, ReferenceDocument[]> = structuredClone(options.documents ?? {})
  const script = [...(options.script ?? [])]
  let nextId = 100
  const listOf = (topicId: number) => (stored[topicId] ??= [])
  const find = (topicId: number, documentId: number) => {
    const document = listOf(topicId).find((d) => d.id === documentId)
    if (!document) throw new ApiError(404)
    return document
  }
  const summary = ({ passages: _p, unsourced_passages: _u, ...rest }: ReferenceDocument) => structuredClone(rest)
  const schedule = (document: ReferenceDocument) => {
    if (options.hasKey === false) throw new DocumentRefused('no_provider_key')
    const job = jobs.start('reference_document', () => {
      const step = script.shift()
      if (!step) throw new Error('the fake assistant was asked more often than scripted')
      if ('fail' in step) {
        document.job = { ...job, state: 'failed', error_kind: step.fail, progress: null }
        return { state: 'failed', error_kind: step.fail, raw_output: null }
      }
      Object.assign(document, {
        title: step.title,
        passages: step.passages,
        version: 1,
        unsourced_passages: step.passages.filter((p) => p.unsourced).length,
        reviewed: false,
      })
      document.job = { ...job, state: 'succeeded', progress: null }
      return { state: 'succeeded', error_kind: null, raw_output: null }
    })
    document.job = job
    return { document: summary(document), job }
  }

  return {
    list: vi.fn(async (_courseId: number, topicId: number) => listOf(topicId).map(summary)),
    get: vi.fn(async (_courseId: number, topicId: number, documentId: number) =>
      structuredClone(find(topicId, documentId)),
    ),
    generate: vi.fn(async (_courseId: number, topicId: number, kind: ReferenceKind) => {
      if (options.unapproved?.includes(topicId)) throw new DocumentRefused('map_not_approved')
      if (options.hasKey === false) throw new DocumentRefused('no_provider_key')
      const document: ReferenceDocument = {
        id: nextId++,
        kind,
        title: null,
        version: null,
        created_at: '2026-09-24T08:00:00Z',
        reviewed: false,
        job: null,
        passages: [],
        unsourced_passages: 0,
      }
      listOf(topicId).push(document)
      return schedule(document)
    }),
    retry: vi.fn(async (_courseId: number, topicId: number, documentId: number) => {
      const document = find(topicId, documentId)
      if (document.version !== null || document.job?.state !== 'failed') throw new DocumentRefused('nothing_to_retry')
      return schedule(document)
    }),
    edit: vi.fn(
      async (_courseId: number, topicId: number, documentId: number, content: DocumentContent, basedOn: number) => {
        const document = find(topicId, documentId)
        if (document.version !== basedOn) throw new DocumentRefused('document_changed')
        const known = new Map(
          document.passages.flatMap((p) => p.citations).map((c) => [c.source_id, c.source_name] as const),
        )
        const passages: Passage[] = content.passages.map((p) => ({
          markdown: p.markdown,
          citations: p.citations.map((c) => ({ ...c, source_name: known.get(c.source_id) ?? null })),
          unsourced: p.citations.length === 0,
        }))
        Object.assign(document, {
          title: content.title,
          passages,
          version: (document.version ?? 0) + 1,
          unsourced_passages: passages.filter((p) => p.unsourced).length,
          // The teacher wrote it.
          reviewed: true,
        })
        return structuredClone(document)
      },
    ),
    keep: vi.fn(async (_courseId: number, topicId: number, documentId: number) => {
      find(topicId, documentId).reviewed = true
    }),
    discard: vi.fn(async (_courseId: number, topicId: number, documentId: number) => {
      find(topicId, documentId)
      stored[topicId] = listOf(topicId).filter((d) => d.id !== documentId)
    }),
  } satisfies DocumentsApi
}
