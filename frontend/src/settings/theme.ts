import { useApi } from '../api/context'
import { useSession } from '../auth/session'

/** 'system' follows the device's light or dark setting. */
export type Theme = 'light' | 'dark' | 'system'

export const themes: Theme[] = ['system', 'light', 'dark']

/** Where the page remembers the account's theme, read by index.html before the app loads. */
export const THEME_KEY = 'myteacher.theme'

/** Show the theme at once and remember it for the next page load. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Blocked storage only costs the early start; the account's theme applies after sign-in.
  }
}

/** Switch the theme at once and store it on the account; a failed save puts the account's back. */
export function useChooseTheme(): (theme: Theme) => Promise<void> {
  const session = useSession()
  const api = useApi().settings
  return async (theme) => {
    const account = session.account()
    if (!account) return
    applyTheme(theme)
    let stored
    try {
      stored = await api.change(account.id, { theme })
    } catch (error) {
      if (session.account()?.id === account.id) applyTheme(session.account()!.theme)
      throw error
    }
    // The session may have changed meanwhile, for example by signing out; never revive it.
    const current = session.account()
    if (current?.id === account.id) session.updateAccount({ ...current, theme: stored.theme })
  }
}
