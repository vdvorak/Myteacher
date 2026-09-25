import { Show, type JSX } from 'solid-js'
import { useI18n } from '../i18n/i18n'
import { Disclosure } from './Disclosure'

/** The top of a page: its title, a muted line saying what it is, one main action, rarer ones in a menu. */
export function PageHeader(props: {
  title: JSX.Element
  meta?: JSX.Element
  action?: JSX.Element
  /** Rarer actions, shown in "More actions". */
  more?: JSX.Element
}) {
  const { t } = useI18n()
  return (
    <header class="page-heading">
      <div class="page-heading-text">
        <h1>{props.title}</h1>
        <Show when={props.meta}>
          <p class="page-meta">{props.meta}</p>
        </Show>
      </div>
      <Show when={props.action || props.more}>
        <div class="page-heading-actions">
          <Show when={props.more}>
            <Disclosure
              label={
                <>
                  {t('page.moreActions')} <span aria-hidden="true">▾</span>
                </>
              }
              name={t('page.moreActions')}
              class="more-actions"
            >
              {() => props.more}
            </Disclosure>
          </Show>
          {props.action}
        </div>
      </Show>
    </header>
  )
}
