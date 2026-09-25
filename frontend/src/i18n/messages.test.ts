import { describe, expect, it } from 'vitest'
import { browserLocale } from './i18n'
import { messages } from './messages'

describe('message catalogue', () => {
  it('has a non-empty string for every key in every language', () => {
    const keys = Object.keys(messages.en)
    for (const catalogue of Object.values(messages)) {
      expect(Object.keys(catalogue).sort()).toEqual([...keys].sort())
      expect(Object.values(catalogue).every((text) => text.trim().length > 0)).toBe(true)
    }
  })

  it('addresses students with “ty” in Czech (#97)', () => {
    // The student's pages, and what a student meets in the account menu.
    const studentFacing =
      /^(home\.student|work\.|lesson\.|exercise\.|openText\.|shortAnswer\.|matching\.|ordering\.|selection\.|cloze\.|review\.|auth\.signOutFailed|settings\.theme|settings\.languageFailed)/
    const formal = /\b(Zkuste|zkuste|Vaš|vaš|vám|Vám|váš|Váš|Můžete|můžete|najdete|Dobrý den|Vyberte|vyberte|Přiřaďte|Klepejte)/
    const offending = Object.entries(messages.cs).filter(([key, text]) => studentFacing.test(key) && formal.test(text))
    expect(offending).toEqual([])
  })

  it('starts in the browser language when it is supported', () => {
    expect(browserLocale(['cs-CZ', 'en'])).toBe('cs')
    expect(browserLocale(['de-DE', 'en-GB'])).toBe('en')
    expect(browserLocale(['de'])).toBe('en')
  })
})
