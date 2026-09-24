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

  it('starts in the browser language when it is supported', () => {
    expect(browserLocale(['cs-CZ', 'en'])).toBe('cs')
    expect(browserLocale(['de-DE', 'en-GB'])).toBe('en')
    expect(browserLocale(['de'])).toBe('en')
  })
})
