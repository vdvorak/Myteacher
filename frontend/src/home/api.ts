import { ApiError } from '../lesson/api'

/** Which getting-started steps are done, and where the steps lead. */
export interface Checklist {
  assistant: boolean
  /** A course with its brief done. */
  course: boolean
  sources: boolean
  concept_map: boolean
  material: boolean
  /** A class with a student in it. */
  students: boolean
  /** A run started; releasing into it ends the checklist. */
  run: boolean
  /** The course last created, its topic with an approved map (or else its first), the run last started. */
  course_id: number | null
  topic_id: number | null
  run_id: number | null
}

export type AttentionKind = 'open_answers' | 'drafts' | 'awaiting_consent' | 'due_soon'

export interface AttentionItem {
  kind: AttentionKind
  /** Open answers waiting, drafts not reviewed, students awaiting consent; 1 for a due date. */
  count: number
  course_id: number | null
  course_name: string | null
  topic_id: number | null
  run_id: number | null
  release_id: number | null
  /** The release's or the topic's. */
  title: string | null
  due_at: string | null
  submitted: number | null
  total: number | null
  /** Where drafts are reviewed: the topic's documents or its materials. */
  tab: 'documents' | 'materials' | null
}

export interface CourseInPreparation {
  id: number
  name: string
  brief: boolean
  sources: boolean
  topics: number
  /** Topics holding classroom material. */
  topics_ready: number
}

export interface Home {
  /** Null once the teacher released material. */
  checklist: Checklist | null
  attention: AttentionItem[]
  courses: CourseInPreparation[]
  /** For an admin, until email works and a teacher is invited. */
  instance: { smtp: boolean; teacher_invited: boolean } | null
}

/** The teacher's home: what to do now. */
export interface HomeApi {
  get(): Promise<Home>
}

export const httpHomeApi: HomeApi = {
  get: async () => {
    const response = await fetch('/api/home')
    if (!response.ok) throw new ApiError(response.status)
    return (await response.json()) as Home
  },
}
