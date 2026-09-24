import { vi } from 'vitest'
import type { AccountSettings, AccountSettingsChange, SettingsApi } from './api'

export function fakeSettingsApi(initial: Partial<AccountSettings> = {}) {
  let stored: AccountSettings = {
    language: null,
    digest_time: '07:00',
    digest_time_is_default: true,
    ...initial,
  }
  return {
    read: vi.fn(async (_accountId: number) => stored),
    change: vi.fn(async (_accountId: number, change: AccountSettingsChange) => {
      stored = { ...stored }
      if (change.language !== undefined) stored.language = change.language
      if (change.digest_time !== undefined) {
        stored.digest_time = change.digest_time ?? '07:00'
        stored.digest_time_is_default = change.digest_time === null
      }
      return stored
    }),
  } satisfies SettingsApi
}
