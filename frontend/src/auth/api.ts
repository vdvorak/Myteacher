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

export interface AuthApi {
  /** The signed-in account, or null for an anonymous visitor. */
  me(): Promise<Account | null>
  signIn(email: string, password: string): Promise<SignInResult>
  signOut(): Promise<void>
}

async function account(response: Response): Promise<Account | null> {
  if (response.status === 401) return null
  if (!response.ok) throw new ApiError(response.status)
  return (await response.json()) as Account
}

/** The session lives in an HTTP-only cookie, so the client never handles a token. */
export const httpAuthApi: AuthApi = {
  me: async () => account(await fetch('/api/auth/me')),
  signIn: async (email, password) => {
    const response = await fetch('/api/auth/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (response.status === 403) return 'inactive'
    return (await account(response)) ?? 'invalid'
  },
  signOut: async () => {
    const response = await fetch('/api/auth/sign-out', { method: 'POST' })
    if (!response.ok && response.status !== 401) throw new ApiError(response.status)
  },
}
