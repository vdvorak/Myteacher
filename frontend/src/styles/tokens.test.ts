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
})
