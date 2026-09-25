// Components take colours, fonts and spacing only from the token layer in tokens.css.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = join(import.meta.dirname, '..')

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

const colourLiteral = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(/i
const lengthLiteral = /(?<![\w.-])\d*\.?\d+(?:px|rem|em)\b/
const fontFamily = /font-family\s*:(?!\s*var\()/
const tokenFile = join(src, 'styles', 'tokens.css')

function declarations(css: string): string[] {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/[;{}]/)
    .map((part) => part.trim())
    .filter((part) => part.includes(':') && !part.startsWith('@'))
}

describe('token layer', () => {
  const stylesheets = files(src).filter((path) => path.endsWith('.css') && path !== tokenFile)

  it.each(stylesheets.map((path) => [relative(src, path), path]))(
    '%s uses tokens for colours, fonts and spacing',
    (_, path) => {
      const offending = declarations(readFileSync(path, 'utf8')).filter(
        (declaration) =>
          colourLiteral.test(declaration) ||
          lengthLiteral.test(declaration) ||
          fontFamily.test(declaration),
      )
      expect(offending).toEqual([])
    },
  )

  it('keeps inline styles out of components', () => {
    const components = files(src).filter((path) => path.endsWith('.tsx'))
    const withInlineStyles = components.filter((path) => /\sstyle=\{/.test(readFileSync(path, 'utf8')))
    expect(withInlineStyles.map((path) => relative(src, path))).toEqual([])
  })

  it('defines a dark variant for every colour token', () => {
    const tokens = readFileSync(tokenFile, 'utf8')
    const [light, ...rest] = tokens.split('@media')
    const lightColours = new Set(light.match(/--color-[\w-]+(?=:)/g))
    const darkColours = new Set(rest.join('').match(/--color-[\w-]+(?=:)/g))
    expect(darkColours).toEqual(lightColours)
  })

  it('prints in light colours whatever the screen theme', () => {
    const tokens = readFileSync(tokenFile, 'utf8')
    const colours = new Set(tokens.split('@media')[0].match(/--color-[\w-]+(?=:)/g))
    const print = new Set(tokens.split('@media print')[1].match(/--color-[\w-]+(?=:)/g))
    expect([...colours].filter((colour) => !print.has(colour))).toEqual([])
  })

  it('gives the device dark theme and the chosen dark theme the same colours', () => {
    const tokens = readFileSync(tokenFile, 'utf8')
    const device = tokens.split("@media (prefers-color-scheme: dark)")[1].split('}')[0]
    const chosen = tokens.split(":root[data-theme='dark']")[1].split('}')[0]
    const values = (block: string) => block.match(/--[\w-]+:[^;]+;/g)
    expect(values(device)).toEqual(values(chosen))
  })

  describe.each(['light', 'dark'] as const)('in the %s theme', (theme) => {
    const colours = themeColours(readFileSync(tokenFile, 'utf8'), theme)

    // WCAG AA: 4.5:1 for text; each surface the text sits on is checked.
    it.each([
      ['text', 'background'],
      ['text', 'surface'],
      ['text', 'surface-sunken'],
      ['text-muted', 'background'],
      ['text-muted', 'surface'],
      ['text-muted', 'surface-sunken'],
      ['accent', 'background'],
      ['accent', 'surface'],
      ['accent', 'accent-surface'],
      ['accent-text', 'accent'],
      ['text', 'accent-surface'],
      ['correct', 'correct-surface'],
      ['correct', 'surface'],
      ['incorrect', 'incorrect-surface'],
      ['incorrect', 'surface'],
      ['warning', 'warning-surface'],
      ['text', 'correct-surface'],
      ['text', 'incorrect-surface'],
      // A destructive button: surface-coloured text on the incorrect colour.
      ['surface', 'incorrect'],
    ])('%s on %s reads at AA', (foreground, background) => {
      expect(contrast(colours[foreground], colours[background])).toBeGreaterThanOrEqual(4.5)
    })

    it('draws the focus ring and borders of controls visibly', () => {
      expect(contrast(colours.focus, colours.background)).toBeGreaterThanOrEqual(3)
      expect(contrast(colours.focus, colours.surface)).toBeGreaterThanOrEqual(3)
    })
  })
})

/** The colour tokens of a theme: the light ones in the first rule, the dark ones in the explicit dark rule. */
function themeColours(css: string, theme: 'light' | 'dark'): Record<string, string> {
  const block = theme === 'light' ? css.split('@media')[0] : css.split(":root[data-theme='dark']")[1].split('}')[0]
  return Object.fromEntries([...block.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]))
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}
