import { Navigate, type RouteSectionProps } from '@solidjs/router'
import { createSignal, For, Match, Show, Switch } from 'solid-js'
import { useSession } from '../auth/session'
import { useI18n } from '../i18n/i18n'
import { LanguageSwitch } from '../i18n/LanguageSwitch'
import type { MessageKey } from '../i18n/messages'
import './shell.css'

const roleNames: Record<string, MessageKey> = {
  teacher: 'role.teacher',
  student: 'role.student',
  admin: 'role.admin',
}

/** The frame of every signed-in page; anonymous visitors are sent to the sign-in form. */
export function Shell(props: RouteSectionProps) {
  const { t } = useI18n()
  const session = useSession()
  const [signOutFailed, setSignOutFailed] = createSignal(false)

  async function signOut() {
    setSignOutFailed(false)
    try {
      await session.signOut()
    } catch {
      setSignOutFailed(true)
    }
  }

  return (
    <Switch>
      <Match when={session.loadFailed()}>
        <main class="page">
          <p role="alert">{t('auth.sessionFailed')}</p>
        </main>
      </Match>
      <Match when={session.account() === null}>
        <Navigate href="/sign-in" />
      </Match>
      <Match when={session.account()}>
        {(account) => (
          <div class="page">
            <header class="page-header shell-header">
              <span class="page-caption">{t('app.title')}</span>
              <div class="shell-account">
                <span>
                  {t('shell.signedInAs')} <strong>{account().email}</strong>
                </span>
                <ul class="shell-roles" aria-label={t('shell.roles')}>
                  <For each={account().roles}>
                    {(role) => <li>{role in roleNames ? t(roleNames[role]) : role}</li>}
                  </For>
                </ul>
                <LanguageSwitch />
                <button type="button" onClick={signOut}>
                  {t('auth.signOut')}
                </button>
              </div>
            </header>
            <Show when={signOutFailed()}>
              <p role="alert">{t('auth.signOutFailed')}</p>
            </Show>
            <main>{props.children}</main>
          </div>
        )}
      </Match>
    </Switch>
  )
}
