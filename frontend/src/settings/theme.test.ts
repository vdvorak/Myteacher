// index.html sets the remembered theme before the app loads, so a dark page never flashes light.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { THEME_KEY } from './theme'

const page = readFileSync(join(import.meta.dirname, '..', '..', 'index.html'), 'utf8')
const early = page.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ''

describe('the theme at page load', () => {
  const root = document.documentElement

  afterEach(() => {
    delete root.dataset.theme
    localStorage.clear()
  })

  it('applies the remembered theme', () => {
    localStorage.setItem(THEME_KEY, 'dark')

    new Function(early)()

    expect(root.dataset.theme).toBe('dark')
  })

  it('follows the device when nothing is remembered or the value is unknown', () => {
    new Function(early)()
    expect(root.dataset.theme).toBeUndefined()

    localStorage.setItem(THEME_KEY, 'purple')
    new Function(early)()
    expect(root.dataset.theme).toBeUndefined()
  })
})
