import { afterEach, describe, expect, it, vi } from 'vitest'
import { OtherDevice } from '../attempts/api'
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

  it('opens the personal link on this device, the same device every time', async () => {
    const fetch = answer(200, { id: 1 })
    vi.stubGlobal('fetch', fetch)

    await httpParticipantsApi.open('personal')
    await httpParticipantsApi.attempts('personal').releases()

    const [[url, init], [, later]] = fetch.mock.calls as unknown as [string, RequestInit][]
    expect([url, init.method]).toEqual(['/api/participant/open', 'POST'])
    const headers = new Headers(init.headers)
    expect(headers.get('X-Participant-Token')).toBe('personal')
    expect(headers.get('X-Participant-Device')).toMatch(/^[0-9a-f]{32}$/)
    expect(new Headers(later.headers).get('X-Participant-Device')).toBe(headers.get('X-Participant-Device'))
    expect(localStorage.getItem('myteacher.device')).toBe(headers.get('X-Participant-Device'))
  })

  it('joins on this device', async () => {
    const fetch = answer(201, { token: 'personal', participant: { id: 1 } })
    vi.stubGlobal('fetch', fetch)

    await httpParticipantsApi.join('join-7', 'Jan')

    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(new Headers(init.headers).get('X-Participant-Device')).toMatch(/^[0-9a-f]{32}$/)
  })

  it('refuses the work of a participant whose work moved to another device', async () => {
    vi.stubGlobal('fetch', answer(409, { detail: 'other_device' }))

    await expect(httpParticipantsApi.attempts('personal').releases()).rejects.toBeInstanceOf(OtherDevice)
  })

  it('takes a personal link that no longer works for nobody', async () => {
    vi.stubGlobal('fetch', answer(401, { detail: 'unknown_participant' }))

    expect(await httpParticipantsApi.me('gone')).toBeNull()
    expect(await httpParticipantsApi.open('gone')).toBeNull()
  })
})
