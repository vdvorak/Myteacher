import { vi } from 'vitest'
import type { AcceptResult, Account, AuthApi, InvitationState, SignInResult } from './api'

export const admin: Account = {
  id: 1,
  email: 'admin@skola.example',
  kind: 'teacher',
  roles: ['teacher', 'admin'],
  language: null,
}

export const invitedTeacher: Account = {
  id: 2,
  email: 'novak@skola.example',
  kind: 'teacher',
  roles: ['teacher'],
  language: 'cs',
}

/** A stand-in for the auth endpoints with one account and its password. */
export function fakeAuthApi(
  options: {
    signedIn?: Account
    password?: string
    inactive?: boolean
    meFails?: boolean
    /** The state of the invitation behind 'the-token'; any other token is unknown. */
    invitation?: InvitationState
  } = {},
) {
  let current: Account | null = options.signedIn ?? null
  const password = options.password ?? 'correct horse battery'
  let used = false
  const invitationState = (token: string): InvitationState => {
    if (token !== 'the-token') return 'unknown'
    return used ? 'used' : (options.invitation ?? 'valid')
  }
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
    checkInvitation: vi.fn(async (token: string) => {
      const state = invitationState(token)
      return { state, email: state === 'valid' ? invitedTeacher.email : null }
    }),
    acceptInvitation: vi.fn(async (token: string, _password: string): Promise<AcceptResult> => {
      const state = invitationState(token)
      if (state !== 'valid') return state
      if (options.inactive) return 'inactive'
      used = true
      current = invitedTeacher
      return invitedTeacher
    }),
  } satisfies AuthApi
}
