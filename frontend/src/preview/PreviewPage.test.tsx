import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssessmentResult } from '../generated/lesson'
import { sampleLesson, withI18n } from '../lesson/testing'
import { PreviewPage } from './PreviewPage'

const assessment: AssessmentResult = {
  exercise_id: 'location',
  score: 0,
  correct: false,
  solution: { type: 'multiple_choice', option_id: 'esta', explanation: null },
}

function stubApi() {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/lessons/es-ser-estar' && !init) return Response.json(sampleLesson)
    if (url === '/api/lessons/es-ser-estar/exercises/location/assessment') {
      return Response.json(assessment)
    }
    return new Response(null, { status: 404 })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PreviewPage', () => {
  it('renders the lesson served by the API', async () => {
    stubApi()
    render(withI18n(() => <PreviewPage lessonId="es-ser-estar" seed="1" />))

    expect(await screen.findByRole('heading', { name: 'Ser, or estar?' })).toBeInTheDocument()
    expect(screen.getByText('ser')).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(4)
  })

  it("shows the backend's assessment after confirming", async () => {
    const fetch = stubApi()
    const user = userEvent.setup()
    render(withI18n(() => <PreviewPage lessonId="es-ser-estar" seed="1" />))

    await user.click(await screen.findByRole('radio', { name: 'son' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText('Not quite')).toBeInTheDocument()
    const [, init] = fetch.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(init!.body as string)).toEqual({ type: 'multiple_choice', option_id: 'son' })
  })

  it('tells the teacher when there is no such lesson', async () => {
    stubApi()
    render(withI18n(() => <PreviewPage lessonId="missing" seed="1" />))

    expect(await screen.findByRole('alert')).toHaveTextContent('No lesson to preview here.')
  })

  it('switches interface strings between English and Czech', async () => {
    stubApi()
    const user = userEvent.setup()
    render(withI18n(() => <PreviewPage lessonId="es-ser-estar" seed="1" />))
    expect(await screen.findByRole('button', { name: 'Confirm' })).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'cs')

    expect(screen.getByRole('button', { name: 'Potvrdit' })).toBeInTheDocument()
    expect(screen.getByText('Náhled lekce')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Jazyk' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('cs')
  })
})
