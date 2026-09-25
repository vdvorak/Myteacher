import { screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import type { AcceptResult, Account, AuthApi, InvitationState, SignInResult } from './api'

export const admin: Account = {
  id: 1,
  email: 'admin@skola.example',
  name: null,
  kind: 'teacher',
  roles: ['teacher', 'admin'],
  language: null,
  theme: 'system',
}

export const invitedTeacher: Account = {
  id: 2,
  email: 'novak@skola.example',
  name: null,
  kind: 'teacher',
  roles: ['teacher'],
  language: 'cs',
  theme: 'system',
}

export const student: Account = {
  id: 10,
  email: 'jana@skola.example',
  name: 'Jana Veselá',
  kind: 'student',
  roles: ['student'],
  language: 'en',
  theme: 'system',
}

/** A stand-in for the auth endpoints with one account and its password. */
export function fakeAuthApi(
  options: {
    signedIn?: Account
    /** The account the password signs in to; the admin unless given. */
    account?: Account
    /** The account the invitation behind 'the-token' belongs to; a teacher unless given. */
    invited?: Account
    password?: string
    inactive?: boolean
    meFails?: boolean
    /** The state of the invitation behind 'the-token'; any other token is unknown. */
    invitation?: InvitationState
    /** The state of the reset link behind 'reset-token'; any other token is unknown. */
    reset?: InvitationState
  } = {},
) {
  let current: Account | null = options.signedIn ?? null
  const account = options.account ?? admin
  const invited = options.invited ?? invitedTeacher
  const password = options.password ?? 'correct horse battery'
  let used = false
  let resetUsed = false
  const resetState = (token: string): InvitationState => {
    if (token !== 'reset-token') return 'unknown'
    return resetUsed ? 'used' : (options.reset ?? 'valid')
  }
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
      if (email.trim().toLowerCase() !== account.email || given !== password) return 'invalid'
      if (options.inactive) return 'inactive'
      current = account
      return account
    }),
    signOut: vi.fn(async () => {
      current = null
    }),
    checkInvitation: vi.fn(async (token: string) => {
      const state = invitationState(token)
      return { state, email: state === 'valid' ? invited.email : null }
    }),
    requestReset: vi.fn(async (_email: string) => {}),
    checkReset: vi.fn(async (token: string) => ({ state: resetState(token), email: null })),
    completeReset: vi.fn(async (token: string, _password: string): Promise<AcceptResult> => {
      const state = resetState(token)
      if (state !== 'valid') return state
      if (options.inactive) return 'inactive'
      resetUsed = true
      current = admin
      return admin
    }),
    acceptInvitation: vi.fn(async (token: string, _password: string): Promise<AcceptResult> => {
      const state = invitationState(token)
      if (state !== 'valid') return state
      if (options.inactive) return 'inactive'
      used = true
      current = invited
      return invited
    }),
  } satisfies AuthApi
}

/** The account menu's button, which the shell shows once someone is signed in. */
export const findAccountMenu = () => screen.findByRole('button', { name: /^(Account|Účet): / })

/** Open the account menu, where the language, the theme and signing out are. */
export async function openAccountMenu(user = userEvent.setup()) {
  await user.click(await findAccountMenu())
  return user
}
