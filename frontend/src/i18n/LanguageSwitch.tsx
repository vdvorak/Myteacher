import { For } from 'solid-js'
import { useI18n } from './i18n'
import { localeNames, locales, type Locale } from './messages'

/** Switches the interface language; `onChoose` replaces the plain switch, e.g. to store it too. */
export function LanguageSwitch(props: { onChoose?: (locale: Locale) => void }) {
  const { locale, setLocale, t } = useI18n()
  const choose = (code: Locale) => (props.onChoose ?? setLocale)(code)
  return (
    <label>
      {t('language.label')}{' '}
      <select value={locale()} onChange={(event) => choose(event.currentTarget.value as Locale)}>
        <For each={locales}>{(code) => <option value={code}>{localeNames[code]}</option>}</For>
      </select>
    </label>
  )
}
