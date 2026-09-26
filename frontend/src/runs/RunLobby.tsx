import { createSignal, For, onCleanup, Show } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import { CopyLink } from '../shell/CopyLink'
import { Dialog } from '../shell/Dialog'
import { QrCode } from '../shell/QrCode'
import { joinUrl, type CourseRun, type Lobby } from './api'

/** How often the lobby asks who joined meanwhile. */
const POLL_MS = 5_000

/** A link run's participants: the join link to hand out, as text or a QR code to project, and the
 * lobby filling up as people join. */
export function RunLobby(props: { run: CourseRun; onCount?: (count: number) => void }) {
  const { t, locale } = useI18n()
  const api = useApi().runs
  // The last lobby read: a failed poll keeps what was shown, and the next one tries again.
  const [lobby, setLobby] = createSignal<Lobby>()
  const [failed, setFailed] = createSignal(false)
  async function load() {
    try {
      const found = await api.lobby(props.run.id)
      setLobby(found)
      setFailed(false)
      props.onCount?.(found.participants.length)
    } catch {
      setFailed(true)
    }
  }
  void load()
  const timer = setInterval(() => void load(), POLL_MS)
  onCleanup(() => clearInterval(timer))
  const [showingQr, setShowingQr] = createSignal(false)
  const url = () => joinUrl(props.run.join_token!)
  const time = (at: string) => new Date(at).toLocaleTimeString(locale(), { timeStyle: 'short' })

  return (
    <section class="lobby" aria-labelledby="lobby-heading">
      <div class="step-heading">
        <h2 id="lobby-heading">{t('runTabs.participants')}</h2>
      </div>
      <CopyLink label={t('lobby.joinLink')} url={url()} />
      <div class="settings-actions">
        <button type="button" onClick={() => setShowingQr(true)}>
          {t('lobby.showQr')}
        </button>
      </div>
      <Show when={failed() && !lobby()}>
        <p role="alert">{t('lobby.loadFailed')}</p>
      </Show>
      <Show when={lobby()}>
        {(found) => (
          <>
            <p class="lobby-count">
              <span aria-hidden="true">
                {t('lobby.count', { count: found().participants.length, capacity: found().capacity })}
              </span>
              <span class="visually-hidden">
                {t('lobby.countLabel', { count: found().participants.length, capacity: found().capacity })}
              </span>
            </p>
            <Show
              when={found().participants.length > 0}
              fallback={<p class="settings-note">{t('lobby.nobody')}</p>}
            >
              <ol class="lobby-list" aria-label={t('lobby.heading')}>
                <For each={found().participants}>
                  {(participant) => (
                    <li>
                      <span>{participant.name}</span>
                      <time class="settings-note" datetime={participant.joined_at}>
                        {time(participant.joined_at)}
                      </time>
                    </li>
                  )}
                </For>
              </ol>
            </Show>
          </>
        )}
      </Show>
      <Show when={showingQr()}>
        <Dialog title={props.run.name} onClose={() => setShowingQr(false)} class="qr-dialog">
          <QrCode text={url()} label={t('lobby.qrLabel')} />
          <p class="qr-url">{url()}</p>
          <div class="dialog-actions">
            <button type="button" onClick={() => setShowingQr(false)}>
              {t('lobby.close')}
            </button>
          </div>
        </Dialog>
      </Show>
    </section>
  )
}
