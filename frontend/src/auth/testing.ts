import { vi } from 'vitest'
import type { Account, AuthApi, SignInResult } from './api'

export const admin: Account = {
  id: 1,
  email: 'admin@skola.example',
  kind: 'teacher',
  roles: ['teacher', 'admin'],
  language: null,
}

/** A stand-in for the auth endpoints with one account and its password. */
export function fakeAuthApi(
  options: { signedIn?: Account; password?: string; inactive?: boolean; meFails?: boolean } = {},
) {
  let current: Account | null = options.signedIn ?? null
  const password = options.password ?? 'correct horse battery'
  return {
    me: vi.fn(async () => {
      if (options.meFails) throw new Error('unreachable')
      return current
    }),
    signIn: vi.fn(async (email: string, given: string): Promise<SignInResult> => {
      if (email.trim().toLowerCase() !== admin.email || given !== password) return 'invalid'
      if (options.inactive) return 'inactive'
      current = admin
      return admin
    }),
    signOut: vi.fn(async () => {
      current = null
    }),
  } satisfies AuthApi
}
