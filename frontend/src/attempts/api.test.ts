import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../lesson/api'
import type { RenderedAnswer } from '../lesson/schema'
import { sampleLesson } from '../lesson/testing'
import { attemptLessonApi, AttemptRefused, httpAttemptsApi, progressOf } from './api'
import { attemptOf, fakeAttemptsApi } from './testing'

afterEach(() => vi.unstubAllGlobals())

const answer = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

const sent = (fetch: ReturnType<typeof answer>) => {
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit | undefined]
  return { url, method: init?.method ?? 'GET', body: init?.body === undefined ? undefined : JSON.parse(init.body as string) }
}

const choice = (option_id: string): RenderedAnswer => ({ type: 'multiple_choice', option_id })

describe('attempts over HTTP', () => {
  it('reaches each endpoint of an attempt', async () => {
    const calls: [() => Promise<unknown>, string, string, unknown][] = [
      [() => httpAttemptsApi.releases(), '/api/my/releases', 'GET', undefined],
      [() => httpAttemptsApi.release(3), '/api/my/releases/3', 'GET', undefined],
      [() => httpAttemptsApi.start(3), '/api/my/releases/3/attempts', 'POST', undefined],
      [
        () => httpAttemptsApi.saveDraft(8, 'first', 'location', choice('es')),
        '/api/attempts/8/rounds/first/drafts/location',
        'PUT',
        choice('es'),
      ],
      [
        () => httpAttemptsApi.tryAnswer(8, 'second', 'location', choice('es')),
        '/api/attempts/8/rounds/second/exercises/location/tries',
        'POST',
        choice('es'),
      ],
      [() => httpAttemptsApi.secondRound(8), '/api/attempts/8/second-round', 'POST', undefined],
    ]
    for (const [call, url, method, body] of calls) {
      const fetch = answer(200, {})
      vi.stubGlobal('fetch', fetch)
      await call()
      expect(sent(fetch)).toEqual({ url, method, body })
    }
  })

  it('submits a round with the answers and hands back the outcomes', async () => {
    const outcome = { status: 'pending', exercise_id: 'write', reason: 'not_deterministically_assessable' }
    const written = { answer: { type: 'free_text', text: 'Soy Ana.' }, result: outcome }
    const fetch = answer(200, { tries: { write: written } })
    vi.stubGlobal('fetch', fetch)

    expect(await httpAttemptsApi.submitRound(8, 'first', { location: choice('esta') })).toEqual({ write: written })
    expect(sent(fetch)).toEqual({
      url: '/api/attempts/8/rounds/first/submission',
      method: 'POST',
      body: { answers: { location: choice('esta') } },
    })
  })

  it('turns a refused start into its reason', async () => {
    vi.stubGlobal('fetch', answer(409, { detail: 'no_more_attempts' }))
    await expect(httpAttemptsApi.start(3)).rejects.toEqual(new AttemptRefused('no_more_attempts'))

    vi.stubGlobal('fetch', answer(409, { detail: 'exercise_locked' }))
    await expect(httpAttemptsApi.tryAnswer(8, 'first', 'location', choice('es'))).rejects.toEqual(new ApiError(409))
  })
})

describe('an attempt as the lesson player’s backend', () => {
  it('saves drafts one at a time, the latest last, skipping the ones overtaken meanwhile', async () => {
    const attempts = fakeAttemptsApi()
    const releases: (() => void)[] = []
    attempts.saveDraft.mockImplementation(() => new Promise<void>((resolve) => releases.push(resolve)))
    const api = attemptLessonApi(attempts, 8)

    api.saveDraft!('first', 'location', choice('es'))
    api.saveDraft!('first', 'location', choice('son'))
    api.saveDraft!('first', 'location', choice('esta'))
    api.saveDraft!('first', 'origin', choice('somos'))
    expect(attempts.saveDraft.mock.calls.map((call) => call.slice(2))).toEqual([
      ['location', choice('es')],
      ['origin', choice('somos')],
    ])
    releases[0]()
    await vi.waitFor(() => expect(attempts.saveDraft).toHaveBeenCalledTimes(3))

    expect(attempts.saveDraft.mock.calls[2].slice(2)).toEqual(['location', choice('esta')])
  })

  it('submits a round only once the drafts typed before are saved', async () => {
    const attempts = fakeAttemptsApi()
    const saved: (() => void)[] = []
    attempts.saveDraft.mockImplementation(() => new Promise<void>((resolve) => saved.push(resolve)))
    attempts.submitRound.mockResolvedValue({})
    const api = attemptLessonApi(attempts, 8)

    api.saveDraft!('first', 'location', choice('es'))
    const submitted = api.submitRound!('first', { location: choice('es') })
    await Promise.resolve()
    expect(attempts.submitRound).not.toHaveBeenCalled()
    saved[0]()

    await submitted
    expect(attempts.submitRound).toHaveBeenCalledWith(8, 'first', { location: choice('es') })
  })

  it('keeps saving after a draft failed to save', async () => {
    const attempts = fakeAttemptsApi()
    attempts.saveDraft.mockRejectedValueOnce(new ApiError(500))
    const api = attemptLessonApi(attempts, 8)

    api.saveDraft!('first', 'location', choice('es'))
    await vi.waitFor(() => expect(attempts.saveDraft).toHaveBeenCalledTimes(1))
    api.saveDraft!('first', 'location', choice('esta'))

    await vi.waitFor(() => expect(attempts.saveDraft).toHaveBeenCalledTimes(2))
  })

  it('leaves tries and the second round to the server', async () => {
    const attempts = fakeAttemptsApi()
    const api = attemptLessonApi(attempts, 8)
    attempts.tryAnswer.mockResolvedValueOnce({ status: 'pending', exercise_id: 'x', reason: 'not_deterministically_assessable' })
    attempts.secondRound.mockResolvedValueOnce({ exercises: [], layouts: { a: ['r1'] }, answers: {}, submitted: false })

    await api.assess('location', choice('es'), { reveal: true, round: 'second' })
    expect(await api.secondRound(['location'], 'browser seed')).toEqual({ exercises: [], layouts: { a: ['r1'] } })

    expect(attempts.tryAnswer).toHaveBeenCalledWith(8, 'second', 'location', choice('es'))
    expect(attempts.secondRound).toHaveBeenCalledWith(8)
  })

  it('resumes the player from the attempt', () => {
    const attempt = attemptOf(sampleLesson, { seed: 'abc' })
    attempt.first.answers = { location: { draft: null, tries: [] } }
    attempt.first.layouts = { location: ['a'] }

    const progress = progressOf(attempt)

    expect(progress.seed).toBe('abc')
    expect(progress.first.answers.location).toEqual({ draft: undefined, tries: [] })
    expect(progress.first.layouts).toEqual({ location: ['a'] })
    expect(progress.second).toBeNull()
  })
})
