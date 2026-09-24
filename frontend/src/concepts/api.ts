import type { Job } from '../jobs/api'
import { ApiError } from '../lesson/api'

export interface Concept {
  /** Stays through renames and description edits; never reused. */
  id: number
  name: string
  description: string
  /** Concepts of the same map to know first, in map order. */
  prerequisite_ids: number[]
}

export interface ConceptMap {
  id: number
  topic_id: number
  /** Only an approved map decides what is tracked; only a draft changes. */
  state: 'draft' | 'approved'
  /** Changes with every change; approval names the version the teacher saw. */
  version: number
  approved_at: string | null
  /** Once approved, the map is changed by hand and not proposed again. */
  approved_before: boolean
  concepts: Concept[]
  /** The latest proposal. */
  job: Job | null
}

export interface ConceptMapStarted {
  concept_map: ConceptMap
  job: Job
}

/** Where one topic's map stands, to follow the preparation of all topics. */
export interface MapStatus {
  topic_id: number
  /** Null while the topic has no map. */
  state: ConceptMap['state'] | null
  concepts: number
  /** The latest proposal. */
  job: Job | null
}

export interface Preparation {
  started: { topic_id: number; job: Job }[]
  skipped: { topic_id: number; reason: 'approved_before' | 'proposal_running' | 'has_concepts' }[]
}

export interface ConceptDraft {
  name: string
  description: string
}

export type ConceptChange = Partial<Pick<Concept, 'name' | 'description' | 'prerequisite_ids'>>

export type ConceptMapRefusal =
  | 'no_provider_key'
  | 'approved_before'
  | 'proposal_running'
  | 'map_approved'
  | 'not_approved'
  /** Someone changed the map since the teacher saw it. */
  | 'map_changed'
  | 'empty_map'
  | 'prerequisite_cycle'
  | 'unknown_prerequisite'

/** A change of the map was refused; `reason` says why. */
export class ConceptMapRefused extends Error {
  readonly reason: ConceptMapRefusal

  constructor(reason: ConceptMapRefusal) {
    super(reason)
    this.reason = reason
  }
}

/** Every change answers with the whole map. */
export interface ConceptsApi {
  /** The topic's map, or null when it has none yet. */
  map(courseId: number, topicId: number): Promise<ConceptMap | null>
  /** The assistant's proposal replaces the draft's concepts when its job ends. */
  propose(courseId: number, topicId: number): Promise<ConceptMapStarted>
  /** At the end of the map; starts the map when the topic has none. */
  add(courseId: number, topicId: number, concept: ConceptDraft & { prerequisite_ids: number[] }): Promise<ConceptMap>
  change(courseId: number, topicId: number, conceptId: number, change: ConceptChange): Promise<ConceptMap>
  remove(courseId: number, topicId: number, conceptId: number): Promise<ConceptMap>
  /** The concepts are replaced by a new one. */
  merge(courseId: number, topicId: number, conceptIds: number[], merged: ConceptDraft): Promise<ConceptMap>
  /** The concept is replaced by new ones, at least two. */
  split(courseId: number, topicId: number, conceptId: number, parts: ConceptDraft[]): Promise<ConceptMap>
  approve(courseId: number, topicId: number, version: number): Promise<ConceptMap>
  reopen(courseId: number, topicId: number): Promise<ConceptMap>
  /** Every topic's map status, in topic order. */
  statuses(courseId: number): Promise<MapStatus[]>
  /** A proposal job for every topic with no map to review yet; the others are skipped. */
  prepare(courseId: number): Promise<Preparation>
}

const refusals: ReadonlySet<string> = new Set<ConceptMapRefusal>([
  'no_provider_key',
  'approved_before',
  'proposal_running',
  'map_approved',
  'not_approved',
  'map_changed',
  'empty_map',
  'prerequisite_cycle',
  'unknown_prerequisite',
])

async function checked<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: unknown } | null
    if (typeof body?.detail === 'string' && refusals.has(body.detail)) {
      throw new ConceptMapRefused(body.detail as ConceptMapRefusal)
    }
    throw new ApiError(response.status)
  }
  return (await response.json()) as T
}

function send(method: string, url: string, body?: unknown) {
  return fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const mapUrl = (courseId: number, topicId: number) => `/api/courses/${courseId}/topics/${topicId}/concept-map`
const conceptUrl = (courseId: number, topicId: number, conceptId: number) =>
  `${mapUrl(courseId, topicId)}/concepts/${conceptId}`

export const httpConceptsApi: ConceptsApi = {
  map: async (courseId, topicId) => checked(await fetch(mapUrl(courseId, topicId))),
  propose: async (courseId, topicId) => checked(await send('POST', `${mapUrl(courseId, topicId)}/proposal`)),
  add: async (courseId, topicId, concept) => checked(await send('POST', `${mapUrl(courseId, topicId)}/concepts`, concept)),
  change: async (courseId, topicId, conceptId, change) =>
    checked(await send('PATCH', conceptUrl(courseId, topicId, conceptId), change)),
  remove: async (courseId, topicId, conceptId) => checked(await send('DELETE', conceptUrl(courseId, topicId, conceptId))),
  merge: async (courseId, topicId, conceptIds, merged) =>
    checked(await send('POST', `${mapUrl(courseId, topicId)}/merges`, { concept_ids: conceptIds, ...merged })),
  split: async (courseId, topicId, conceptId, parts) =>
    checked(await send('POST', `${conceptUrl(courseId, topicId, conceptId)}/split`, { parts })),
  approve: async (courseId, topicId, version) =>
    checked(await send('POST', `${mapUrl(courseId, topicId)}/approval`, { version })),
  reopen: async (courseId, topicId) => checked(await send('POST', `${mapUrl(courseId, topicId)}/reopening`)),
  statuses: async (courseId) => checked(await fetch(`/api/courses/${courseId}/concept-maps`)),
  prepare: async (courseId) => checked(await send('POST', `/api/courses/${courseId}/concept-maps/proposals`)),
}
