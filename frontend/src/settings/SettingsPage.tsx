import { createEffect, createResource, createSignal, For, Match, Show, Switch } from 'solid-js'
import { useApi } from '../api/context'
import { useSession } from '../auth/session'
import { useI18n } from '../i18n/i18n'
import { localeNames, locales, type Locale } from '../i18n/messages'
import '../admin/admin.css'
import { useChooseLanguage } from './language'
import { themes, useChooseTheme, type Theme } from './theme'
import { ProviderKeys } from './ProviderKeys'

type Outcome = 'saved' | 'failed' | null

/** The signed-in account's own settings: interface language, theme, and a teacher's digest time. */
export function SettingsPage() {
  const { t, locale } = useI18n()
  const session = useSession()
  const api = useApi().settings
  const chooseLanguage = useChooseLanguage()
  const chooseTheme = useChooseTheme()
  const theme = () => session.account()?.theme ?? 'system'
  const accountId = () => session.account()?.id
  const [settings, { mutate }] = createResource(accountId, (id) => api.read(id))
  const [digestTime, setDigestTime] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [outcome, setOutcome] = createSignal<Outcome>(null)

  createEffect(() => {
    const loaded = settings()
    if (loaded) setDigestTime(loaded.digest_time ?? '')
  })

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setOutcome(null)
    try {
      await action()
      setOutcome('saved')
    } catch {
      setOutcome('failed')
    } finally {
      setBusy(false)
    }
  }

  const changeDigestTime = (value: string | null) =>
    run(async () => {
      const id = accountId()
      if (id !== undefined) mutate(await api.change(id, { digest_time: value }))
    })

  return (
    <section class="admin-section">
      <h1>{t('settings.heading')}</h1>
      <Show when={settings.error}>
        <p role="alert">{t('settings.loadFailed')}</p>
      </Show>
      <Show when={settings()}>
        {(loaded) => (
          <>
            <div class="settings-form">
              <label>
                {t('settings.language')}
                <select
                  value={locale()}
                  disabled={busy()}
                  onChange={(event) => run(() => chooseLanguage(event.currentTarget.value as Locale))}
                >
                  <For each={locales}>{(code) => <option value={code}>{localeNames[code]}</option>}</For>
                </select>
              </label>
              <label>
                {t('settings.theme')}
                <select
                  value={theme()}
                  disabled={busy()}
                  onChange={(event) => {
                    const select = event.currentTarget
                    void run(() =>
                      chooseTheme(select.value as Theme).catch((error) => {
                        // The choice did not stick: show the account's theme again.
                        select.value = theme()
                        throw error
                      }),
                    )
                  }}
                >
                  <For each={themes}>{(option) => <option value={option}>{t(`settings.theme.${option}`)}</option>}</For>
                </select>
              </label>
            </div>
            <Show when={loaded().digest_time !== null}>
              <form
                class="settings-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  void changeDigestTime(digestTime())
                }}
              >
                <label>
                  {t('settings.digestTime')}
                  <input
                    type="time"
                    required
                    value={digestTime()}
                    aria-describedby="digest-time-note"
                    onInput={(event) => setDigestTime(event.currentTarget.value)}
                  />
                </label>
                <div id="digest-time-note" class="settings-note">
                  <p>{t('settings.digestTimeNote')}</p>
                  <Show when={loaded().digest_time_is_default}>
                    <p>{t('settings.digestTimeIsDefault')}</p>
                  </Show>
                </div>
                <div class="settings-actions">
                  <button type="submit" disabled={busy()}>
                    {t('settings.saveDigestTime')}
                  </button>
                  <Show when={!loaded().digest_time_is_default}>
                    <button type="button" disabled={busy()} onClick={() => changeDigestTime(null)}>
                      {t('settings.useDefaultDigestTime')}
                    </button>
                  </Show>
                </div>
              </form>
            </Show>
          </>
        )}
      </Show>
      <Switch>
        <Match when={outcome() === 'saved'}>
          <p role="status">{t('settings.saved')}</p>
        </Match>
        <Match when={outcome() === 'failed'}>
          <p role="alert">{t('settings.saveFailed')}</p>
        </Match>
      </Switch>
      <Show when={session.account()?.kind === 'teacher' && accountId()}>
        {(id) => <ProviderKeys api={api} accountId={id()} />}
      </Show>
    </section>
  )
}
