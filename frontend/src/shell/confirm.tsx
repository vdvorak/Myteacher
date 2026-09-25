import {
  createContext,
  createEffect,
  createSignal,
  createUniqueId,
  on,
  onMount,
  Show,
  useContext,
  type ParentProps,
} from 'solid-js'
import { useI18n } from '../i18n/i18n'

/** What a destructive action asks before it is done. */
export interface ConfirmRequest {
  title: string
  body?: string
  /** The confirming button, naming the action: "Retract the release". */
  action: string
}

type Confirm = (request: ConfirmRequest) => Promise<boolean>

const ConfirmContext = createContext<Confirm>()

/** Hosts the one confirmation dialog of the app. `page` names the page shown: a question asked on a
 * page that is left is cancelled, so its action never runs on the page that follows. */
export function ConfirmProvider(props: ParentProps<{ page?: () => string }>) {
  const [asked, setAsked] = createSignal<{ request: ConfirmRequest; answer: (yes: boolean) => void } | null>(null)
  let returnTo: HTMLElement | null = null

  const confirm: Confirm = (request) =>
    new Promise((resolve) => {
      asked()?.answer(false)
      returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setAsked({ request, answer: resolve })
    })

  const answer = (yes: boolean) => {
    const current = asked()
    setAsked(null)
    returnTo?.focus()
    current?.answer(yes)
  }

  createEffect(
    on(
      () => props.page?.(),
      () => {
        if (asked()) answer(false)
      },
      { defer: true },
    ),
  )

  return (
    <ConfirmContext.Provider value={confirm}>
      {props.children}
      <Show when={asked()}>{(current) => <ConfirmDialog request={current().request} onAnswer={answer} />}</Show>
    </ConfirmContext.Provider>
  )
}

function ConfirmDialog(props: { request: ConfirmRequest; onAnswer: (yes: boolean) => void }) {
  const { t } = useI18n()
  const id = createUniqueId()
  let dialog!: HTMLDivElement
  let cancel!: HTMLButtonElement
  // Cancelling is the safe answer, so it has the focus first.
  onMount(() => cancel.focus())

  function keepFocusInside(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      props.onAnswer(false)
      return
    }
    if (event.key !== 'Tab') return
    const buttons = [...dialog.querySelectorAll('button')]
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div class="dialog-backdrop">
      <div
        ref={dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={props.request.body ? `${id}-body` : undefined}
        class="dialog dialog-danger"
        onKeyDown={keepFocusInside}
      >
        <h2 id={`${id}-title`}>{props.request.title}</h2>
        <Show when={props.request.body}>
          <p id={`${id}-body`}>{props.request.body}</p>
        </Show>
        <div class="dialog-actions">
          <button ref={cancel} type="button" class="button-secondary" onClick={() => props.onAnswer(false)}>
            {t('confirm.cancel')}
          </button>
          <button type="button" class="button-danger" onClick={() => props.onAnswer(true)}>
            {props.request.action}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Ask before a destructive action; resolves true only when the person confirms. */
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm must be used inside a ConfirmProvider')
  return confirm
}
