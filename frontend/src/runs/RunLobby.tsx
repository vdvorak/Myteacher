import { createSignal, For, onCleanup, Show } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import { useConfirm } from '../shell/confirm'
import { CopyLink } from '../shell/CopyLink'
import { Dialog } from '../shell/Dialog'
import { QrCode } from '../shell/QrCode'
import { joinUrl, type CourseRun, type Lobby } from './api'

/** How often the lobby asks who joined meanwhile. */
const POLL_MS = 5_000

type Participant = Lobby['participants'][number]

/** A link run's participants: the join link to hand out, as text or a QR code to project, the
 * lobby filling up as people join, and closing it, replacing the link, renaming and removing. */
export function RunLobby(props: {
  run: CourseRun
  onCount?: (count: number) => void
  onChanged?: (run: CourseRun) => void
}) {
  const { t, locale } = useI18n()
  const api = useApi().runs
  const confirm = useConfirm()
  // The last lobby read, merged by id so a poll keeps the rows and the focus in them; a failed
  // poll keeps what was shown, and the next one tries again.
  const [lobby, setLobby] = createStore<{ found?: Lobby }>({})
  const [failed, setFailed] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [actionFailed, setActionFailed] = createSignal(false)
  const [renaming, setRenaming] = createSignal<Participant>()
  // Said once a participant is gone, where their row was.
  const [removed, setRemoved] = createSignal<string>()
  let heading!: HTMLHeadingElement
  async function load() {
    try {
      const found = await api.lobby(props.run.id)
      setLobby('found', reconcile(found, { key: 'id' }))
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

  async function act(action: () => Promise<unknown>) {
    setBusy(true)
    setActionFailed(false)
    try {
      await action()
      return true
    } catch {
      setActionFailed(true)
      return false
    } finally {
      setBusy(false)
    }
  }
  const changeRun = (action: () => Promise<CourseRun>) => act(async () => props.onChanged?.(await action()))

  async function replaceLink() {
    const replacing = await confirm({
      title: t('lobby.confirmReplace'),
      body: t('lobby.replaceNote'),
      action: t('lobby.replace'),
    })
    if (replacing) await changeRun(() => api.replaceJoinLink(props.run.id))
  }

  async function remove(participant: Participant) {
    const removing = await confirm({
      title: t('lobby.confirmRemove', { name: participant.name }),
      body: t('lobby.removeNote'),
      action: t('lobby.remove'),
    })
    if (!removing || !(await act(() => api.removeParticipant(props.run.id, participant.id)))) return
    await load()
    setRemoved(participant.name)
    // The row and its button are gone: the focus goes back to the top of the lobby.
    heading.focus()
  }

  return (
    <section class="lobby" aria-labelledby="lobby-heading">
      <div class="step-heading">
        <h2 id="lobby-heading" ref={heading} tabIndex={-1}>
          {t('runTabs.participants')}
        </h2>
      </div>
      <CopyLink label={t('lobby.joinLink')} url={url()} />
      <div class="settings-actions">
        <button type="button" onClick={() => setShowingQr(true)}>
          {t('lobby.showQr')}
        </button>
        <button type="button" class="button-secondary" disabled={busy()} onClick={() => void replaceLink()}>
          {t('lobby.replace')}
        </button>
        {/* Once the participants' data is deleted, joining stays closed for good. */}
        <Show when={!props.run.participants_erased_at}>
          <button
            type="button"
            class="button-secondary"
            disabled={busy()}
            onClick={() => void changeRun(() => api.setJoining(props.run.id, !props.run.joining_open))}
          >
            {t(props.run.joining_open ? 'lobby.closeJoining' : 'lobby.openJoining')}
          </button>
        </Show>
      </div>
      <Show when={!props.run.joining_open}>
        <p role="status">{t('lobby.closed')}</p>
      </Show>
      <Show when={actionFailed() && !renaming()}>
        <p role="alert">{t('lobby.actionFailed')}</p>
      </Show>
      <p role="status" class="visually-hidden">
        <Show when={removed()}>{(name) => t('lobby.removed', { name: name() })}</Show>
      </p>
      <Show when={failed() && !lobby.found}>
        <p role="alert">{t('lobby.loadFailed')}</p>
      </Show>
      <Show when={lobby.found}>
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
                      {/* A personal link opened on more than one device may have been passed on. */}
                      <Show when={participant.devices > 1}>
                        <span class="settings-note">{t('lobby.devices', { count: participant.devices })}</span>
                      </Show>
                      <button
                        type="button"
                        class="link-button"
                        disabled={busy()}
                        aria-label={t('lobby.renameNamed', { name: participant.name })}
                        onClick={() => setRenaming({ ...participant })}
                      >
                        {t('lobby.rename')}
                      </button>
                      <button
                        type="button"
                        class="link-button"
                        disabled={busy()}
                        aria-label={t('lobby.removeNamed', { name: participant.name })}
                        onClick={() => void remove(participant)}
                      >
                        {t('lobby.remove')}
                      </button>
                    </li>
                  )}
                </For>
              </ol>
            </Show>
          </>
        )}
      </Show>
      <Show when={renaming()} keyed>
        {(participant) => (
          <RenameDialog
            participant={participant}
            busy={busy()}
            failed={actionFailed()}
            onClose={() => {
              setRenaming(undefined)
              setActionFailed(false)
            }}
            onRename={async (name) => {
              if (await act(() => api.renameParticipant(props.run.id, participant.id, name))) {
                setRenaming(undefined)
                await load()
              }
            }}
          />
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

function RenameDialog(props: {
  participant: Participant
  busy: boolean
  failed: boolean
  onClose: () => void
  onRename: (name: string) => void
}) {
  const { t } = useI18n()
  const [name, setName] = createSignal(props.participant.name)
  return (
    <Dialog title={t('lobby.renameTitle', { name: props.participant.name })} onClose={props.onClose}>
      <form
        class="settings-form"
        onSubmit={(event) => {
          event.preventDefault()
          // `required` lets a name of spaces through.
          if (name().trim() !== '') props.onRename(name().trim())
        }}
      >
        <label>
          {t('lobby.newName')}
          <input required maxLength={60} value={name()} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <Show when={props.failed}>
          <p role="alert">{t('lobby.actionFailed')}</p>
        </Show>
        <div class="dialog-actions">
          <button type="button" class="button-secondary" onClick={props.onClose}>
            {t('lobby.cancel')}
          </button>
          <button type="submit" disabled={props.busy}>
            {t('lobby.rename')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
