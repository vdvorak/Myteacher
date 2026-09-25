import { A, Navigate, useLocation, type RouteSectionProps } from '@solidjs/router'
import { createEffect, createResource, createSignal, For, Match, on, Show, Switch, type JSX } from 'solid-js'
import { useApi } from '../api/context'
import type { Account } from '../auth/api'
import { useSession } from '../auth/session'
import { useI18n } from '../i18n/i18n'
import { LanguageSwitch } from '../i18n/LanguageSwitch'
import type { Locale, MessageKey } from '../i18n/messages'
import { useChooseLanguage } from '../settings/language'
import { themes, useChooseTheme, type Theme } from '../settings/theme'
import { AssistantIndicator } from './Assistant'
import { Breadcrumbs, BreadcrumbsProvider } from './breadcrumbs'
import { Disclosure } from './Disclosure'
import './shell.css'

const roleNames: Record<string, MessageKey> = {
  teacher: 'role.teacher',
  student: 'role.student',
  admin: 'role.admin',
}

/** The frame of every signed-in page; anonymous visitors are sent to the sign-in form.
 * Teachers get the sidebar and breadcrumbs; students a plain page with their account menu. */
export function Shell(props: RouteSectionProps) {
  const { t } = useI18n()
  const session = useSession()
  const [failure, setFailure] = createSignal<MessageKey | null>(null)

  const attempt = (action: () => Promise<void>, failed: MessageKey) => async () => {
    setFailure(null)
    try {
      await action()
    } catch {
      setFailure(failed)
    }
  }

  const alerts = () => (
    <Show when={failure()}>{(key) => <p role="alert">{t(key())}</p>}</Show>
  )

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
      <Match when={session.account()?.kind === 'student' && session.account()}>
        {(account) => (
          <div class="page">
            <header class="app-topbar student-topbar">
              {/* Students have no sidebar: the app name leads home from any page. */}
              <A href="/" class="page-caption student-home-link">
                {t('app.title')}
              </A>
              <AccountMenu account={account()} attempt={attempt} />
            </header>
            {alerts()}
            <main>{props.children}</main>
          </div>
        )}
      </Match>
      <Match when={session.account()}>
        {(account) => (
          <BreadcrumbsProvider>
            <TeacherFrame account={account()} attempt={attempt} alerts={alerts()}>
              {props.children}
            </TeacherFrame>
          </BreadcrumbsProvider>
        )}
      </Match>
    </Switch>
  )
}

type Attempt = (action: () => Promise<void>, failed: MessageKey) => () => Promise<void>

function TeacherFrame(props: { account: Account; attempt: Attempt; alerts: JSX.Element; children: JSX.Element }) {
  const { t } = useI18n()
  const location = useLocation()
  const [navOpen, setNavOpen] = createSignal(false)
  let menuButton!: HTMLButtonElement
  const closeNav = () => {
    setNavOpen(false)
    menuButton.focus()
  }
  const onPeoplePages = () => /^\/(classes|students)(\/|$)/.test(location.pathname)
  const api = useApi().runs
  // How many runs the teacher teaches, beside the section in the navigation.
  const [taught, { refetch: recount }] = createResource(() => api.taught())
  // A run started or left elsewhere shows on the next page.
  createEffect(on(() => location.pathname, () => void recount(), { defer: true }))
  const runCount = () => (taught.error ? undefined : taught()?.length)
  const link = (
    href: string,
    label: MessageKey,
    extra: { end?: boolean; active?: boolean; count?: number } = {},
  ) => (
    <li>
      <A
        href={href}
        end={extra.end}
        classList={extra.active === undefined ? undefined : { active: extra.active }}
        onClick={() => setNavOpen(false)}
      >
        {t(label)}
        <Show when={extra.count}>
          <span class="nav-count">{extra.count}</span>
        </Show>
      </A>
    </li>
  )
  // Places for what later slices bring, so the navigation will not need redoing.
  const reserved = (label: MessageKey) => (
    <li class="nav-reserved">
      <span>{t(label)}</span> <span class="nav-later">{t('nav.later')}</span>
    </li>
  )
  const group = (label: MessageKey, items: JSX.Element) => (
    <div class="nav-group">
      <p class="nav-group-label" aria-hidden="true">
        {t(label)}
      </p>
      <ul aria-label={t(label)}>{items}</ul>
    </div>
  )

  return (
    <div
      class="app-shell"
      data-nav-open={navOpen()}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && navOpen()) closeNav()
      }}
    >
      <aside class="app-sidebar" id="app-sidebar">
        <span class="app-brand">{t('app.title')}</span>
        <nav aria-label={t('nav.label')}>
          <ul>{link('/', 'nav.home', { end: true })}</ul>
          {group('nav.group.preparation', link('/courses', 'nav.courses'))}
          {group(
            'nav.group.teaching',
            <>
              {link('/runs', 'nav.runs', { count: runCount() })}
              {reserved('nav.reviewQueue')}
              {reserved('nav.studentQuestions')}
            </>,
          )}
          {group('nav.group.people', link('/classes', 'nav.people', { active: onPeoplePages() }))}
          <ul class="nav-bottom">
            {link('/settings', 'nav.settings')}
            <Show when={props.account.roles.includes('admin')}>{link('/admin', 'nav.admin')}</Show>
          </ul>
        </nav>
      </aside>
      {/* On a narrow screen the open sidebar covers the page; a tap beside it closes it. */}
      <Show when={navOpen()}>
        <button type="button" class="app-scrim" aria-label={t('nav.close')} onClick={closeNav} />
      </Show>
      <div class="app-main">
        <header class="app-topbar">
          <button
            ref={menuButton}
            type="button"
            class="app-menu-button"
            aria-expanded={navOpen()}
            aria-controls="app-sidebar"
            onClick={() => setNavOpen(!navOpen())}
          >
            {t('nav.menu')}
          </button>
          <Breadcrumbs />
          <AssistantIndicator />
          <AccountMenu account={props.account} attempt={props.attempt} />
        </header>
        {props.alerts}
        <main class="app-content">{props.children}</main>
      </div>
    </div>
  )
}

function initials(account: Account): string {
  const source = account.name ?? account.email
  const words = source.split(/[\s@._-]+/).filter(Boolean)
  return words
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('')
}

/** Who is signed in, their language and theme, and signing out. */
function AccountMenu(props: { account: Account; attempt: Attempt }) {
  const { t } = useI18n()
  const session = useSession()
  const chooseLanguage = useChooseLanguage()
  const chooseTheme = useChooseTheme()
  const signOut = props.attempt(() => session.signOut(), 'auth.signOutFailed')

  return (
    <Disclosure
      class="account-menu"
      label={<span class="avatar" aria-hidden="true">{initials(props.account)}</span>}
      name={t('shell.account', { email: props.account.email })}
    >
      {() => (
        <div class="account-panel">
          <p>
            {t('shell.signedInAs')} <strong>{props.account.email}</strong>
          </p>
          <ul class="shell-roles" aria-label={t('shell.roles')}>
            <For each={props.account.roles}>{(role) => <li>{role in roleNames ? t(roleNames[role]) : role}</li>}</For>
          </ul>
          <LanguageSwitch
            onChoose={(locale: Locale) => void props.attempt(() => chooseLanguage(locale), 'settings.languageFailed')()}
          />
          <label>
            {t('settings.theme')}{' '}
            <select
              value={props.account.theme}
              onChange={(event) => {
                const select = event.currentTarget
                void props.attempt(
                  () =>
                    chooseTheme(select.value as Theme).catch((error) => {
                      select.value = props.account.theme
                      throw error
                    }),
                  'settings.themeFailed',
                )()
              }}
            >
              <For each={themes}>{(option) => <option value={option}>{t(`settings.theme.${option}`)}</option>}</For>
            </select>
          </label>
          {/* Students have no sidebar; their settings are reached from here. */}
          <Show when={props.account.kind === 'student'}>
            <A href="/settings">{t('nav.settings')}</A>
          </Show>
          <button type="button" onClick={signOut}>
            {t('auth.signOut')}
          </button>
        </div>
      )}
    </Disclosure>
  )
}
