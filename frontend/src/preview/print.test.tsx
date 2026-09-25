// jsdom does not apply print media, so these tests read the print rules from the stylesheets
// and check them against the rendered preview: every control must be hidden by a print rule.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnswerKey, AssessmentResult } from '../generated/lesson'
import vocabulary from '../../../schema/fixtures/es-vocabulario.public.json'
import type { LessonPublic } from '../generated/lesson'
import { LessonPlayer } from '../lesson/LessonPlayer'
import { fakeApi, sampleLesson, withI18n } from '../lesson/testing'
import { PreviewPage } from './PreviewPage'
import { createMemoryHistory } from '@solidjs/router'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import { cheatSheet, fakeDocumentsApi } from '../documents/testing'
import { fakeMaterialsApi, serEstarMaterial } from '../materials/testing'
import { admin, fakeAuthApi } from '../auth/testing'

// Previews open inside the app, for a signed-in teacher.
const signedIn = () => fakeAuthApi({ signedIn: { ...admin, roles: ['teacher'] } })

interface Rule {
  selector: string
  declarations: string
}

/** The rules inside every `@media print` block of the app's stylesheets. */
function printRules(): Rule[] {
  const sheets = ['preview/print.css', 'styles/tokens.css', 'shell/shell.css'].map((path) =>
    readFileSync(join(import.meta.dirname, '..', path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
  )
  const rules: Rule[] = []
  for (const css of sheets) {
    let at = css.indexOf('@media print')
    while (at !== -1) {
      const open = css.indexOf('{', at)
      let depth = 0
      let i = open
      do {
        if (css[i] === '{') depth++
        else if (css[i] === '}') depth--
        i++
      } while (depth > 0)
      const body = css.slice(open + 1, i - 1)
      for (const match of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        for (const selector of match[1].split(',')) {
          rules.push({ selector: selector.trim(), declarations: match[2] })
        }
      }
      at = css.indexOf('@media print', i)
    }
  }
  return rules
}

function matchesPrintRule(element: Element, declaration: RegExp): boolean {
  const rules = printRules().filter((rule) => declaration.test(rule.declarations))
  for (let node: Element | null = element; node; node = node.parentElement) {
    const current = node
    if (rules.some((rule) => current.matches(rule.selector))) return true
  }
  return false
}

const hiddenInPrint = (element: Element) => matchesPrintRule(element, /display\s*:\s*none/)

const answerKey: AnswerKey = {
  lesson_id: 'es-ser-estar',
  entries: [
    {
      exercise_id: 'location',
      solution: { type: 'multiple_choice', option_id: 'esta', explanation: 'Location takes **estar**.' },
    },
    { exercise_id: 'origin', solution: null },
  ],
}

const wrong: AssessmentResult = {
  status: 'assessed',
  exercise_id: 'location',
  score: 0,
  correct: false,
  solution: null,
}

function stubApi(keyResponse: () => Promise<Response> = async () => Response.json(answerKey)) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/lessons/es-ser-estar' && !init) return Response.json(sampleLesson)
    if (url === '/api/lessons/es-ser-estar/answer-key') return keyResponse()
    if (url.startsWith('/api/lessons/es-ser-estar/exercises/location/assessment?')) {
      return Response.json(wrong)
    }
    return new Response(null, { status: 404 })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const keyRequests = (fetch: ReturnType<typeof stubApi>) =>
  fetch.mock.calls.filter(([url]) => url.endsWith('/answer-key')).length

async function preview(keyResponse?: () => Promise<Response>) {
  const fetch = stubApi(keyResponse)
  const user = userEvent.setup()
  render(withI18n(() => <PreviewPage lessonId="es-ser-estar" seed="1" />))
  await screen.findByRole('heading', { level: 1 })
  return { fetch, user }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('printing the preview', () => {
  it('hides every control', async () => {
    await preview()

    const controls = [
      ...screen.getAllByRole('button'),
      ...screen.getAllByRole('radio'),
      ...screen.getAllByRole('combobox'),
      ...screen.getAllByRole('checkbox'),
    ]
    expect(controls.length).toBeGreaterThan(0)
    expect(controls.filter((control) => !hiddenInPrint(control))).toEqual([])
  })

  it('hides hints and result indicators', async () => {
    const { user } = await preview()
    const group = screen.getByRole('group', { name: /Madrid/ })

    await user.click(within(group).getByRole('radio', { name: 'es' }))
    await user.click(within(group).getByRole('button', { name: 'Confirm' }))

    expect(hiddenInPrint(await within(group).findByRole('note', { name: 'Hint' }))).toBe(true)
    expect(hiddenInPrint(within(group).getByRole('status'))).toBe(true)
  })

  it('keeps prompts and option texts as static text', async () => {
    await preview()
    const group = screen.getByRole('group', { name: /Madrid/ })

    expect(hiddenInPrint(within(group).getByText(/Madrid ___/))).toBe(false)
    expect(hiddenInPrint(within(group).getByText('está'))).toBe(false)
    expect(hiddenInPrint(screen.getByText(/two verbs/))).toBe(false)
  })

  it('keeps a word bank and its gaps on paper, so the exercise can be done in print', () => {
    const lesson = vocabulary as LessonPublic
    render(withI18n(() => <LessonPlayer lesson={lesson} seed="1" api={fakeApi(lesson)} />))
    const cloze = screen.getByRole('group', { name: /words from the bank/ })

    const bank = within(cloze).getByRole('group', { name: 'Word bank' })
    expect(hiddenInPrint(bank)).toBe(false)
    expect(within(bank).getAllByRole('button').filter(hiddenInPrint)).toEqual([])
    expect(hiddenInPrint(within(cloze).getByRole('button', { name: /^Gap 1:/ }))).toBe(false)
    expect(hiddenInPrint(within(cloze).getByRole('button', { name: 'Confirm' }))).toBe(true)
  })

  it('avoids breaking a page inside an exercise', async () => {
    await preview()

    for (const group of screen.getAllByRole('group')) {
      expect(matchesPrintRule(group, /break-inside\s*:\s*avoid/)).toBe(true)
    }
  })
})

describe('the answer key page', () => {
  it('is not fetched or shown unless requested', async () => {
    const { fetch } = await preview()

    expect(screen.queryByRole('region', { name: 'Answer key' })).not.toBeInTheDocument()
    expect(keyRequests(fetch)).toBe(0)
  })

  it('is appended on its own page when requested', async () => {
    const { fetch, user } = await preview()

    await user.click(screen.getByRole('checkbox', { name: 'Include answer key' }))

    const key = await screen.findByRole('region', { name: 'Answer key' })
    expect(keyRequests(fetch)).toBe(1)
    expect(matchesPrintRule(key, /break-before\s*:\s*page/)).toBe(true)
    expect(hiddenInPrint(key)).toBe(false)
    const items = within(key).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Madrid ___ en el centro de España.')
    expect(items[0]).toHaveTextContent('está')
    expect(items[0]).toHaveTextContent('Location takes estar.')
    expect(items[1]).toHaveTextContent('No answer key for this exercise type yet.')
  })

  it('goes away again when the option is turned off', async () => {
    const { user } = await preview()
    const option = screen.getByRole('checkbox', { name: 'Include answer key' })

    await user.click(option)
    await screen.findByRole('region', { name: 'Answer key' })
    await user.click(option)

    expect(screen.queryByRole('region', { name: 'Answer key' })).not.toBeInTheDocument()
  })

  it('prints through the browser', async () => {
    const print = vi.fn()
    vi.stubGlobal('print', print)
    const { user } = await preview()

    await user.click(screen.getByRole('button', { name: 'Print' }))

    expect(print).toHaveBeenCalledTimes(1)
  })

  it('reports a key that could not be loaded without breaking the lesson', async () => {
    const { user } = await preview(async () => new Response(null, { status: 500 }))

    await user.click(screen.getByRole('checkbox', { name: 'Include answer key' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The answer key could not be loaded.')
    expect(screen.getByRole('heading', { level: 1, name: 'Ser, or estar?' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Answer key' })).not.toBeInTheDocument()
  })

  it('cannot print until a requested key has arrived', async () => {
    let arrive: (response: Response) => void = () => {}
    const { user } = await preview(() => new Promise((resolve) => (arrive = resolve)))

    await user.click(screen.getByRole('checkbox', { name: 'Include answer key' }))

    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled()
    arrive(Response.json(answerKey))
    await screen.findByRole('region', { name: 'Answer key' })
    expect(screen.getByRole('button', { name: 'Print' })).toBeEnabled()
  })
})

describe('printing a reference document', () => {
  it('hides the controls and keeps the footnotes and the unsourced marks', async () => {
    const history = createMemoryHistory()
    history.set({ value: '/preview/courses/1/topics/2/documents/31' })
    const apis = fakeApis({ auth: signedIn(), documents: fakeDocumentsApi({ documents: { 2: [cheatSheet] } }) })
    render(withI18n(() => <App apis={apis} history={history} />, 'en'))

    await screen.findByRole('heading', { level: 1, name: 'Pretérito indefinido' })

    const controls = [...screen.getAllByRole('button'), ...screen.queryAllByRole('combobox')]
    expect(controls.length).toBeGreaterThan(0)
    for (const control of controls) expect(hiddenInPrint(control)).toBe(true)
    expect(hiddenInPrint(screen.getByText('Unsourced'))).toBe(false)
    expect(hiddenInPrint(screen.getByText(/rests on no source/))).toBe(false)
    expect(hiddenInPrint(screen.getByRole('list', { name: 'Sources' }))).toBe(false)
    for (const passage of screen.getAllByRole('article')) expect(hiddenInPrint(passage)).toBe(false)
  })
})

describe('printing classroom material', () => {
  it('puts the answer key on a page of its own and hides the controls', async () => {
    const history = createMemoryHistory()
    history.set({ value: '/preview/courses/1/topics/2/materials/41' })
    const apis = fakeApis({ auth: signedIn(), materials: fakeMaterialsApi({ materials: { 2: [serEstarMaterial] } }) })
    render(withI18n(() => <App apis={apis} history={history} />, 'en'))

    await screen.findByRole('heading', { level: 1, name: 'Ser, or estar?' })

    const key = screen.getByRole('region', { name: 'Answer key' })
    expect(matchesPrintRule(key, /break-before\s*:\s*page/)).toBe(true)
    expect(hiddenInPrint(key)).toBe(false)
    for (const control of screen.getAllByRole('button')) {
      if (!control.matches('.cloze-gap, .cloze-word, .ordering-token, .matching-item, .selection-token')) {
        expect(hiddenInPrint(control)).toBe(true)
      }
    }
    // The exercise prints, and its prompt again in the key.
    const prompts = screen.getAllByText('Madrid ___ en el centro de España.')
    expect(prompts).toHaveLength(2)
    for (const prompt of prompts) expect(hiddenInPrint(prompt)).toBe(false)
  })
})
