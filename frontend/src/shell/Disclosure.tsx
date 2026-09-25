import { createSignal, createUniqueId, onCleanup, onMount, Show, type JSX } from 'solid-js'

/** A button that shows a panel below it; Escape or a click elsewhere hides it again. */
export function Disclosure(props: {
  label: JSX.Element
  /** The button's accessible name when its label is not text, e.g. initials. */
  name?: string
  class?: string
  children: (close: () => void) => JSX.Element
}) {
  const [open, setOpen] = createSignal(false)
  const id = createUniqueId()
  let root!: HTMLDivElement
  let button!: HTMLButtonElement

  const close = () => setOpen(false)
  onMount(() => {
    const outside = (event: PointerEvent) => {
      if (open() && !root.contains(event.target as Node)) close()
    }
    document.addEventListener('pointerdown', outside)
    onCleanup(() => document.removeEventListener('pointerdown', outside))
  })

  return (
    <div
      ref={root}
      class={`disclosure ${props.class ?? ''}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open()) {
          close()
          button.focus()
        }
      }}
    >
      <button
        ref={button}
        type="button"
        class="disclosure-button"
        aria-expanded={open()}
        aria-controls={id}
        aria-label={props.name}
        onClick={() => setOpen(!open())}
      >
        {props.label}
      </button>
      <Show when={open()}>
        <div id={id} class="disclosure-panel">
          {props.children(close)}
        </div>
      </Show>
    </div>
  )
}
