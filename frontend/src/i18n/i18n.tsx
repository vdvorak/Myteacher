import { createContext, createEffect, createSignal, useContext, type ParentProps } from 'solid-js'
import { locales, messages, type Locale, type MessageKey } from './messages'

export function browserLocale(languages: readonly string[] = navigator.languages): Locale {
  for (const language of languages) {
    const base = language.toLowerCase().split('-')[0]
    const match = locales.find((locale) => locale === base)
    if (match) return match
  }
  return 'en'
}

interface I18n {
  locale: () => Locale
  setLocale: (locale: Locale) => void
  /** The message for `key`, with `{name}` placeholders filled from `params`. */
  t: (key: MessageKey, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18n>()

export function I18nProvider(props: ParentProps<{ initialLocale?: Locale }>) {
  const [locale, setLocale] = createSignal<Locale>(props.initialLocale ?? browserLocale())
  const t = (key: MessageKey, params: Record<string, string | number> = {}) =>
    messages[locale()][key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
      name in params ? String(params[name]) : placeholder,
    )
  // Screen readers pronounce the interface by the document language.
  createEffect(() => document.documentElement.setAttribute('lang', locale()))
  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>{props.children}</I18nContext.Provider>
  )
}

export function useI18n(): I18n {
  const i18n = useContext(I18nContext)
  if (!i18n) throw new Error('useI18n must be used inside an I18nProvider')
  return i18n
}
