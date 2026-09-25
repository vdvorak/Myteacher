import { vi } from 'vitest'
import type { AttentionItem, Checklist, Home, HomeApi } from './api'

export const nothingDone: Checklist = {
  assistant: false,
  course: false,
  sources: false,
  concept_map: false,
  material: false,
  students: false,
  run: false,
  course_id: null,
  topic_id: null,
  run_id: null,
}

/** An attention item with the place fields it does not use left empty. */
export const attention = (item: Partial<AttentionItem> & Pick<AttentionItem, 'kind' | 'count'>): AttentionItem => ({
  course_id: null,
  course_name: null,
  topic_id: null,
  run_id: null,
  release_id: null,
  title: null,
  due_at: null,
  submitted: null,
  total: null,
  tab: null,
  ...item,
})

/** A stand-in for the home endpoint: a new teacher's home unless told otherwise. */
export function fakeHomeApi(home: Partial<Home> = {}) {
  const found: Home = { checklist: nothingDone, attention: [], courses: [], instance: null, ...home }
  return {
    get: vi.fn(async () => structuredClone(found)),
  } satisfies HomeApi
}
