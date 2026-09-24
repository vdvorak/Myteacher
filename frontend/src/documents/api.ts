import type { Job } from '../jobs/api'
import { ApiError } from '../lesson/api'

export type ReferenceKind = 'vocabulary' | 'grammar' | 'glossary'
export const referenceKinds: ReferenceKind[] = ['vocabulary', 'grammar', 'glossary']

export interface Citation {
  source_id: number
  /** Null once the source was removed from the course. */
  source_name: string | null
  /** Where in the source: a unit, section, page or heading. */
  location: string
}

export interface Passage {
  /** Constrained Markdown: CommonMark without raw HTML. */
  markdown: string
  citations: Citation[]
  /** No citation: the passage rests on no source and is marked for the teacher to check. */
  unsourced: boolean
}

export interface ReferenceDocumentSummary {
  id: number
  kind: ReferenceKind
  /** Of the latest version; null until the first one was generated. */
  title: string | null
  version: number | null
  created_at: string
  /** The latest generation job. */
  job: Job | null
}

export interface ReferenceDocument extends ReferenceDocumentSummary {
  passages: Passage[]
  unsourced_passages: number
}

export interface DocumentStarted {
  document: ReferenceDocumentSummary
  job: Job
}

/** The text of a new version: passages keep their citations by source and location. */
export interface DocumentContent {
  title: string
  passages: { markdown: string; citations: Pick<Citation, 'source_id' | 'location'>[] }[]
}

export type DocumentRefusal =
  | 'map_not_approved'
  | 'no_provider_key'
  | 'nothing_to_retry'
  | 'unknown_source'
  /** A newer version was saved since the one the edit started from. */
  | 'document_changed'

/** A generation or an edit was refused; `reason` says why. */
export class DocumentRefused extends Error {
  readonly reason: DocumentRefusal

  constructor(reason: DocumentRefusal) {
    super(reason)
    this.reason = reason
  }
}

export interface DocumentsApi {
  /** The topic's documents, without their text. */
  list(courseId: number, topicId: number): Promise<ReferenceDocumentSummary[]>
  get(courseId: number, topicId: number, documentId: number): Promise<ReferenceDocument>
  /** Needs the topic's concept map approved; the text lands when the job ends. */
  generate(courseId: number, topicId: number, kind: ReferenceKind): Promise<DocumentStarted>
  retry(courseId: number, topicId: number, documentId: number): Promise<DocumentStarted>
  /** Saves the text as a new version of `basedOn`; the edit is recorded against the generation. */
  edit(
    courseId: number,
    topicId: number,
    documentId: number,
    content: DocumentContent,
    basedOn: number,
  ): Promise<ReferenceDocument>
  /** Records that the teacher keeps the document as it is. */
  keep(courseId: number, topicId: number, documentId: number): Promise<void>
  /** Removes the document; the discard is recorded against the generation. */
  discard(courseId: number, topicId: number, documentId: number): Promise<void>
}

const refusals: ReadonlySet<string> = new Set<DocumentRefusal>([
  'map_not_approved',
  'no_provider_key',
  'nothing_to_retry',
  'unknown_source',
  'document_changed',
])

async function checked(response: Response): Promise<Response> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: unknown } | null
    if (typeof body?.detail === 'string' && refusals.has(body.detail)) {
      throw new DocumentRefused(body.detail as DocumentRefusal)
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

const documentsUrl = (courseId: number, topicId: number) =>
  `/api/courses/${courseId}/topics/${topicId}/reference-documents`

export const httpDocumentsApi: DocumentsApi = {
  list: async (courseId, topicId) => json(await fetch(documentsUrl(courseId, topicId))),
  get: async (courseId, topicId, documentId) => json(await fetch(`${documentsUrl(courseId, topicId)}/${documentId}`)),
  generate: async (courseId, topicId, kind) => json(await send('POST', documentsUrl(courseId, topicId), { kind })),
  retry: async (courseId, topicId, documentId) =>
    json(await send('POST', `${documentsUrl(courseId, topicId)}/${documentId}/retry`)),
  edit: async (courseId, topicId, documentId, content, basedOn) =>
    json(
      await send('POST', `${documentsUrl(courseId, topicId)}/${documentId}/versions`, {
        ...content,
        based_on: basedOn,
      }),
    ),
  keep: async (courseId, topicId, documentId) => {
    await checked(await send('POST', `${documentsUrl(courseId, topicId)}/${documentId}/reactions`, { kind: 'kept' }))
  },
  discard: async (courseId, topicId, documentId) => {
    await checked(await send('DELETE', `${documentsUrl(courseId, topicId)}/${documentId}`))
  },
}
