import { A } from '@solidjs/router'
import { For, Show } from 'solid-js'
import { useI18n } from '../i18n/i18n'
import type { MessageKey } from '../i18n/messages'

/** done: finished; next: what to do now; open: may be done any time; locked: waits for another step. */
export type StepState = 'done' | 'next' | 'open' | 'locked'

export interface Tab {
  id: string
  label: string
  /** Numbered steps show their state; the other tabs follow a divider. */
  step?: { number: number; state: StepState; note?: string }
}

const stateNames: Record<StepState, MessageKey> = {
  done: 'steps.done',
  next: 'steps.next',
  open: 'steps.open',
  locked: 'steps.locked',
}

/** The tabs of a workspace, each a link keeping its place in the address. */
export function StepTabs(props: { label: string; tabs: Tab[]; current: string; href: (id: string) => string }) {
  const { t } = useI18n()
  const steps = () => props.tabs.filter((tab) => tab.step)
  const others = () => props.tabs.filter((tab) => !tab.step)
  const link = (tab: Tab) => (
    <li>
      {/* A plain link: the router's A marks every tab current, as they share the path. */}
      <a
        href={props.href(tab.id)}
        class="step-tab"
        aria-current={tab.id === props.current ? 'page' : undefined}
        data-state={tab.step?.state}
      >
        <Show when={tab.step}>
          {(step) => (
            <span class="step-mark" aria-hidden="true">
              {step().state === 'done' ? '✓' : step().number}
            </span>
          )}
        </Show>
        <span>{tab.label}</span>
        <Show when={tab.step}>
          {(step) => (
            <>
              <span class="visually-hidden">, {t(stateNames[step().state])}</span>
              <Show when={step().note}>
                <span class="step-note">{step().note}</span>
              </Show>
            </>
          )}
        </Show>
      </a>
    </li>
  )
  return (
    <nav class="step-tabs" aria-label={props.label}>
      <ol>
        <For each={steps()}>{link}</For>
      </ol>
      <Show when={others().length > 0}>
        <ul>
          <For each={others()}>{link}</For>
        </ul>
      </Show>
    </nav>
  )
}

/** One sentence and one button saying what to do next; nothing when there is nothing to suggest.
 * The button is left out when it leads to `here`, the tab already open. */
export function NextStep(props: { sentence?: string; action?: { label: string; href: string }; here?: string }) {
  const { t } = useI18n()
  return (
    <Show when={props.sentence}>
      <aside class="next-step" aria-label={t('steps.nextStep')}>
        <p>
          <strong>{t('steps.nextStep')}:</strong> {props.sentence}
        </p>
        <Show when={props.action?.href !== props.here && props.action}>
          {(action) => (
            <A class="button-link" href={action().href}>
              {action().label}
            </A>
          )}
        </Show>
      </aside>
    </Show>
  )
}
