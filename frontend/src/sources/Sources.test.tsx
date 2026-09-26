import { createMemoryHistory } from '@solidjs/router'
import { render, screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { fakeAuthApi, invitedTeacher } from '../auth/testing'
import type { Course } from '../courses/api'
import { fakeCoursesApi, spanish } from '../courses/testing'
import { fakeJobsApi } from '../jobs/testing'
import { withI18n } from '../lesson/testing'
import { SourceRefused, type SourceDetail } from './api'
import { fakeSourcesApi, textbook, type ScriptedExtraction, type ScriptedPage } from './testing'

const teacher: Account = { ...invitedTeacher, language: 'en' }
const viewer: Course = { ...spanish, access: 'view', can_edit: false, can_manage_access: false }

function renderSources(
  options: {
    course?: Course
    sources?: SourceDetail[]
    hasKey?: boolean
    extractions?: ScriptedExtraction[]
    pages?: Record<string, ScriptedPage>
  } = {},
) {
  const course = options.course ?? spanish
  const history = createMemoryHistory()
  history.set({ value: `/courses/${course.id}?tab=sources` })
  const jobs = fakeJobsApi()
  const sources = fakeSourcesApi({
    sources: { [course.id]: options.sources ?? [textbook] },
    jobs,
    hasKey: options.hasKey,
    extractions: options.extractions,
    pages: options.pages,
  })
  const apis = fakeApis({
    auth: fakeAuthApi({ signedIn: teacher }),
    courses: fakeCoursesApi({ courses: [course] }),
    sources,
    jobs,
  })
  render(withI18n(() => <App apis={apis} history={history} />, 'en'))
  return { sources, jobs }
}

const section = async () => within(await screen.findByRole('region', { name: 'Sources' }))
const item = async (name: string) => within(await (await section()).findByRole('article', { name }))

/** Open the one place to add a source, on the kind given. */
async function adding(kind: 'A file' | 'A web page' | 'Pasted text', user = userEvent.setup()) {
  const sources = await section()
  const open = sources.queryByRole('button', { name: 'Add a source' })
  if (open) await user.click(open)
  await user.click(sources.getByRole('radio', { name: kind }))
  return user
}

async function upload(file: File, options: { ocr?: boolean } = {}) {
  const user = await adding('A file')
  const sources = await section()
  await user.upload(sources.getByLabelText('File'), file)
  if (options.ocr) await user.click(sources.getByRole('checkbox', { name: /read images and scanned pdfs/i }))
  await user.click(sources.getByRole('button', { name: 'Upload' }))
  return user
}

describe('course sources', () => {
  it('lists the sources with what was read from them', async () => {
    renderSources()

    const source = await item('Učebnice, kapitola 1.pdf')
    expect(source.getByText('PDF, 240 KB')).toBeInTheDocument()
    expect(source.getByText('27 characters read from the file.')).toBeInTheDocument()
    expect(source.getByRole('link', { name: 'Open the original' })).toHaveAttribute(
      'href',
      '/api/courses/1/sources/1/file',
    )
  })

  it('shows the extracted text: what the assistant will read', async () => {
    const { sources } = renderSources()
    const user = userEvent.setup()
    const source = await item('Učebnice, kapitola 1.pdf')

    await user.click(source.getByRole('button', { name: 'Show the text' }))

    expect(sources.get).toHaveBeenCalledWith(1, 1)
    expect(await source.findByText(/El presente de ser/)).toBeInTheDocument()
    await user.click(source.getByRole('button', { name: 'Hide the text' }))
    expect(source.queryByText(/El presente de ser/)).not.toBeInTheDocument()
  })

  it('says what the sources are for, and where a test becomes classroom material', async () => {
    renderSources()

    const sources = await section()
    expect(
      sources.getByText(/when the assistant generates classroom material or reference documents, it draws on/i),
    ).toBeInTheDocument()
    expect(sources.getByText(/A test or worksheet you want to use as it is/)).toHaveTextContent('Create from a source')
    expect(sources.getByRole('link', { name: 'Go to the course topics' })).toHaveAttribute('href', '/courses/1?tab=topics')
  })

  it('says a source stored for a transcription is not read yet', async () => {
    const stored: SourceDetail = { ...textbook, characters: null, text: null, extracted_with: null, job: null }
    renderSources({ sources: [stored] })

    const source = await item('Učebnice, kapitola 1.pdf')
    expect(await source.findByText('Not read yet: it is read when it is transcribed.')).toBeInTheDocument()
  })

  it('says when there are no sources yet', async () => {
    renderSources({ sources: [] })

    expect(await (await section()).findByText('No sources yet.')).toBeInTheDocument()
  })

  it('uploads a file, shows the extraction job, then what was read', async () => {
    const { sources, jobs } = renderSources({ sources: [] })
    jobs.pollMs = 50

    await upload(new File(['Hola, ¿qué tal?'], 'notes.txt', { type: 'text/plain' }))

    expect(sources.upload).toHaveBeenCalledWith(1, expect.any(File), false)
    const source = await item('notes.txt')
    expect(await source.findByRole('status')).toHaveTextContent('Reading the text…')
    expect(await source.findByText('15 characters read from the file.')).toBeInTheDocument()
  })

  it('explains a failed extraction and reads the file again with OCR', async () => {
    const { sources } = renderSources({ sources: [] })

    const user = await upload(new File([new Uint8Array([137, 80, 78, 71])], 'board.png', { type: 'image/png' }))

    const source = await item('board.png')
    expect(await source.findByRole('alert')).toHaveTextContent('No text was found.')
    await user.click(source.getByRole('button', { name: 'Read with OCR' }))
    expect(sources.extract).toHaveBeenCalledWith(1, 100, true)
    expect(await source.findByText(/characters read by the assistant/)).toBeInTheDocument()
  })

  it('reads with OCR again after a failed reading', async () => {
    const { sources } = renderSources({ sources: [], extractions: [{ fail: 'quota' }, { text: 'Tabule' }] })

    const user = await upload(new File([new Uint8Array([137, 80, 78, 71])], 'board.png', { type: 'image/png' }), {
      ocr: true,
    })

    const source = await item('board.png')
    expect(await source.findByRole('alert')).toHaveTextContent('run out of credit')
    await user.click(source.getByRole('button', { name: 'Read with OCR' }))
    expect(sources.extract).toHaveBeenCalledWith(1, 100, true)
    expect(await source.findByText('6 characters read by the assistant.')).toBeInTheDocument()
  })

  it('offers OCR for a PDF read from its text layer, which may be a scan', async () => {
    renderSources()

    expect((await item('Učebnice, kapitola 1.pdf')).getByRole('button', { name: 'Read with OCR' })).toBeInTheDocument()
  })

  it('offers no OCR for a text file', async () => {
    renderSources({ sources: [{ ...textbook, kind: 'text', name: 'notes.txt', media_type: 'text/plain' }] })

    expect((await item('notes.txt')).queryByRole('button', { name: 'Read with OCR' })).not.toBeInTheDocument()
  })

  it('asks for OCR on upload', async () => {
    const { sources } = renderSources({ sources: [], extractions: [{ text: 'Tabule' }] })

    await upload(new File([new Uint8Array([137, 80, 78, 71])], 'board.png', { type: 'image/png' }), { ocr: true })

    expect(sources.upload).toHaveBeenCalledWith(1, expect.any(File), true)
    expect(await (await item('board.png')).findByText('6 characters read by the assistant.')).toBeInTheDocument()
  })

  it('explains a damaged file', async () => {
    renderSources({ sources: [], extractions: [{ fail: 'unreadable_file' }] })

    await upload(new File(['%PDF-'], 'broken.pdf', { type: 'application/pdf' }))

    expect(await (await item('broken.pdf')).findByRole('alert')).toHaveTextContent('The file could not be read')
  })

  it.each([
    ['unsupported_type', 'Only PDFs, text files and images (PNG, JPEG, WebP) can be sources.'],
    ['too_large', 'The source is larger than 20 MB.'],
    ['no_provider_key', 'OCR is paid by your AI provider key; add one in Settings first.'],
  ] as const)('explains a refused upload: %s', async (reason, message) => {
    const { sources } = renderSources({ sources: [] })
    sources.upload.mockRejectedValueOnce(new SourceRefused(reason))

    await upload(new File(['x'], 'x.txt', { type: 'text/plain' }))

    expect(await (await section()).findByRole('alert')).toHaveTextContent(message)
  })

  it('marks a source visible to students', async () => {
    const { sources } = renderSources()
    const user = userEvent.setup()
    const source = await item('Učebnice, kapitola 1.pdf')

    await user.click(source.getByRole('checkbox', { name: 'Visible to students' }))

    expect(sources.change).toHaveBeenCalledWith(1, 1, { visible_to_students: true })
    await waitFor(() => expect(source.getByRole('checkbox', { name: 'Visible to students' })).toBeChecked())
  })

  it('puts the visibility back when it was not saved', async () => {
    const { sources } = renderSources()
    sources.change.mockRejectedValueOnce(new Error('offline'))
    const user = userEvent.setup()
    const source = await item('Učebnice, kapitola 1.pdf')

    await user.click(source.getByRole('checkbox', { name: 'Visible to students' }))

    expect(await source.findByRole('alert')).toHaveTextContent('The change could not be saved.')
    expect(source.getByRole('checkbox', { name: 'Visible to students' })).not.toBeChecked()
  })

  it('removes a source after confirming', async () => {
    const { sources } = renderSources()
    const user = userEvent.setup()
    const source = await item('Učebnice, kapitola 1.pdf')

    await user.click(source.getByRole('button', { name: 'Remove' }))
    expect(sources.remove).not.toHaveBeenCalled()
    await user.click(source.getByRole('button', { name: 'Remove for good' }))

    expect(sources.remove).toHaveBeenCalledWith(1, 1)
    await waitFor(() =>
      expect(screen.queryByRole('article', { name: 'Učebnice, kapitola 1.pdf' })).not.toBeInTheDocument(),
    )
  })

  it('lets a viewer read the sources but not change them', async () => {
    renderSources({ course: viewer })
    const user = userEvent.setup()
    const source = await item('Učebnice, kapitola 1.pdf')

    expect((await section()).queryByLabelText('File')).not.toBeInTheDocument()
    expect((await section()).queryByRole('button', { name: 'Add a source' })).not.toBeInTheDocument()
    expect((await section()).getByText(/it draws on the text read from all of them/)).toBeInTheDocument()
    expect((await section()).queryByRole('link', { name: 'Go to the course topics' })).not.toBeInTheDocument()
    expect(source.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(source.getByRole('checkbox', { name: 'Visible to students' })).toBeDisabled()
    await user.click(source.getByRole('button', { name: 'Show the text' }))
    expect(await source.findByText(/El presente de ser/)).toBeInTheDocument()
  })
})

describe('web pages as sources', () => {
  const blogPage: SourceDetail = {
    id: 7,
    name: 'El pretérito indefinido',
    kind: 'url',
    media_type: 'text/html',
    size: 18_432,
    visible_to_students: false,
    created_at: '2026-09-24T08:00:00Z',
    extracted_with: 'page',
    url: 'https://spanish.example/preterito',
    fetched_at: '2026-09-24T08:00:00Z',
    characters: 120,
    job: null,
    text: 'Se usa para acciones terminadas.',
  }

  async function addPage(url: string, name = '') {
    const user = await adding('A web page')
    const sources = await section()
    await user.type(sources.getByRole('textbox', { name: 'Web page address' }), url)
    if (name) await user.type(sources.getByRole('textbox', { name: 'Name (optional)' }), name)
    await user.click(sources.getByRole('button', { name: 'Take a snapshot' }))
    return user
  }

  it('takes a snapshot of a page once and shows when it was taken', async () => {
    const { sources } = renderSources({
      sources: [],
      pages: { 'https://spanish.example/preterito': { title: 'El pretérito', text: 'Hablé, hablaste, habló.' } },
    })

    await addPage('https://spanish.example/preterito')

    expect(sources.addPage).toHaveBeenCalledWith(1, 'https://spanish.example/preterito', null)
    const page = await item('El pretérito')
    expect(await page.findByText(/^Snapshot taken .*2026/)).toBeInTheDocument()
    expect(page.getByRole('link', { name: 'Open the page' })).toHaveAttribute('href', 'https://spanish.example/preterito')
    expect(page.queryByRole('link', { name: 'Open the original' })).not.toBeInTheDocument()
    expect(page.queryByRole('button', { name: 'Read with OCR' })).not.toBeInTheDocument()
    expect(page.queryByRole('button', { name: 'Fetch again' })).not.toBeInTheDocument()
    expect((await section()).getByRole('textbox', { name: 'Web page address' })).toHaveValue('')
  })

  it('keeps the name the teacher gave the page', async () => {
    const { sources } = renderSources({ sources: [] })

    await addPage('https://spanish.example/preterito', 'Blog o pretéritu')

    expect(sources.addPage).toHaveBeenCalledWith(1, 'https://spanish.example/preterito', 'Blog o pretéritu')
    expect(await item('Blog o pretéritu')).toBeTruthy()
  })

  it('explains a page that could not be fetched and fetches it again', async () => {
    const { sources } = renderSources({ sources: [], pages: {} })

    const user = await addPage('https://spanish.example/gone')

    const page = await item('https://spanish.example/gone')
    const again = await page.findByRole('button', { name: 'Fetch again' })
    expect(page.getByText(/could not be reached/)).toBeInTheDocument()
    await user.click(again)
    expect(sources.extract).toHaveBeenCalledWith(1, 100, false)
  })

  it('explains a page with no text in its HTML: print it to PDF or paste its text', async () => {
    renderSources({ sources: [], pages: { 'https://app.example/unit-1': { fail: 'no_text' } } })

    await addPage('https://app.example/unit-1')

    const page = await item('https://app.example/unit-1')
    // Once the list shows the failed page, not the job's own status that polled it.
    const hint = await page.findByText(
      'The page has no text until the browser builds it. Print the page to PDF and upload the file, or paste its text below.',
    )
    expect(hint).toHaveAttribute('role', 'alert')
    expect(page.queryByText(/read with OCR/)).not.toBeInTheDocument()
  })

  it('refuses an address that is not a web page', async () => {
    const { sources } = renderSources({ sources: [] })

    await addPage('spanish.example/preterito')

    expect(await (await section()).findByRole('alert')).toHaveTextContent('Enter a full web address starting with https://')
    expect(sources.addPage).not.toHaveBeenCalled()
  })

  it('shows a stored snapshot with its page', async () => {
    renderSources({ sources: [blogPage] })

    const page = await item('El pretérito indefinido')
    expect(page.getByText('Web page, 18 KB')).toBeInTheDocument()
    expect(page.getByText(/^Snapshot taken .*2026/)).toBeInTheDocument()
  })
})

describe('pasted text as a source', () => {
  async function paste(name: string, text: string) {
    const user = await adding('Pasted text')
    const sources = await section()
    await user.type(sources.getByRole('textbox', { name: 'Name' }), name)
    await user.type(sources.getByRole('textbox', { name: 'Text' }), text)
    await user.click(sources.getByRole('button', { name: 'Add the text' }))
    return sources
  }

  it('adds pasted text as a text source and clears the form', async () => {
    const { sources } = renderSources({ sources: [] })

    const section = await paste('Online textbook, unit 1', 'Hablé, hablaste, habló.')

    expect(sources.addText).toHaveBeenCalledWith(1, 'Online textbook, unit 1', 'Hablé, hablaste, habló.')
    const pasted = await item('Online textbook, unit 1')
    expect(await pasted.findByText('23 characters read from the file.')).toBeInTheDocument()
    expect(pasted.getByText('Text, 25 B')).toBeInTheDocument()
    expect(section.getByRole('textbox', { name: 'Name' })).toHaveValue('')
    expect(section.getByRole('textbox', { name: 'Text' })).toHaveValue('')
  })

  it('adds nothing without a name or without text', async () => {
    renderSources({ sources: [] })
    const user = await adding('Pasted text')
    const sources = await section()
    const add = sources.getByRole('button', { name: 'Add the text' })

    expect(add).toBeDisabled()
    await user.type(sources.getByRole('textbox', { name: 'Name' }), 'Unit 1')
    await user.type(sources.getByRole('textbox', { name: 'Text' }), '   ')
    expect(add).toBeDisabled()
  })

  it('keeps the text when it was refused', async () => {
    const { sources } = renderSources({ sources: [] })
    sources.addText.mockRejectedValueOnce(new SourceRefused('too_large'))

    const section = await paste('Unit 1', 'Hablé.')

    expect(await section.findByRole('alert')).toHaveTextContent('The source is larger than 20 MB.')
    expect(section.getByRole('textbox', { name: 'Text' })).toHaveValue('Hablé.')
  })

  it('offers no pasting to a viewer', async () => {
    renderSources({ course: viewer })

    await item(textbook.name)
    expect((await section()).queryByRole('button', { name: 'Add the text' })).not.toBeInTheDocument()
  })
})
