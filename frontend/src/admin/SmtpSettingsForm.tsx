import { createEffect, createResource, createSignal, Match, Show, Switch } from 'solid-js'
import { useI18n } from '../i18n/i18n'
import { ApiError } from '../lesson/api'
import type { AdminApi, Security, SmtpSettingsUpdate } from './api'

type Outcome =
  | { kind: 'saved' }
  | { kind: 'invalid' }
  | { kind: 'failed' }
  | { kind: 'sent'; to: string }
  | { kind: 'notSent'; error: string }
  | null

/** SMTP settings of the instance and a test email to check they work. */
export function SmtpSettingsForm(props: { api: AdminApi; defaultRecipient: string }) {
  const { t, locale } = useI18n()
  const [stored, { mutate }] = createResource(() => props.api.readSmtp())
  const [host, setHost] = createSignal('')
  const [port, setPort] = createSignal('587')
  const [security, setSecurity] = createSignal<Security>('starttls')
  const [username, setUsername] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [removePassword, setRemovePassword] = createSignal(false)
  const [sender, setSender] = createSignal('')
  const [recipient, setRecipient] = createSignal(props.defaultRecipient)
  const [busy, setBusy] = createSignal(false)
  const [outcome, setOutcome] = createSignal<Outcome>(null)
  let filled = false

  // The fields start from the stored settings once; saving afterwards does not reset edits.
  createEffect(() => {
    const settings = stored()
    if (!settings || filled) return
    filled = true
    setHost(settings.host)
    setPort(String(settings.port))
    setSecurity(settings.security)
    setUsername(settings.username)
    setSender(settings.sender)
  })

  const sent = () => {
    const current = outcome()
    return current?.kind === 'sent' ? current : null
  }
  const notSent = () => {
    const current = outcome()
    return current?.kind === 'notSent' ? current : null
  }

  async function save(event: SubmitEvent) {
    event.preventDefault()
    const update: SmtpSettingsUpdate = {
      host: host(),
      port: Number(port()),
      security: security(),
      username: username(),
      sender: sender(),
    }
    if (removePassword()) update.password = ''
    else if (password() !== '') update.password = password()
    setBusy(true)
    setOutcome(null)
    try {
      mutate(await props.api.saveSmtp(update))
      setPassword('')
      setRemovePassword(false)
      setOutcome({ kind: 'saved' })
    } catch (error) {
      setOutcome({ kind: error instanceof ApiError && error.status === 422 ? 'invalid' : 'failed' })
    } finally {
      setBusy(false)
    }
  }

  async function sendTest(event: SubmitEvent) {
    event.preventDefault()
    const to = recipient()
    setBusy(true)
    setOutcome(null)
    try {
      const result = await props.api.sendTestEmail(to, locale())
      setOutcome(result.delivered ? { kind: 'sent', to } : { kind: 'notSent', error: result.error ?? '' })
    } catch (error) {
      setOutcome({ kind: error instanceof ApiError && error.status === 422 ? 'invalid' : 'failed' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section class="admin-section" aria-labelledby="smtp-heading">
      <h2 id="smtp-heading">{t('smtp.heading')}</h2>
      <Show when={stored.error}>
        <p role="alert">{t('smtp.loadFailed')}</p>
      </Show>
      <Show when={stored()}>
        <form class="settings-form" onSubmit={save}>
          <label>
            {t('smtp.host')}
            <input required value={host()} onInput={(e) => setHost(e.currentTarget.value)} />
          </label>
          <label>
            {t('smtp.port')}
            <input
              type="number"
              min="1"
              max="65535"
              required
              value={port()}
              onInput={(e) => setPort(e.currentTarget.value)}
            />
          </label>
          <label>
            {t('smtp.security')}
            <select value={security()} onChange={(e) => setSecurity(e.currentTarget.value as Security)}>
              <option value="starttls">{t('smtp.security.starttls')}</option>
              <option value="ssl">{t('smtp.security.ssl')}</option>
              <option value="none">{t('smtp.security.none')}</option>
            </select>
          </label>
          <label>
            {t('smtp.username')}
            <input autocomplete="off" value={username()} onInput={(e) => setUsername(e.currentTarget.value)} />
          </label>
          <label>
            {t('smtp.password')}
            <input
              type="password"
              autocomplete="new-password"
              value={password()}
              disabled={removePassword()}
              aria-describedby={stored()?.password_set ? 'smtp-password-note' : undefined}
              onInput={(e) => setPassword(e.currentTarget.value)}
            />
          </label>
          <Show when={stored()?.password_set}>
            <p id="smtp-password-note" class="settings-note">
              {t('smtp.passwordSet')}
            </p>
            <label class="settings-check">
              <input
                type="checkbox"
                checked={removePassword()}
                onChange={(e) => setRemovePassword(e.currentTarget.checked)}
              />
              {t('smtp.removePassword')}
            </label>
          </Show>
          <label>
            {t('smtp.sender')}
            <input type="email" required value={sender()} onInput={(e) => setSender(e.currentTarget.value)} />
          </label>
          <button type="submit" disabled={busy()}>
            {t('smtp.save')}
          </button>
        </form>
        <form class="settings-form" onSubmit={sendTest}>
          <label>
            {t('smtp.testRecipient')}
            <input type="email" required value={recipient()} onInput={(e) => setRecipient(e.currentTarget.value)} />
          </label>
          <button type="submit" disabled={busy() || !stored()?.configured}>
            {t('smtp.sendTest')}
          </button>
        </form>
      </Show>
      <Switch>
        <Match when={outcome()?.kind === 'saved'}>
          <p role="status">{t('smtp.saved')}</p>
        </Match>
        <Match when={outcome()?.kind === 'invalid'}>
          <p role="alert">{t('smtp.invalid')}</p>
        </Match>
        <Match when={outcome()?.kind === 'failed'}>
          <p role="alert">{t('smtp.requestFailed')}</p>
        </Match>
        <Match when={sent()}>
          {(result) => <p role="status">{t('smtp.testSent', { to: result().to })}</p>}
        </Match>
        <Match when={notSent()}>
          {(result) => <p role="alert">{t('smtp.testFailed', { error: result().error })}</p>}
        </Match>
      </Switch>
    </section>
  )
}
