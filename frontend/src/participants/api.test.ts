import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpParticipantsApi } from './api'

afterEach(() => vi.unstubAllGlobals())

const answer = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

describe('joining over HTTP', () => {
  it('says why joining was refused', async () => {
    for (const [status, detail] of [
      [409, 'run_full'],
      [409, 'joining_closed'],
      [404, 'unknown_link'],
    ] as const) {
      vi.stubGlobal('fetch', answer(status, { detail }))
      expect(await httpParticipantsApi.join('join-7', 'Jan')).toBe(detail)
    }
  })

  it('reads the participant by the token of their personal link', async () => {
    const fetch = answer(200, { id: 1 })
    vi.stubGlobal('fetch', fetch)

    await httpParticipantsApi.me('personal')

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/participant')
    expect(new Headers(init.headers).get('X-Participant-Token')).toBe('personal')
  })

  it('takes a personal link that no longer works for nobody', async () => {
    vi.stubGlobal('fetch', answer(401, { detail: 'unknown_participant' }))

    expect(await httpParticipantsApi.me('gone')).toBeNull()
  })
})
