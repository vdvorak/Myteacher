import { createEffect, createResource, createSignal, For, Match, Show, Switch } from 'solid-js'
import { useI18n } from '../i18n/i18n'
import type { MessageKey } from '../i18n/messages'
import type { Credential, KeyProblem, Provider, SettingsApi } from './api'

const problemMessages: Record<KeyProblem, MessageKey> = {
  authentication: 'providers.test.authentication',
  quota: 'providers.test.quota',
  transient: 'providers.test.transient',
  other: 'providers.test.other',
}

/** A teacher's provider keys: add one, then only ever see its masked tail. */
export function ProviderKeys(props: { api: SettingsApi; accountId: number }) {
  const { t } = useI18n()
  const [catalog] = createResource(() => props.api.providers())
  const [credentials, { mutate }] = createResource(
    () => props.accountId,
    (id) => props.api.credentials(id),
  )
  const label = (id: string) => catalog()?.find((provider) => provider.id === id)?.label ?? id
  const unused = () => (catalog() ?? []).filter((p) => !(credentials() ?? []).some((c) => c.provider === p.id))

  const replace = (saved: Credential) =>
    mutate((list) => [...(list ?? []).filter((c) => c.provider !== saved.provider), saved].sort((a, b) =>
      a.provider.localeCompare(b.provider),
    ))
  const drop = (provider: string) => mutate((list) => (list ?? []).filter((c) => c.provider !== provider))

  return (
    <section class="admin-section" aria-labelledby="providers-heading">
      <h2 id="providers-heading">{t('providers.heading')}</h2>
      <p class="settings-note">{t('providers.intro')}</p>
      <Show when={catalog.error || credentials.error}>
        <p role="alert">{t('providers.loadFailed')}</p>
      </Show>
      <Show when={catalog() && credentials()}>
        {/* Keyed by provider, so a saved credential updates its card instead of replacing it. */}
        <For each={(credentials() ?? []).map((c) => c.provider)}>
          {(provider) => (
            <Show when={credentials()?.find((c) => c.provider === provider)}>
              {(credential) => (
                <CredentialCard
                  api={props.api}
                  accountId={props.accountId}
                  credential={credential()}
                  label={label(provider)}
                  onSaved={replace}
                  onRemoved={() => drop(provider)}
                />
              )}
            </Show>
          )}
        </For>
        <Show when={unused().length > 0}>
          <AddKey api={props.api} accountId={props.accountId} providers={unused()} onSaved={replace} />
        </Show>
      </Show>
    </section>
  )
}

function AddKey(props: {
  api: SettingsApi
  accountId: number
  providers: Provider[]
  onSaved: (saved: Credential) => void
}) {
  const { t } = useI18n()
  const [provider, setProvider] = createSignal('')
  const [apiKey, setApiKey] = createSignal('')
  const [strong, setStrong] = createSignal('')
  const [fast, setFast] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [failed, setFailed] = createSignal(false)

  // Pre-fill the recommended slots whenever the chosen provider changes.
  const choose = (id: string) => {
    setProvider(id)
    const chosen = props.providers.find((p) => p.id === id)
    setStrong(chosen?.strong_model ?? '')
    setFast(chosen?.fast_model ?? '')
  }
  createEffect(() => {
    if (!props.providers.some((p) => p.id === provider())) choose(props.providers[0]?.id ?? '')
  })

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    setBusy(true)
    setFailed(false)
    try {
      const saved = await props.api.saveCredential(props.accountId, provider(), {
        api_key: apiKey(),
        strong_model: strong(),
        fast_model: fast(),
      })
      setApiKey('')
      props.onSaved(saved)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form class="settings-form" onSubmit={submit}>
      <h3>{t('providers.add')}</h3>
      <label>
        {t('providers.provider')}
        <select value={provider()} onChange={(e) => choose(e.currentTarget.value)}>
          <For each={props.providers}>{(p) => <option value={p.id}>{p.label}</option>}</For>
        </select>
      </label>
      <label>
        {t('providers.apiKey')}
        <input
          type="password"
          autocomplete="off"
          required
          minLength={8}
          value={apiKey()}
          onInput={(e) => setApiKey(e.currentTarget.value)}
        />
      </label>
      <ModelSlots strong={strong()} fast={fast()} onStrong={setStrong} onFast={setFast} />
      <Show when={failed()}>
        <p role="alert">{t('providers.saveFailed')}</p>
      </Show>
      <button type="submit" disabled={busy()}>
        {t('providers.addKey')}
      </button>
    </form>
  )
}

function ModelSlots(props: {
  strong: string
  fast: string
  onStrong: (value: string) => void
  onFast: (value: string) => void
}) {
  const { t } = useI18n()
  return (
    <>
      <label>
        {t('providers.strongModel')}
        <input required value={props.strong} onInput={(e) => props.onStrong(e.currentTarget.value)} />
      </label>
      <label>
        {t('providers.fastModel')}
        <input required value={props.fast} onInput={(e) => props.onFast(e.currentTarget.value)} />
      </label>
      <p class="settings-note">{t('providers.slotsNote')}</p>
    </>
  )
}

type CardOutcome = { kind: 'works' } | { kind: 'problem'; problem: KeyProblem } | { kind: 'saved' } | { kind: 'failed' }

function CredentialCard(props: {
  api: SettingsApi
  accountId: number
  credential: Credential
  label: string
  onSaved: (saved: Credential) => void
  onRemoved: () => void
}) {
  const { t } = useI18n()
  const [strong, setStrong] = createSignal(props.credential.strong_model)
  const [fast, setFast] = createSignal(props.credential.fast_model)
  const [newKey, setNewKey] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [outcome, setOutcome] = createSignal<CardOutcome | null>(null)

  async function run(action: () => Promise<CardOutcome | null>) {
    setBusy(true)
    setOutcome(null)
    try {
      setOutcome(await action())
    } catch {
      setOutcome({ kind: 'failed' })
    } finally {
      setBusy(false)
    }
  }

  const save = (change: Parameters<SettingsApi['saveCredential']>[2]) =>
    run(async () => {
      props.onSaved(await props.api.saveCredential(props.accountId, props.credential.provider, change))
      return { kind: 'saved' }
    })

  const test = () =>
    run(async () => {
      const result = await props.api.testCredential(props.accountId, props.credential.provider)
      return result.ok ? { kind: 'works' } : { kind: 'problem', problem: result.error_kind ?? 'other' }
    })

  const remove = () =>
    run(async () => {
      await props.api.removeCredential(props.accountId, props.credential.provider)
      props.onRemoved()
      return null
    })

  const problem = () => {
    const current = outcome()
    return current?.kind === 'problem' ? current.problem : null
  }

  return (
    <fieldset class="settings-form provider-card" aria-label={props.label}>
      <legend>{props.label}</legend>
      <p>
        {t('providers.storedKey')} <code>{props.credential.masked_key}</code>
      </p>
      <div class="settings-actions">
        <button type="button" disabled={busy()} onClick={test}>
          {t('providers.testKey')}
        </button>
        <button type="button" disabled={busy()} onClick={remove}>
          {t('providers.removeKey')}
        </button>
      </div>
      <Switch>
        <Match when={outcome()?.kind === 'works'}>
          <p role="status">{t('providers.test.works')}</p>
        </Match>
        <Match when={problem()}>{(kind) => <p role="alert">{t(problemMessages[kind()])}</p>}</Match>
        <Match when={outcome()?.kind === 'saved'}>
          <p role="status">{t('settings.saved')}</p>
        </Match>
        <Match when={outcome()?.kind === 'failed'}>
          <p role="alert">{t('providers.saveFailed')}</p>
        </Match>
      </Switch>
      <form
        class="settings-form"
        onSubmit={(event) => {
          event.preventDefault()
          void save({ strong_model: strong(), fast_model: fast() })
        }}
      >
        <ModelSlots strong={strong()} fast={fast()} onStrong={setStrong} onFast={setFast} />
        <button type="submit" disabled={busy()}>
          {t('providers.saveModels')}
        </button>
      </form>
      <form
        class="settings-form"
        onSubmit={(event) => {
          event.preventDefault()
          const key = newKey()
          setNewKey('')
          void save({ api_key: key })
        }}
      >
        <label>
          {t('providers.newApiKey')}
          <input
            type="password"
            autocomplete="off"
            required
            minLength={8}
            value={newKey()}
            onInput={(e) => setNewKey(e.currentTarget.value)}
          />
        </label>
        <button type="submit" disabled={busy()}>
          {t('providers.replaceKey')}
        </button>
      </form>
    </fieldset>
  )
}
