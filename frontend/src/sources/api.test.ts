import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpSourcesApi, SourceRefused, uploadType } from './api'

afterEach(() => vi.unstubAllGlobals())

const answer = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

describe('sources over HTTP', () => {
  it('names a text file the browser gave no type by its extension', () => {
    expect(uploadType(new File(['# x'], 'Unidad 1.MD'))).toBe('text/markdown')
    expect(uploadType(new File(['x'], 'notes.txt'))).toBe('text/plain')
    expect(uploadType(new File(['x'], 'scan.pdf', { type: 'application/pdf' }))).toBe('application/pdf')
    expect(uploadType(new File(['x'], 'unknown'))).toBe('application/octet-stream')
  })

  it('sends the file as the body, named in the query', async () => {
    const fetch = answer(202, { source: {}, job: {} })
    vi.stubGlobal('fetch', fetch)

    await httpSourcesApi.upload(3, new File(['# x'], 'Unidad 1.md'), true)

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/courses/3/sources?name=Unidad+1.md&ocr=true')
    expect(init.headers).toEqual({ 'Content-Type': 'text/markdown' })
  })

  it('sends pasted text as JSON', async () => {
    const fetch = answer(202, { source: {}, job: {} })
    vi.stubGlobal('fetch', fetch)

    await httpSourcesApi.addText(3, 'Unit 1', 'Hablé.')

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/courses/3/sources/text')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Unit 1', text: 'Hablé.' })
  })

  it('turns a known refusal into its reason and anything else into a plain failure', async () => {
    vi.stubGlobal('fetch', answer(415, { detail: 'unsupported_type' }))
    await expect(httpSourcesApi.upload(3, new File(['x'], 'a.svg'), false)).rejects.toEqual(
      new SourceRefused('unsupported_type'),
    )

    vi.stubGlobal('fetch', answer(422, { detail: 'something_new' }))
    await expect(httpSourcesApi.upload(3, new File(['x'], 'a.txt'), false)).rejects.not.toBeInstanceOf(SourceRefused)
  })
})
