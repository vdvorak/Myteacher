import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../lesson/api'
import { defaultSettings, httpRunsApi, ReleaseRefused } from './api'

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

  it('reads a release’s results and a student’s attempts', async () => {
    for (const [call, url] of [
      [() => httpRunsApi.results(7, 3), '/api/runs/7/releases/3/results'],
      [() => httpRunsApi.studentResults(7, 3, 10), '/api/runs/7/releases/3/results/10'],
    ] as const) {
      const fetch = answer(200, {})
      vi.stubGlobal('fetch', fetch)
      await call()
      expect(sent(fetch)).toMatchObject({ url, method: 'GET' })
    }
  })

  it('turns a known refusal of a release into its reason', async () => {
    const body = { material_id: 4, version: 1, audience: 'run' as const, student_ids: null, ...defaultSettings }
    vi.stubGlobal('fetch', answer(422, { detail: 'not_in_run' }))
    await expect(httpRunsApi.release(7, body)).rejects.toEqual(new ReleaseRefused('not_in_run'))

    vi.stubGlobal('fetch', answer(422, { detail: [{ msg: 'invalid' }] }))
    await expect(httpRunsApi.release(7, body)).rejects.toEqual(new ApiError(422))
  })

  it('turns a refusal into an error with its status', async () => {
    vi.stubGlobal('fetch', answer(404, { detail: 'Not Found' }))

    await expect(httpRunsApi.get(99)).rejects.toEqual(new ApiError(404))
  })
})
