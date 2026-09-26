import { httpAttemptsApiWith, type AttemptsApi } from '../attempts/api'
import { ApiError } from '../lesson/api'
import { thisDevice } from './device'

/** Where a join link leads, before anyone types a name. */
export interface JoinCheck {
  /** So the browser finds a personal link it remembers for the run, whatever its join link. */
  run_id: number
  run: string
  course: string
  full: boolean
  /** The teacher closed joining; those who joined still come back through their personal link. */
  closed: boolean
}

/** Someone who joined a link run, without an account. */
export interface Participant {
  id: number
  name: string
  joined_at: string
  run_id: number
  run: string
  course: { id: number; name: string }
}

export type JoinRefusal = 'run_full' | 'unknown_link' | 'joining_closed'

export interface ParticipantsApi {
  /** Null for a join link that leads nowhere. */
  check(joinToken: string): Promise<JoinCheck | null>
  /** Joins the lobby under a name; the token is the personal link's, never shown again. */
  join(joinToken: string, name: string): Promise<{ token: string; participant: Participant } | JoinRefusal>
  /** The participant the personal link belongs to, whichever device their work is open on; null for a link that
   * does not work. */
  me(token: string): Promise<Participant | null>
  /** Opens the personal link on this device: the participant's work moves here, and the device it was open on
   * before hears so at its next request. Null for a link that does not work. */
  open(token: string): Promise<Participant | null>
  /** The participant's releases and attempts, reached through their personal link on this device; a request the
   * work moved away from rejects with `OtherDevice`. */
  attempts(token: string): AttemptsApi
}

/** Where a participant's personal link leads; the token is in the fragment, which the browser never sends. */
export const personalUrl = (token: string) => `${window.location.origin}/participant#${token}`

const onThisDevice = (token?: string) => ({
  ...(token === undefined ? {} : { 'X-Participant-Token': token }),
  'X-Participant-Device': thisDevice(),
})

const post = (url: string, body: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { ...onThisDevice(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

async function participant(response: Response): Promise<Participant | null> {
  if (response.status === 401) return null
  if (!response.ok) throw new ApiError(response.status)
  return (await response.json()) as Participant
}

async function refusal(response: Response): Promise<JoinRefusal | null> {
  if (response.status !== 404 && response.status !== 409) return null
  const { detail } = (await response.clone().json()) as { detail: unknown }
  return detail === 'run_full' || detail === 'unknown_link' || detail === 'joining_closed' ? detail : null
}

export const httpParticipantsApi: ParticipantsApi = {
  check: async (joinToken) => {
    const response = await post('/api/join/check', { token: joinToken })
    if (response.status === 404) return null
    if (!response.ok) throw new ApiError(response.status)
    return (await response.json()) as JoinCheck
  },
  join: async (joinToken, name) => {
    const response = await post('/api/join', { token: joinToken, name })
    const refused = await refusal(response)
    if (refused) return refused
    if (!response.ok) throw new ApiError(response.status)
    return (await response.json()) as { token: string; participant: Participant }
  },
  attempts: (token) => httpAttemptsApiWith(onThisDevice(token)),
  me: async (token) => participant(await fetch('/api/participant', { headers: { 'X-Participant-Token': token } })),
  open: async (token) =>
    participant(await fetch('/api/participant/open', { method: 'POST', headers: onThisDevice(token) })),
}
