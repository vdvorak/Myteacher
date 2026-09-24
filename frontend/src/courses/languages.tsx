import { For } from 'solid-js'
import { useI18n } from '../i18n/i18n'

/** The languages a course is usually taught in or about; a stored other one is offered too. */
const common = ['cs', 'sk', 'en', 'de', 'es', 'fr', 'it', 'pl', 'ru', 'la']

/** A language picker by tag, named in the interface language. `none` stands for no language. */
export function LanguageSelect(props: {
  label: string
  value: string | null
  noneLabel?: string
  onChange: (tag: string | null) => void
}) {
  const { locale } = useI18n()
  const name = (tag: string) => {
    try {
      return new Intl.DisplayNames([locale()], { type: 'language' }).of(tag) ?? tag
    } catch {
      return tag
    }
  }
  const tags = () => {
    const all = props.value && !common.includes(props.value) ? [...common, props.value] : common
    return [...all].sort((a, b) => name(a).localeCompare(name(b), locale()))
  }
  return (
    <label>
      {props.label}
      <select
        required
        value={props.value ?? (props.noneLabel ? 'none' : '')}
        onChange={(e) => props.onChange(e.currentTarget.value === 'none' ? null : e.currentTarget.value)}
      >
        {props.noneLabel ? <option value="none">{props.noneLabel}</option> : <option value="" disabled />}
        <For each={tags()}>{(tag) => <option value={tag}>{name(tag)}</option>}</For>
      </select>
    </label>
  )
}
