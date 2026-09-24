import { vi } from 'vitest'
import type {
  AccountSettings,
  AccountSettingsChange,
  Credential,
  CredentialChange,
  KeyProblem,
  Provider,
  SettingsApi,
} from './api'

export const catalog: Provider[] = [
  { id: 'anthropic', label: 'Anthropic', strong_model: 'claude-opus-5-5', fast_model: 'claude-haiku-4-5' },
  { id: 'openai', label: 'OpenAI', strong_model: 'gpt-5.5', fast_model: 'gpt-5.1-mini' },
]

export function fakeSettingsApi(
  initial: Partial<AccountSettings> = {},
  options: { credentials?: Credential[]; keyProblem?: KeyProblem } = {},
) {
  let credentials = options.credentials ?? []
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
    providers: vi.fn(async () => catalog),
    credentials: vi.fn(async (_accountId: number) => credentials),
    saveCredential: vi.fn(async (_accountId: number, provider: string, change: CredentialChange) => {
      const existing = credentials.find((c) => c.provider === provider)
      const defaults = catalog.find((p) => p.id === provider)!
      const saved: Credential = {
        provider,
        masked_key: change.api_key ? `…${change.api_key.slice(-4)}` : existing!.masked_key,
        strong_model: change.strong_model ?? existing?.strong_model ?? defaults.strong_model,
        fast_model: change.fast_model ?? existing?.fast_model ?? defaults.fast_model,
        updated_at: '2026-09-24T08:00:00Z',
      }
      credentials = [...credentials.filter((c) => c.provider !== provider), saved]
      return saved
    }),
    removeCredential: vi.fn(async (_accountId: number, provider: string) => {
      credentials = credentials.filter((c) => c.provider !== provider)
    }),
    testCredential: vi.fn(async (_accountId: number, _provider: string) =>
      options.keyProblem ? { ok: false, error_kind: options.keyProblem } : { ok: true, error_kind: null },
    ),
  } satisfies SettingsApi
}
