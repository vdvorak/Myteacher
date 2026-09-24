import type { Locale } from '../i18n/messages'
import { ApiError } from '../lesson/api'

export interface AccountSettings {
  language: Locale | null
  /** Null for students, who get no digest. */
  digest_time: string | null
  digest_time_is_default: boolean
}

/** Only the fields present change; a null digest time returns to the instance default. */
export interface AccountSettingsChange {
  language?: Locale
  digest_time?: string | null
}

export interface Provider {
  id: string
  label: string
  strong_model: string
  fast_model: string
}

export interface Credential {
  provider: string
  /** Only the last characters; the key itself never comes back from the server. */
  masked_key: string
  strong_model: string
  fast_model: string
  updated_at: string
}

/** Without `api_key` the stored key stays; slots left out keep their value. */
export interface CredentialChange {
  api_key?: string
  strong_model?: string
  fast_model?: string
}

export type KeyProblem = 'authentication' | 'quota' | 'other'

export interface KeyTest {
  ok: boolean
  error_kind: KeyProblem | null
}

export interface SettingsApi {
  read(accountId: number): Promise<AccountSettings>
  change(accountId: number, change: AccountSettingsChange): Promise<AccountSettings>
  providers(): Promise<Provider[]>
  credentials(accountId: number): Promise<Credential[]>
  saveCredential(accountId: number, provider: string, change: CredentialChange): Promise<Credential>
  removeCredential(accountId: number, provider: string): Promise<void>
  testCredential(accountId: number, provider: string): Promise<KeyTest>
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new ApiError(response.status)
  return (await response.json()) as T
}

const credentialUrl = (accountId: number, provider: string) =>
  `/api/accounts/${accountId}/provider-credentials/${encodeURIComponent(provider)}`

export const httpSettingsApi: SettingsApi = {
  providers: async () => json(await fetch('/api/providers')),
  credentials: async (accountId) => json(await fetch(`/api/accounts/${accountId}/provider-credentials`)),
  saveCredential: async (accountId, provider, change) =>
    json(
      await fetch(credentialUrl(accountId, provider), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change),
      }),
    ),
  removeCredential: async (accountId, provider) => {
    const response = await fetch(credentialUrl(accountId, provider), { method: 'DELETE' })
    if (!response.ok) throw new ApiError(response.status)
  },
  testCredential: async (accountId, provider) =>
    json(await fetch(`${credentialUrl(accountId, provider)}/test`, { method: 'POST' })),
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
