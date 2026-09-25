import { vi } from 'vitest'
import type { LessonPublic } from '../generated/lesson'
import { ApiError } from '../lesson/api'
import type { RoundKey, Try } from '../lesson/progress'
import { isRendered, type RenderedAnswer } from '../lesson/schema'
import { fakeApi, sampleLesson } from '../lesson/testing'
import { defaultSettings } from '../runs/api'
import { AttemptRefused, type Attempt, type AttemptsApi, type ReleaseDetail, type ServedRound } from './api'

const clone = <T>(value: T): T => structuredClone(value)

export function servedRound(lesson: LessonPublic): ServedRound {
  return { exercises: lesson.blocks.filter(isRendered), layouts: {}, answers: {}, submitted: false }
}

export function attemptOf(lesson: LessonPublic = sampleLesson, fields: Partial<Attempt> = {}): Attempt {
  return {
    id: 100,
    release_id: 1,
    number: 1,
    seed: '1',
    lesson,
    first: servedRound(lesson),
    second: null,
    started_at: '2026-09-24T08:00:00Z',
    submitted_at: null,
    late: false,
    ...fields,
  }
}

export function releaseOf(fields: Partial<ReleaseDetail> = {}): ReleaseDetail {
  return {
    ...defaultSettings,
    id: 1,
    title: 'Ser, or estar?',
    topic: 'Ser y estar',
    course: 'Španělština 2.B',
    run: 'Španělština 2.B 2026/27',
    released_at: '2026-09-24T08:00:00Z',
    due_at: null,
    state: 'not_started',
    late: false,
    counting_attempt_id: null,
    progress: null,
    score: null,
    new_assessment: false,
    can_start: true,
    attempt: null,
    retraction: null,
    ...fields,
  }
}

/** A stand-in for the student's release and attempt endpoints, grading with the sample lesson's keys. */
export function fakeAttemptsApi(options: { releases?: ReleaseDetail[]; lesson?: LessonPublic } = {}) {
  const lesson = options.lesson ?? sampleLesson
  const grader = fakeApi(lesson)
  const releases = new Map((options.releases ?? []).map((release) => [release.id, clone(release)]))
  let nextAttempt = 100
  const find = (id: number) => {
    const release = releases.get(id)
    if (!release) throw new ApiError(404)
    return release
  }
  const attempt = (attemptId: number) => {
    const release = [...releases.values()].find((r) => r.attempt?.id === attemptId)
    if (!release?.attempt) throw new ApiError(404)
    return release.attempt
  }
  const roundOf = (attemptId: number, round: RoundKey) => {
    const found = attempt(attemptId)
    return round === 'first' ? found.first : found.second!
  }
  const grade = (exerciseId: string, answer: RenderedAnswer) =>
    grader.assess(exerciseId, answer, { reveal: true })
  const api = {
    releases: vi.fn(async () =>
      [...releases.values()].map(({ attempt: _a, ...summary }) => clone(summary)),
    ),
    release: vi.fn(async (id: number) => {
      const found = find(id)
      const shown = clone(found)
      // Like the backend: once looked at, what was published is no longer new.
      found.new_assessment = false
      return shown
    }),
    start: vi.fn(async (releaseId: number) => {
      const release = find(releaseId)
      if (release.attempt && !release.attempt.submitted_at) return clone(release.attempt)
      if (!release.can_start) throw new AttemptRefused(release.attempt ? 'no_more_attempts' : 'past_due')
      release.attempt = attemptOf(lesson, {
        id: nextAttempt++,
        release_id: releaseId,
        number: (release.attempt?.number ?? 0) + 1,
        lesson: { ...lesson, feedback_mode: release.feedback_mode },
      })
      release.state = 'in_progress'
      return clone(release.attempt)
    }),
    saveDraft: vi.fn(async (attemptId: number, round: RoundKey, exerciseId: string, answer: RenderedAnswer) => {
      const served = roundOf(attemptId, round)
      served.answers[exerciseId] = { tries: served.answers[exerciseId]?.tries ?? [], draft: answer }
    }),
    tryAnswer: vi.fn(async (attemptId: number, round: RoundKey, exerciseId: string, answer: RenderedAnswer) => {
      const result = await grade(exerciseId, answer)
      const served = roundOf(attemptId, round)
      const current = served.answers[exerciseId] ?? { draft: null, tries: [] }
      served.answers[exerciseId] = { draft: answer, tries: [...current.tries, { answer, result }] }
      return clone(result)
    }),
    submitRound: vi.fn(async (attemptId: number, round: RoundKey, answers: Record<string, RenderedAnswer>) => {
      const tries: Record<string, Try> = {}
      for (const [exerciseId, answer] of Object.entries(answers)) {
        tries[exerciseId] = { answer, result: await grade(exerciseId, answer) }
      }
      const found = attempt(attemptId)
      roundOf(attemptId, round).submitted = true
      if (round === 'first') found.submitted_at = '2026-09-24T08:30:00Z'
      return clone(tries)
    }),
    secondRound: vi.fn(async (attemptId: number) => {
      const found = attempt(attemptId)
      found.second ??= { ...servedRound(lesson), exercises: [] }
      return clone(found.second)
    }),
  }
  return api satisfies AttemptsApi
}
