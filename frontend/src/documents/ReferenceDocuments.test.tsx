import { createMemoryHistory } from '@solidjs/router'
import { render, screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { fakeAuthApi, invitedTeacher } from '../auth/testing'
import type { ConceptMap } from '../concepts/api'
import { fakeConceptsApi, preteritMap } from '../concepts/testing'
import type { Course, Topic } from '../courses/api'
import { fakeCoursesApi, spanish, topicFixture } from '../courses/testing'
import { fakeJobsApi } from '../jobs/testing'
import { withI18n } from '../lesson/testing'
import { DocumentRefused, type ReferenceDocument } from './api'
import { cheatSheet, fakeDocumentsApi, type ScriptedDocument } from './testing'

const teacher: Account = { ...invitedTeacher, language: 'en' }
const topics: Topic[] = [topicFixture({ id: 2, name: 'Pretérito indefinido', position: 0 })]
const approvedMap: ConceptMap = { ...preteritMap, state: 'approved', approved_at: '2026-09-24T08:00:00Z', approved_before: true }
const written: ScriptedDocument = {
  title: 'Vocabulario del pretérito',
  passages: [
    {
      markdown: '- **ayer**: včera',
      citations: [{ source_id: 1, source_name: 'Učebnice 3.pdf', location: 'Unidad 3' }],
      unsourced: false,
    },
  ],
}

function renderApp(
  path: string,
  options: { documents?: ReferenceDocument[]; map?: ConceptMap; course?: Course; script?: ScriptedDocument[] } = {},
) {
  const course = options.course ?? spanish
  const history = createMemoryHistory()
  history.set({ value: path })
  const jobs = fakeJobsApi()
  const documents = fakeDocumentsApi({ documents: { 2: options.documents ?? [] }, script: options.script, jobs })
  const apis = fakeApis({
    auth: fakeAuthApi({ signedIn: teacher }),
    courses: fakeCoursesApi({ courses: [course], topics: { [course.id]: topics } }),
    concepts: fakeConceptsApi({ maps: { 2: options.map ?? approvedMap }, jobs }),
    documents,
    jobs,
  })
  render(withI18n(() => <App apis={apis} history={history} />, 'en'))
  return { documents }
}

const renderTopic = (options: Parameters<typeof renderApp>[1] = {}) => renderApp('/courses/1/topics/2?tab=documents', options)
const section = async () => within(await screen.findByRole('region', { name: 'Reference documents' }))
const item = async (title: string) => within(await (await section()).findByRole('article', { name: title }))

describe('reference documents of a topic', () => {
  it('generates a document as a job and lists it with its preview', async () => {
    const { documents } = renderTopic({ script: [written] })
    const user = userEvent.setup()
    const documentsSection = await section()

    await user.selectOptions(documentsSection.getByRole('combobox', { name: 'Kind' }), 'Vocabulary sheet')
    await user.click(documentsSection.getByRole('button', { name: 'Generate' }))

    expect(documents.generate).toHaveBeenCalledWith(1, 2, 'vocabulary')
    const document = await item('Vocabulario del pretérito')
    expect(document.getByText('Vocabulary sheet, version 1')).toBeInTheDocument()
    expect(document.getByRole('link', { name: 'Preview and print' })).toHaveAttribute(
      'href',
      '/preview/courses/1/topics/2/documents/100',
    )
  })

  it('asks for an approved concept map first', async () => {
    renderTopic({ map: preteritMap })

    expect(await screen.findByText('This step opens once the concept map is approved: everything here is made from it.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate' })).not.toBeInTheDocument()
  })

  it('says an answer cut off as too long asks for less', async () => {
    renderTopic({ script: [{ fail: 'too_long' }] })
    const user = userEvent.setup()

    await user.click((await section()).getByRole('button', { name: 'Generate' }))

    await waitFor(async () =>
      expect((await item('Grammar cheat sheet')).getByText(/was too long and got cut off/)).toBeInTheDocument(),
    )
  })

  it('says why a generation failed and tries it again', async () => {
    const { documents } = renderTopic({ script: [{ fail: 'quota' }, written] })
    const user = userEvent.setup()

    await user.click((await section()).getByRole('button', { name: 'Generate' }))
    const failed = await item('Grammar cheat sheet')
    const retry = await failed.findByRole('button', { name: 'Try again' })
    expect(failed.getByText(/run out of credit/)).toBeInTheDocument()
    await user.click(retry)

    expect(documents.retry).toHaveBeenCalledWith(1, 2, 100)
    expect(await item('Vocabulario del pretérito')).toBeTruthy()
  })

  it('edits the text into a new version, keeping the citations', async () => {
    const { documents } = renderTopic({ documents: [cheatSheet] })
    const user = userEvent.setup()
    const document = await item('Pretérito indefinido')

    await user.click(document.getByRole('button', { name: 'Edit' }))
    const title = document.getByRole('textbox', { name: 'Title' })
    await user.clear(title)
    await user.type(title, 'Pretérito: tahák')
    const third = document.getByRole('textbox', { name: 'Passage 3' })
    await user.clear(third)
    await user.type(third, 'Finished actions.')
    await user.click(document.getByRole('button', { name: 'Save as a new version' }))

    expect(documents.edit).toHaveBeenCalledWith(1, 2, 31, {
      title: 'Pretérito: tahák',
      passages: [
        { markdown: cheatSheet.passages[0].markdown, citations: [{ source_id: 1, location: 'Unidad 3' }] },
        {
          markdown: cheatSheet.passages[1].markdown,
          citations: [
            { source_id: 1, location: 'Unidad 3' },
            { source_id: 2, location: 'p. 12' },
          ],
        },
        { markdown: 'Finished actions.', citations: [] },
      ],
    }, 1)
    expect((await item('Pretérito: tahák')).getByText('Grammar cheat sheet, version 2')).toBeInTheDocument()
  })

  it('keeps the edited text when a newer version was saved meanwhile', async () => {
    const { documents } = renderTopic({ documents: [cheatSheet] })
    documents.edit.mockRejectedValueOnce(new DocumentRefused('document_changed'))
    const user = userEvent.setup()
    const document = await item('Pretérito indefinido')

    await user.click(document.getByRole('button', { name: 'Edit' }))
    await user.type(document.getByRole('textbox', { name: 'Passage 3' }), ' Mine.')
    await user.click(document.getByRole('button', { name: 'Save as a new version' }))

    expect(await document.findByRole('alert')).toHaveTextContent('Someone saved a newer version meanwhile.')
    expect(document.getByRole('textbox', { name: 'Passage 3' })).toHaveValue('Use it for finished actions. Mine.')
  })

  it('marks a new document reviewed, recording that the teacher keeps it', async () => {
    const { documents } = renderTopic({ documents: [cheatSheet] })
    const user = userEvent.setup()
    const document = await item('Pretérito indefinido')
    expect(document.getByText('New')).toBeInTheDocument()

    await user.click(document.getByRole('button', { name: 'Mark as reviewed' }))

    expect(documents.keep).toHaveBeenCalledWith(1, 2, 31)
    expect(await document.findByRole('status')).toHaveTextContent('Marked as reviewed.')
    expect(await document.findByText('Reviewed')).toBeInTheDocument()
    expect(document.queryByRole('button', { name: 'Mark as reviewed' })).not.toBeInTheDocument()
  })

  it('discards a document after confirming', async () => {
    const { documents } = renderTopic({ documents: [cheatSheet] })
    const user = userEvent.setup()

    await user.click((await item('Pretérito indefinido')).getByRole('button', { name: 'Discard' }))
    expect(documents.discard).not.toHaveBeenCalled()
    await user.click((await item('Pretérito indefinido')).getByRole('button', { name: 'Discard for good' }))

    expect(documents.discard).toHaveBeenCalledWith(1, 2, 31)
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Pretérito indefinido' })).not.toBeInTheDocument())
  })

  it('lets a viewer preview documents but not change them', async () => {
    renderTopic({ documents: [cheatSheet], course: { ...spanish, can_edit: false } })

    const document = await item('Pretérito indefinido')
    expect(document.getByRole('link', { name: 'Preview and print' })).toBeInTheDocument()
    expect(document.queryByRole('button')).not.toBeInTheDocument()
    expect((await section()).queryByRole('button', { name: 'Generate' })).not.toBeInTheDocument()
  })
})

describe('reference document preview', () => {
  const renderPreview = () => renderApp('/preview/courses/1/topics/2/documents/31', { documents: [cheatSheet] })

  it('renders the document with its citations as footnotes', async () => {
    renderPreview()

    expect(await screen.findByRole('heading', { level: 1, name: 'Pretérito indefinido' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Regular -ar verbs' })).toBeInTheDocument()
    const passages = screen.getAllByRole('article')
    expect(within(passages[0]).getAllByRole('link').map((a) => a.textContent)).toEqual(['1'])
    expect(within(passages[1]).getAllByRole('link').map((a) => a.textContent)).toEqual(['1', '2'])
    const footnotes = within(screen.getByRole('list', { name: 'Sources' }))
    expect(footnotes.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Učebnice 3.pdf, Unidad 3',
      'A removed source, p. 12',
    ])
    expect(within(passages[0]).getByRole('link', { name: '1' })).toHaveAttribute('href', '#footnote-1')
  })

  it('marks what rests on no source', async () => {
    renderPreview()

    const passages = await screen.findAllByRole('article')
    expect(within(passages[2]).getByText('Unsourced')).toBeInTheDocument()
    expect(within(passages[0]).queryByText('Unsourced')).not.toBeInTheDocument()
    expect(screen.getByText('1 passage rests on no source. Check it before you print.')).toBeInTheDocument()
  })
})
