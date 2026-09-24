import type { Locale } from '../i18n/messages'
import { ApiError } from '../lesson/api'

export interface AccountSettings {
  language: Locale | null
  digest_time: string
  digest_time_is_default: boolean
}

/** Only the fields present change; a null digest time returns to the instance default. */
export interface AccountSettingsChange {
  language?: Locale
  digest_time?: string | null
}

export interface SettingsApi {
  read(accountId: number): Promise<AccountSettings>
  change(accountId: number, change: AccountSettingsChange): Promise<AccountSettings>
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new ApiError(response.status)
  return (await response.json()) as T
}

export const httpSettingsApi: SettingsApi = {
  read: async (accountId) => json(await fetch(`/api/accounts/${accountId}/settings`)),
  change: async (accountId, change) =>
    json(
      await fetch(`/api/accounts/${accountId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change),
      }),
    ),
}
