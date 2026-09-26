import type { Job } from '../jobs/api'
import { ApiError } from '../lesson/api'

/** What a source was uploaded as, read from its content, or a web page the teacher named. */
export type SourceKind = 'pdf' | 'text' | 'image' | 'url'

export interface Source {
  id: number
  name: string
  kind: SourceKind
  media_type: string
  size: number
  /** Whether students may later read the original behind a lesson. */
  visible_to_students: boolean
  created_at: string
  /** 'file' when read from the file itself, 'ocr' when the assistant read it, 'page' from a web page; null before. */
  extracted_with: 'file' | 'ocr' | 'page' | null
  /** For a web page: its address, and when its snapshot was taken, once (null before). */
  url: string | null
  fetched_at: string | null
  /** How long the extracted text is; null before it was extracted. */
  characters: number | null
  /** For a PDF read page by page, how many pages it has; null otherwise. */
  page_count: number | null
  /** The pages of such a PDF, numbered from 1, that its file holds no text for: scans or handwriting, which OCR reads. */
  pages_without_text: number[]
  /** The latest extraction. */
  job: Job | null
}

export interface SourceDetail extends Source {
  /** What the assistant will read. */
  text: string | null
}

export interface SourceStarted {
  source: Source
  /** Null for a file stored unread, which its transcription reads. */
  job: Job | null
}

export type SourceChange = Partial<Pick<Source, 'name' | 'visible_to_students'>>

export type SourceRefusal =
  | 'unsupported_type'
  | 'too_large'
  | 'empty_file'
  | 'no_provider_key'
  | 'extraction_running'
  /** A web page's snapshot is taken once. */
  | 'snapshot_taken'

/** An upload or an extraction was refused before it started. */
export class SourceRefused extends Error {
  readonly reason: SourceRefusal

  constructor(reason: SourceRefusal) {
    super(reason)
    this.reason = reason
  }
}

export interface SourcesApi {
  /** In the order they were added, without their text. */
  list(courseId: number): Promise<Source[]>
  get(courseId: number, sourceId: number): Promise<SourceDetail>
  /** Starts extracting the text; `ocr` lets the assistant read images and scans. */
  upload(courseId: number, file: File, ocr: boolean): Promise<SourceStarted>
  /** Stores the file unread, for its transcription to read first; refused without a provider key. */
  store(courseId: number, file: File): Promise<SourceStarted>
  change(courseId: number, sourceId: number, change: SourceChange): Promise<Source>
  /** Starts taking the snapshot of a web page; without a name, the page's title names it. */
  addPage(courseId: number, url: string, name: string | null): Promise<SourceStarted>
  /** Adds pasted text as a text source, read like an uploaded text file. */
  addText(courseId: number, name: string, text: string): Promise<SourceStarted>
  /** Reads the text again; a web page is fetched again only while it has no snapshot. */
  extract(courseId: number, sourceId: number, ocr: boolean): Promise<SourceStarted>
  remove(courseId: number, sourceId: number): Promise<void>
  /** Where the original file is downloaded from. */
  fileUrl(courseId: number, sourceId: number): string
}

const refusals: ReadonlySet<string> = new Set<SourceRefusal>([
  'unsupported_type',
  'too_large',
  'empty_file',
  'no_provider_key',
  'extraction_running',
  'snapshot_taken',
])

async function checked<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: unknown } | null
    // Any other refusal is a plain failure to the teacher.
    if (typeof body?.detail === 'string' && refusals.has(body.detail)) {
      throw new SourceRefused(body.detail as SourceRefusal)
    }
  }
  if (!response.ok) throw new ApiError(response.status)
  return (await response.json()) as T
}

/** What a file input offers to upload as a source. */
export const sourceFileTypes =
  '.pdf,.txt,.md,.png,.jpg,.jpeg,.webp,application/pdf,text/plain,text/markdown,image/png,image/jpeg,image/webp'

// Browsers often give no type for these; the backend reads the kind from the content anyway.
const typesByExtension: Record<string, string> = { md: 'text/markdown', txt: 'text/plain' }

export function uploadType(file: File): string {
  if (file.type) return file.type
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return typesByExtension[extension] ?? 'application/octet-stream'
}

const sourcesUrl = (courseId: number) => `/api/courses/${courseId}/sources`

export const httpSourcesApi: SourcesApi = {
  list: async (courseId) => checked(await fetch(sourcesUrl(courseId))),
  get: async (courseId, sourceId) => checked(await fetch(`${sourcesUrl(courseId)}/${sourceId}`)),
  upload: async (courseId, file, ocr) => {
    const query = new URLSearchParams({ name: file.name, ocr: String(ocr) })
    return checked(
      await fetch(`${sourcesUrl(courseId)}?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': uploadType(file) },
        body: file,
      }),
    )
  },
  store: async (courseId, file) => {
    const query = new URLSearchParams({ name: file.name, read: 'false' })
    return checked(
      await fetch(`${sourcesUrl(courseId)}?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': uploadType(file) },
        body: file,
      }),
    )
  },
  addPage: async (courseId, url, name) =>
    checked(
      await fetch(`${sourcesUrl(courseId)}/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(name === null ? { url } : { url, name }),
      }),
    ),
  addText: async (courseId, name, text) =>
    checked(
      await fetch(`${sourcesUrl(courseId)}/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, text }),
      }),
    ),
  change: async (courseId, sourceId, change) =>
    checked(
      await fetch(`${sourcesUrl(courseId)}/${sourceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change),
      }),
    ),
  extract: async (courseId, sourceId, ocr) =>
    checked(
      await fetch(`${sourcesUrl(courseId)}/${sourceId}/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ocr }),
      }),
    ),
  remove: async (courseId, sourceId) => {
    const response = await fetch(`${sourcesUrl(courseId)}/${sourceId}`, { method: 'DELETE' })
    if (!response.ok) throw new ApiError(response.status)
  },
  fileUrl: (courseId, sourceId) => `${sourcesUrl(courseId)}/${sourceId}/file`,
}
