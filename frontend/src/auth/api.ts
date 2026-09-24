import type { Locale } from '../i18n/messages'
import { ApiError } from '../lesson/api'

export interface Account {
  id: number
  email: string
  kind: 'teacher' | 'student'
  roles: string[]
  /** Chosen interface language; null until chosen. */
  language: Locale | null
}

/** The account on success, or why signing in was refused. */
export type SignInResult = Account | 'invalid' | 'inactive'

export type InvitationState = 'valid' | 'used' | 'revoked' | 'expired' | 'unknown'

export interface InvitationCheck {
  state: InvitationState
  /** Only for a valid invitation. */
  email: string | null
}

/** The account on success, or why the invitation could not be accepted. */
export type AcceptResult = Account | Exclude<InvitationState, 'valid'> | 'inactive'

export interface AuthApi {
  /** The signed-in account, or null for an anonymous visitor. */
  me(): Promise<Account | null>
  signIn(email: string, password: string): Promise<SignInResult>
  signOut(): Promise<void>
  checkInvitation(token: string): Promise<InvitationCheck>
  /** Sets the first password and signs in. */
  acceptInvitation(token: string, password: string): Promise<AcceptResult>
  /** Emails a reset link if the address has an active account; the answer never says. */
  requestReset(email: string): Promise<void>
  checkReset(token: string): Promise<InvitationCheck>
  /** Sets a new password, ends the account's other sessions and signs in. */
  completeReset(token: string, password: string): Promise<AcceptResult>
}

async function account(response: Response): Promise<Account | null> {
  if (response.status === 401) return null
  if (!response.ok) throw new ApiError(response.status)
  return (await response.json()) as Account
}

function post(url: string, body: unknown) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

/** The outcome of setting a password from an emailed link: the signed-in account or why not. */
async function passwordResult(response: Response): Promise<AcceptResult> {
  if (response.status === 403) return 'inactive'
  if (response.status === 404 || response.status === 410) {
    const { detail } = (await response.json()) as { detail: string }
    return detail.replace(/^(invitation|reset)_/, '') as AcceptResult
  }
  if (!response.ok) throw new ApiError(response.status)
  return (await response.json()) as Account
}

/** The session lives in an HTTP-only cookie, so the client never handles a token. */
export const httpAuthApi: AuthApi = {
  me: async () => account(await fetch('/api/auth/me')),
  signIn: async (email, password) => {
    const response = await post('/api/auth/sign-in', { email, password })
    if (response.status === 403) return 'inactive'
    return (await account(response)) ?? 'invalid'
  },
  checkInvitation: async (token) => {
    const response = await post('/api/auth/invitations/check', { token })
    if (!response.ok) throw new ApiError(response.status)
    return (await response.json()) as InvitationCheck
  },
  acceptInvitation: async (token, password) =>
    passwordResult(await post('/api/auth/invitations/accept', { token, password })),
  requestReset: async (email) => {
    const response = await post('/api/auth/password-reset/request', { email })
    if (!response.ok) throw new ApiError(response.status)
  },
  checkReset: async (token) => {
    const response = await post('/api/auth/password-reset/check', { token })
    if (!response.ok) throw new ApiError(response.status)
    const { state } = (await response.json()) as { state: InvitationState }
    return { state, email: null }
  },
  completeReset: async (token, password) =>
    passwordResult(await post('/api/auth/password-reset/complete', { token, password })),
  signOut: async () => {
    const response = await fetch('/api/auth/sign-out', { method: 'POST' })
    if (!response.ok && response.status !== 401) throw new ApiError(response.status)
  },
}
