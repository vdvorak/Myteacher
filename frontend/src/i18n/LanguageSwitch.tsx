import { For } from 'solid-js'
import { useI18n } from './i18n'
import { localeNames, locales, type Locale } from './messages'

export function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n()
  return (
    <label>
      {t('language.label')}{' '}
      <select value={locale()} onChange={(event) => setLocale(event.currentTarget.value as Locale)}>
        <For each={locales}>{(code) => <option value={code}>{localeNames[code]}</option>}</For>
      </select>
    </label>
  )
}
