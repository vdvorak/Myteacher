import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../lesson/api'
import { httpRunsApi } from './api'

afterEach(() => vi.unstubAllGlobals())

const answer = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

const sent = (fetch: ReturnType<typeof answer>) => {
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit | undefined]
  return { url, method: init?.method ?? 'GET', body: init?.body === undefined ? undefined : JSON.parse(init.body as string) }
}

describe('runs over HTTP', () => {
  it('starts a run of a course with its name', async () => {
    const fetch = answer(201, {})
    vi.stubGlobal('fetch', fetch)

    await httpRunsApi.start(3, 'Španělština 2.B')

    expect(sent(fetch)).toEqual({ url: '/api/courses/3/runs', method: 'POST', body: { name: 'Španělština 2.B' } })
  })

  it('enrols and removes classes and students by id', async () => {
    const calls: [() => Promise<unknown>, string, string][] = [
      [() => httpRunsApi.enrolClass(7, 1), '/api/runs/7/classes/1', 'PUT'],
      [() => httpRunsApi.unenrolClass(7, 1), '/api/runs/7/classes/1', 'DELETE'],
      [() => httpRunsApi.enrolStudent(7, 10), '/api/runs/7/students/10', 'PUT'],
      [() => httpRunsApi.unenrolStudent(7, 10), '/api/runs/7/students/10', 'DELETE'],
    ]
    for (const [call, url, method] of calls) {
      const fetch = answer(200, {})
      vi.stubGlobal('fetch', fetch)
      await call()
      expect(sent(fetch)).toMatchObject({ url, method })
    }
  })

  it('turns a refusal into an error with its status', async () => {
    vi.stubGlobal('fetch', answer(404, { detail: 'Not Found' }))

    await expect(httpRunsApi.get(99)).rejects.toEqual(new ApiError(404))
  })
})
