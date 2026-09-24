import { A, Navigate, type RouteSectionProps } from '@solidjs/router'
import { createSignal, For, Match, Show, Switch } from 'solid-js'
import { useSession } from '../auth/session'
import { useI18n } from '../i18n/i18n'
import { LanguageSwitch } from '../i18n/LanguageSwitch'
import type { Locale, MessageKey } from '../i18n/messages'
import { useChooseLanguage } from '../settings/language'
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
  const [languageFailed, setLanguageFailed] = createSignal(false)
  const storeLanguage = useChooseLanguage()

  async function chooseLanguage(locale: Locale) {
    setLanguageFailed(false)
    try {
      await storeLanguage(locale)
    } catch {
      setLanguageFailed(true)
    }
  }

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
                <LanguageSwitch onChoose={chooseLanguage} />
                <button type="button" onClick={signOut}>
                  {t('auth.signOut')}
                </button>
              </div>
            </header>
            <nav class="shell-nav" aria-label={t('nav.label')}>
              <A href="/" end>
                {t('nav.home')}
              </A>
              <Show when={account().kind === 'teacher'}>
                <A href="/students">{t('nav.students')}</A>
                <A href="/classes">{t('nav.classes')}</A>
              </Show>
              <A href="/settings">{t('nav.settings')}</A>
              <Show when={account().roles.includes('admin')}>
                <A href="/admin">{t('nav.admin')}</A>
              </Show>
            </nav>
            <Show when={languageFailed()}>
              <p role="alert">{t('settings.languageFailed')}</p>
            </Show>
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
