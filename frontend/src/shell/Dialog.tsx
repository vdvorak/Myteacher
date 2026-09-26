import { createUniqueId, onCleanup, onMount, type JSX } from 'solid-js'

const focusable = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'

/** A modal form opened on demand: the focus stays inside, Escape closes it, and the focus returns to
 * where it was once it closes. */
export function Dialog(props: { title: string; onClose: () => void; children: JSX.Element; class?: string }) {
  const id = createUniqueId()
  let dialog!: HTMLDivElement
  const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
  onMount(() => (dialog.querySelector<HTMLElement>(focusable) ?? dialog).focus())
  onCleanup(() => returnTo?.focus())

  function keepFocusInside(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      props.onClose()
      return
    }
    if (event.key !== 'Tab') return
    const inside = [...dialog.querySelectorAll<HTMLElement>(focusable)]
    const first = inside[0]
    const last = inside[inside.length - 1]
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
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        class={`dialog dialog-form ${props.class ?? ''}`}
        tabIndex={-1}
        onKeyDown={keepFocusInside}
      >
        <h2 id={`${id}-title`}>{props.title}</h2>
        {props.children}
      </div>
    </div>
  )
}
