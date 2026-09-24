import { useApi } from '../api/context'
import { useSession } from '../auth/session'
import { useI18n } from '../i18n/i18n'
import type { Locale } from '../i18n/messages'

/** Switch the interface at once and, when someone is signed in, store the choice on the account. */
export function useChooseLanguage(): (locale: Locale) => Promise<void> {
  const { setLocale } = useI18n()
  const session = useSession()
  const api = useApi().settings
  return async (locale) => {
    setLocale(locale)
    const account = session.account()
    if (!account) return
    const stored = await api.change(account.id, { language: locale })
    // The session may have changed meanwhile, for example by signing out; never revive it.
    const current = session.account()
    if (current?.id === account.id) session.updateAccount({ ...current, language: stored.language })
  }
}
