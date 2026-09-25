import { vi } from 'vitest'
import type { JobFailure } from '../jobs/api'
import { fakeJobsApi, type FakeJobs } from '../jobs/testing'
import type { FakeCourses } from '../courses/testing'
import { ApiError } from '../lesson/api'
import { ConceptMapRefused, type Concept, type ConceptMap, type ConceptsApi, type Preparation } from './api'

/** What the fake assistant proposes: concepts with prerequisites named by name, or a failure. */
export type ScriptedProposal =
  | { concepts: { name: string; description: string; requires?: string[] }[]; diagnostic_offer?: string }
  | { fail: JobFailure }

export const preteritMap: ConceptMap = {
  id: 1,
  topic_id: 2,
  state: 'draft',
  version: 3,
  approved_at: null,
  approved_before: false,
  concepts: [
    { id: 11, name: 'ser', description: 'Fui, fuiste, fue.', prerequisite_ids: [] },
    { id: 12, name: 'ir', description: 'The same forms as ser.', prerequisite_ids: [11] },
    { id: 13, name: 'Completed actions', description: 'When the preterite is used.', prerequisite_ids: [11, 12] },
  ],
  job: null,
}

/**
 * A stand-in for the concept map endpoints, keyed by topic. Merges and splits rewrite the
 * prerequisites as the backend does; identifiers are never reused.
 */
export function fakeConceptsApi(
  options: {
    maps?: Record<number, ConceptMap>
    proposals?: ScriptedProposal[]
    jobs?: FakeJobs
    hasKey?: boolean
    /** The topics of the course, in order, for the status of every map. */
    topics?: number[]
    /** Where a proposal's diagnostic offer lands. */
    courses?: Pick<FakeCourses, 'offerDiagnostic'> & Partial<Pick<FakeCourses, 'whenTopicInterviewFinishes'>>
  } = {},
) {
  const jobs = options.jobs ?? fakeJobsApi()
  const maps: Record<number, ConceptMap> = structuredClone(options.maps ?? {})
  const script = [...(options.proposals ?? [])]
  let nextId = 100
  // Fresh objects on every answer, as over HTTP.
  const answer = (map: ConceptMap) => structuredClone(map)
  const find = (topicId: number) => {
    const map = maps[topicId]
    if (!map) throw new ApiError(404)
    return map
  }
  const ensure = (topicId: number) =>
    (maps[topicId] ??= {
      id: 900 + topicId,
      topic_id: topicId,
      state: 'draft',
      version: 1,
      approved_at: null,
      approved_before: false,
      concepts: [],
      job: null,
    })
  const busy = (map: ConceptMap) => map.job?.state === 'queued' || map.job?.state === 'running'
  const draft = (topicId: number) => {
    const map = ensure(topicId)
    if (busy(map)) throw new ConceptMapRefused('proposal_running')
    if (map.state !== 'draft') throw new ConceptMapRefused('map_approved')
    return map
  }
  const concept = (map: ConceptMap, conceptId: number) => {
    const found = map.concepts.find((c) => c.id === conceptId)
    if (!found) throw new ApiError(404)
    return found
  }
  const changed = (map: ConceptMap) => {
    map.version += 1
    return answer(map)
  }
  const checked = (map: ConceptMap, ids: number[]) => {
    if (ids.some((id) => !map.concepts.some((c) => c.id === id))) throw new ConceptMapRefused('unknown_prerequisite')
    return map.concepts.filter((c) => ids.includes(c.id)).map((c) => c.id)
  }
  // What required any of `old` requires `replacements` instead.
  const rewire = (map: ConceptMap, old: number[], replacements: number[]) => {
    for (const c of map.concepts) {
      if (c.prerequisite_ids.some((id) => old.includes(id))) {
        const kept = c.prerequisite_ids.filter((id) => !old.includes(id))
        c.prerequisite_ids = map.concepts.map((x) => x.id).filter((id) => kept.includes(id) || replacements.includes(id))
      }
    }
  }

  // The proposal as a job; the scripted proposal lands when the job ends.
  const startProposal = (courseId: number, map: ConceptMap) => {
    const job = jobs.start('concept_map', () => {
      const step = script.shift()
      if (!step) throw new Error('the fake assistant was asked more often than scripted')
      if ('fail' in step) {
        map.job = { ...job, state: 'failed', error_kind: step.fail, progress: null }
        return { state: 'failed', error_kind: step.fail, raw_output: null }
      }
      const ids = step.concepts.map(() => nextId++)
      map.concepts = step.concepts.map((c, i) => ({
        id: ids[i],
        name: c.name,
        description: c.description,
        prerequisite_ids: (c.requires ?? []).map((name) => ids[step.concepts.findIndex((x) => x.name === name)]),
      }))
      map.version += 1
      map.job = { ...job, state: 'succeeded', progress: null }
      options.courses?.offerDiagnostic(courseId, map.topic_id, step.diagnostic_offer ?? null)
      return { state: 'succeeded', error_kind: null, raw_output: null }
    })
    map.job = job
    map.version += 1
    return job
  }

  // A finished topic interview proposes the map when it has nothing to review yet.
  options.courses?.whenTopicInterviewFinishes?.((courseId, topicId) => {
    const map = ensure(topicId)
    if (!map.approved_before && map.state === 'draft' && !busy(map) && map.concepts.length === 0) {
      startProposal(courseId, map)
    }
  })

  return {
    map: vi.fn(async (_courseId: number, topicId: number) => (maps[topicId] ? answer(maps[topicId]) : null)),
    propose: vi.fn(async (courseId: number, topicId: number) => {
      if (options.hasKey === false) throw new ConceptMapRefused('no_provider_key')
      const map = ensure(topicId)
      if (map.approved_before) throw new ConceptMapRefused('approved_before')
      if (busy(map)) throw new ConceptMapRefused('proposal_running')
      const job = startProposal(courseId, map)
      return { concept_map: answer(map), job }
    }),
    statuses: vi.fn(async (_courseId: number) =>
      (options.topics ?? []).map((topicId) => {
        const map = maps[topicId]
        return {
          topic_id: topicId,
          state: map?.state ?? null,
          concepts: map?.concepts.length ?? 0,
          job: map?.job ? { ...map.job } : null,
        }
      }),
    ),
    prepare: vi.fn(async (courseId: number) => {
      if (options.hasKey === false) throw new ConceptMapRefused('no_provider_key')
      const prepared: Preparation = { started: [], skipped: [] }
      for (const topicId of options.topics ?? []) {
        const map = ensure(topicId)
        if (map.approved_before) prepared.skipped.push({ topic_id: topicId, reason: 'approved_before' })
        else if (busy(map)) prepared.skipped.push({ topic_id: topicId, reason: 'proposal_running' })
        else if (map.concepts.length > 0) prepared.skipped.push({ topic_id: topicId, reason: 'has_concepts' })
        else prepared.started.push({ topic_id: topicId, job: startProposal(courseId, map) })
      }
      return prepared
    }),
    add: vi.fn(async (_courseId: number, topicId: number, draftConcept) => {
      const map = draft(topicId)
      const prerequisite_ids = checked(map, draftConcept.prerequisite_ids)
      map.concepts.push({ id: nextId++, name: draftConcept.name.trim(), description: draftConcept.description.trim(), prerequisite_ids })
      return changed(map)
    }),
    change: vi.fn(async (_courseId: number, topicId: number, conceptId: number, change) => {
      const map = draft(topicId)
      const found = concept(map, conceptId)
      if (change.name !== undefined) found.name = change.name.trim()
      if (change.description !== undefined) found.description = change.description.trim()
      if (change.add_prerequisite_ids || change.remove_prerequisite_ids) {
        const added = change.add_prerequisite_ids ?? []
        if (added.includes(conceptId)) throw new ConceptMapRefused('prerequisite_cycle')
        checked(map, added)
        const removed = change.remove_prerequisite_ids ?? []
        const kept = new Set([...found.prerequisite_ids, ...added].filter((id) => !removed.includes(id)))
        found.prerequisite_ids = map.concepts.map((c) => c.id).filter((id) => kept.has(id))
      }
      return changed(map)
    }),
    remove: vi.fn(async (_courseId: number, topicId: number, conceptId: number) => {
      const map = draft(topicId)
      concept(map, conceptId)
      map.concepts = map.concepts.filter((c) => c.id !== conceptId)
      rewire(map, [conceptId], [])
      return changed(map)
    }),
    merge: vi.fn(async (_courseId: number, topicId: number, conceptIds: number[], merged) => {
      const map = draft(topicId)
      const old = conceptIds.map((id) => concept(map, id))
      const first = map.concepts.findIndex((c) => conceptIds.includes(c.id))
      const requires = [...new Set(old.flatMap((c) => c.prerequisite_ids))].filter((id) => !conceptIds.includes(id))
      const created: Concept = { id: nextId++, name: merged.name.trim(), description: merged.description.trim(), prerequisite_ids: requires }
      map.concepts.splice(first, 0, created)
      map.concepts = map.concepts.filter((c) => !conceptIds.includes(c.id))
      rewire(map, conceptIds, [created.id])
      return changed(map)
    }),
    split: vi.fn(async (_courseId: number, topicId: number, conceptId: number, parts) => {
      const map = draft(topicId)
      const old = concept(map, conceptId)
      const created: Concept[] = parts.map((part: { name: string; description: string }) => ({
        id: nextId++,
        name: part.name.trim(),
        description: part.description.trim(),
        prerequisite_ids: [...old.prerequisite_ids],
      }))
      map.concepts.splice(map.concepts.indexOf(old), 1, ...created)
      rewire(map, [conceptId], created.map((c) => c.id))
      return changed(map)
    }),
    approve: vi.fn(async (_courseId: number, topicId: number, version: number) => {
      const map = draft(topicId)
      if (map.version !== version) throw new ConceptMapRefused('map_changed')
      if (map.concepts.length === 0) throw new ConceptMapRefused('empty_map')
      Object.assign(map, { state: 'approved', approved_at: '2026-09-24T08:00:00Z', approved_before: true })
      return changed(map)
    }),
    reopen: vi.fn(async (_courseId: number, topicId: number) => {
      const map = find(topicId)
      if (map.state !== 'approved') throw new ConceptMapRefused('not_approved')
      Object.assign(map, { state: 'draft', approved_at: null })
      return changed(map)
    }),
  } satisfies ConceptsApi
}

export type FakeConcepts = ReturnType<typeof fakeConceptsApi>
