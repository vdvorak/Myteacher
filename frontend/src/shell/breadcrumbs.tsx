import { A } from '@solidjs/router'
import { createContext, createEffect, createSignal, For, onCleanup, Show, useContext, type ParentProps } from 'solid-js'
import { useI18n } from '../i18n/i18n'

/** One step of the way to the current page; the last one is the page itself and has no link. */
export interface Crumb {
  label: string
  href?: string
}

interface Trail {
  crumbs(): Crumb[]
  set(owner: object, crumbs: Crumb[]): void
  clear(owner: object): void
}

const TrailContext = createContext<Trail>()

export function BreadcrumbsProvider(props: ParentProps) {
  const [current, setCurrent] = createSignal<{ owner: object; crumbs: Crumb[] } | null>(null)
  const trail: Trail = {
    crumbs: () => current()?.crumbs ?? [],
    set: (owner, crumbs) => setCurrent({ owner, crumbs }),
    // A page left after the next one set its trail must not wipe the next one's.
    clear: (owner) => {
      if (current()?.owner === owner) setCurrent(null)
    },
  }
  return <TrailContext.Provider value={trail}>{props.children}</TrailContext.Provider>
}

/** Shows the page's place in the app above it; pages outside the shell have none. */
export function useBreadcrumbs(crumbs: () => Crumb[]) {
  const trail = useContext(TrailContext)
  if (!trail) return
  const owner = {}
  createEffect(() => trail.set(owner, crumbs()))
  onCleanup(() => trail.clear(owner))
}

export function Breadcrumbs() {
  const { t } = useI18n()
  const trail = useContext(TrailContext)
  return (
    <Show when={trail && trail.crumbs().length > 0}>
      <nav class="breadcrumbs" aria-label={t('breadcrumbs.label')}>
        <ol>
          <For each={trail!.crumbs()}>
            {(crumb, index) => (
              <li>
                <Show
                  when={crumb.href !== undefined && index() < trail!.crumbs().length - 1}
                  fallback={<span aria-current="page">{crumb.label}</span>}
                >
                  <A href={crumb.href!}>{crumb.label}</A>
                </Show>
              </li>
            )}
          </For>
        </ol>
      </nav>
    </Show>
  )
}
