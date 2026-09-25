// A marked answer differs in more than colour (WCAG 1.4.1): the coral accent is close to the error red.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(import.meta.dirname, 'exercise.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selectors, body]) => ({
  selectors: selectors.split(',').map((s) => s.trim()),
  body,
}))

// Fields cannot hold a mark after them, so their border changes pattern instead.
const fields = ['exercise-text-input', 'cloze-gap-input']
const marked = [...new Set(css.match(/\.[\w-]+(?=\[data-state=)/g))].map((selector) => selector.slice(1))

describe('marked answers', () => {
  it.each(marked.flatMap((item) => [
    [item, 'correct'],
    [item, 'incorrect'],
  ]))('%s marked %s shows a symbol or a border pattern', (item, state) => {
    const shown = (selector: string, property: RegExp) =>
      rules.some((rule) => rule.selectors.includes(selector) && property.test(rule.body))
    const selector = `.${item}[data-state='${state}']`
    if (fields.includes(item)) {
      expect(state === 'correct' || shown(selector, /border-style\s*:\s*dashed/)).toBe(true)
    } else {
      expect(shown(`${selector}::after`, /content\s*:\s*'[✓✗]'/)).toBe(true)
    }
  })
})
