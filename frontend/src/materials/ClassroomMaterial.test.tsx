import { createMemoryHistory } from '@solidjs/router'
import { cleanup, render, screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { fakeAuthApi, invitedTeacher } from '../auth/testing'
import type { ConceptMap } from '../concepts/api'
import { fakeConceptsApi, preteritMap } from '../concepts/testing'
import type { Course } from '../courses/api'
import { fakeCoursesApi, spanish, topicFixture } from '../courses/testing'
import { fakeJobsApi } from '../jobs/testing'
import { sampleLesson, withI18n } from '../lesson/testing'
import { fakeStudentsApi, jana } from '../students/testing'
import { fakeRunsApi } from '../runs/testing'
import { fakeSourcesApi, textbook } from '../sources/testing'
import type { SourceDetail } from '../sources/api'
import type { Material } from './api'
import { fakeMaterialsApi, serEstarMaterial, transcription, written, type ScriptedMaterial } from './testing'

const teacher: Account = { ...invitedTeacher, language: 'en' }
const approvedMap: ConceptMap = { ...preteritMap, state: 'approved', approved_at: '2026-09-24T08:00:00Z', approved_before: true }
const shorter: ScriptedMaterial = { ...written, lesson: { ...sampleLesson, title: 'Ser o estar, short' } }

function renderApp(
  path: string,
  options: {
    materials?: Material[]
    map?: ConceptMap
    course?: Course
    script?: ScriptedMaterial[]
    runs?: Parameters<typeof fakeRunsApi>[0]
    sources?: SourceDetail[]
    hasKey?: boolean
  } = {},
) {
  const course = options.course ?? spanish
  const history = createMemoryHistory()
  history.set({ value: path })
  const jobs = fakeJobsApi()
  const sources = fakeSourcesApi({ sources: { [course.id]: options.sources ?? [] }, jobs, hasKey: options.hasKey })
  const materials = fakeMaterialsApi({
    materials: { 2: options.materials ?? [] },
    script: options.script,
    jobs,
    sources,
    hasKey: options.hasKey,
  })
  const apis = fakeApis({
    auth: fakeAuthApi({ signedIn: teacher }),
    courses: fakeCoursesApi({
      courses: [course],
      topics: { [course.id]: [topicFixture({ id: 2, name: 'Pretérito indefinido', position: 0 })] },
    }),
    concepts: fakeConceptsApi({ maps: { 2: options.map ?? approvedMap }, jobs }),
    students: fakeStudentsApi(),
    materials,
    runs: fakeRunsApi(options.runs),
    sources,
    jobs,
  })
  render(withI18n(() => <App apis={apis} history={history} />, 'en'))
  return { materials, runs: apis.runs, sources, jobs }
}

const renderTopic = (options: Parameters<typeof renderApp>[1] = {}) => renderApp('/courses/1/topics/2?tab=materials', options)
const section = async () => within(await screen.findByRole('region', { name: 'Classroom material' }))
const item = async (title: string) => within(await (await section()).findByRole('article', { name: title }))

describe('classroom material of a topic', () => {
  it('generates material as a job, optionally for chosen students, and lists it with its preview', async () => {
    const { materials } = renderTopic({ script: [written] })
    const user = userEvent.setup()
    const materialSection = await section()

    await user.click(await materialSection.findByRole('checkbox', { name: 'Jana Veselá' }))
    await user.click(materialSection.getByRole('button', { name: 'Generate material' }))

    expect(materials.generate).toHaveBeenCalledWith(1, 2, [jana.id], null)
    const material = await item('Ser, or estar?')
    expect(material.getByText('Version 1')).toBeInTheDocument()
    expect(material.getByText('For Jana Veselá')).toBeInTheDocument()
    expect(material.getByRole('link', { name: 'Preview and print' })).toHaveAttribute(
      'href',
      '/preview/courses/1/topics/2/materials/100',
    )
  })

  it('generates the first version by an optional instruction and shows what was asked', async () => {
    const { materials } = renderTopic({ script: [written] })
    const user = userEvent.setup()
    const materialSection = await section()

    await user.type(materialSection.getByRole('textbox', { name: 'Instruction (optional)' }), '  Five exercises.  ')
    await user.click(materialSection.getByRole('button', { name: 'Generate material' }))

    expect(materials.generate).toHaveBeenCalledWith(1, 2, [], 'Five exercises.')
    expect((await item('Ser, or estar?')).getByText('Asked for: “Five exercises.”')).toBeInTheDocument()
    expect(materialSection.getByRole('textbox', { name: 'Instruction (optional)' })).toHaveValue('')
  })

  it('says that material for chosen students is the same as for the class for now', async () => {
    renderTopic()

    expect(await (await section()).findByText(/same as for the whole class/)).toBeInTheDocument()
  })

  it('asks for an approved concept map before generating, but not before transcribing', async () => {
    renderTopic({ map: preteritMap })
    const materialSection = await section()

    expect(await materialSection.findByText('Approve the concept map to generate material from it.')).toBeInTheDocument()
    expect(materialSection.queryByRole('button', { name: 'Generate material' })).not.toBeInTheDocument()
    expect(materialSection.getByRole('form', { name: 'Create from a source' })).toBeInTheDocument()
  })

  it('says why a generation failed and tries it again', async () => {
    const { materials } = renderTopic({ script: [{ fail: 'quota' }, written] })
    const user = userEvent.setup()

    await user.click((await section()).getByRole('button', { name: 'Generate material' }))
    const failed = await item('Classroom material')
    const retry = await failed.findByRole('button', { name: 'Try again' })
    expect(failed.getByText(/run out of credit/)).toBeInTheDocument()
    await user.click(retry)

    expect(materials.retry).toHaveBeenCalledWith(1, 2, 100)
    expect(await item('Ser, or estar?')).toBeTruthy()
  })

  it('reworks the material by an instruction into a new version', async () => {
    const { materials } = renderTopic({ materials: [serEstarMaterial], script: [shorter] })
    const user = userEvent.setup()
    const material = await item('Ser, or estar?')

    await user.type(material.getByRole('textbox', { name: 'Instruction' }), 'Only three exercises.')
    await user.click(material.getByRole('button', { name: 'Rework' }))

    expect(materials.regenerate).toHaveBeenCalledWith(1, 2, 41, 'Only three exercises.', 1)
    const reworked = await item('Ser o estar, short')
    expect(reworked.getByText('Version 2')).toBeInTheDocument()
    expect(reworked.getByText('Reworked from version 1: “Only three exercises.”')).toBeInTheDocument()
    expect(reworked.getByRole('textbox', { name: 'Instruction' })).toHaveValue('')
  })

  it('does not send an empty instruction', async () => {
    const { materials } = renderTopic({ materials: [serEstarMaterial] })
    const user = userEvent.setup()

    await user.click((await item('Ser, or estar?')).getByRole('button', { name: 'Rework' }))

    expect(materials.regenerate).not.toHaveBeenCalled()
  })

  it('says an answer cut off as too long asks for less', async () => {
    renderTopic({ script: [{ fail: 'too_long' }] })
    const user = userEvent.setup()

    await user.click((await section()).getByRole('button', { name: 'Generate material' }))

    await waitFor(async () =>
      expect(
        (await item('Classroom material')).getByText(/was too long and got cut off\. Ask for less, for example fewer exercises/),
      ).toBeInTheDocument(),
    )
  })

  it('says why a rework failed until the teacher moves on', async () => {
    renderTopic({ materials: [serEstarMaterial], script: [{ fail: 'quota' }] })
    const user = userEvent.setup()
    const material = await item('Ser, or estar?')

    await user.type(material.getByRole('textbox', { name: 'Instruction' }), 'Shorter.')
    await user.click(material.getByRole('button', { name: 'Rework' }))
    await waitFor(async () => expect((await item('Ser, or estar?')).getByText(/run out of credit/)).toBeInTheDocument())
    await user.click((await item('Ser, or estar?')).getByRole('button', { name: 'Mark as reviewed' }))

    await waitFor(async () =>
      expect((await item('Ser, or estar?')).queryByText(/run out of credit/)).not.toBeInTheDocument(),
    )
    expect((await item('Ser, or estar?')).getByText('Version 1')).toBeInTheDocument()
  })

  it('marks new material reviewed, recording that the teacher keeps it', async () => {
    const { materials } = renderTopic({ materials: [serEstarMaterial] })
    const user = userEvent.setup()
    const material = await item('Ser, or estar?')
    expect(material.getByText('New')).toBeInTheDocument()

    await user.click(material.getByRole('button', { name: 'Mark as reviewed' }))

    expect(materials.keep).toHaveBeenCalledWith(1, 2, 41)
    expect(await material.findByRole('status')).toHaveTextContent('Marked as reviewed.')
    expect(await material.findByText('Reviewed')).toBeInTheDocument()
    expect(material.queryByRole('button', { name: 'Mark as reviewed' })).not.toBeInTheDocument()
  })

  it('discards material after confirming', async () => {
    const { materials } = renderTopic({ materials: [serEstarMaterial] })
    const user = userEvent.setup()

    await user.click((await item('Ser, or estar?')).getByRole('button', { name: 'Discard' }))
    expect(materials.discard).not.toHaveBeenCalled()
    await user.click((await item('Ser, or estar?')).getByRole('button', { name: 'Discard for good' }))

    expect(materials.discard).toHaveBeenCalledWith(1, 2, 41)
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Ser, or estar?' })).not.toBeInTheDocument())
  })

  it('lets a viewer preview material but not change it', async () => {
    renderTopic({ materials: [serEstarMaterial], course: { ...spanish, can_edit: false } })

    const material = await item('Ser, or estar?')
    expect(material.getByRole('link', { name: 'Preview and print' })).toBeInTheDocument()
    // Releasing changes nothing of the material: a viewer who teaches a run may release it.
    expect(material.getAllByRole('button').map((b) => b.textContent)).toEqual(['Release in a run…'])
    expect(material.queryByRole('textbox')).not.toBeInTheDocument()
    expect((await section()).queryByRole('button', { name: 'Generate material' })).not.toBeInTheDocument()
  })
})

describe('releasing a material in a run', () => {
  const inClass = { id: 7, courseId: 1, name: '2.B 2026/27', classIds: [1], studentIds: [] }
  const releasable = { id: 41, topic: 'Pretérito indefinido', title: 'Ser, or estar?', versions: [1], target_student_ids: [] }

  it('releases it in a chosen run after a summary, then says where it is released', async () => {
    const { runs } = renderTopic({ materials: [serEstarMaterial], runs: { runs: [inClass], materials: [releasable] } })
    const user = userEvent.setup()

    await user.click((await item('Ser, or estar?')).getByRole('button', { name: 'Release in a run…' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Release in a run' }))
    await user.selectOptions(await dialog.findByLabelText('Course run'), '7')
    expect(await dialog.findByText('Ser, or estar?')).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Continue to the summary' }))
    expect(await dialog.findByText('Students who will see the material right away: 1')).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Release' }))

    expect(runs.release).toHaveBeenCalledWith(7, expect.objectContaining({ material_id: 41, version: 1, audience: 'run' }))
    const material = await item('Ser, or estar?')
    expect(await material.findByRole('link', { name: '2.B 2026/27 (version 1)' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/runs\/7\/releases\/\d+$/),
    )
  })

  it('releases to every participant of a link run chosen after chosen students of another run', async () => {
    const linkRun = {
      id: 8,
      courseId: 1,
      name: 'Den otevřených dveří',
      classIds: [],
      studentIds: [],
      link: {
        capacity: 30,
        joinToken: 'join-8',
        participants: [
          { id: 1, name: 'Eva', joined_at: '2026-09-25T08:00:00Z' },
          { id: 2, name: 'Adam', joined_at: '2026-09-25T08:01:00Z' },
        ],
      },
    }
    const { runs } = renderTopic({
      materials: [serEstarMaterial],
      runs: { runs: [inClass, linkRun], materials: [releasable] },
    })
    const user = userEvent.setup()

    await user.click((await item('Ser, or estar?')).getByRole('button', { name: 'Release in a run…' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Release in a run' }))
    await user.selectOptions(await dialog.findByLabelText('Course run'), '7')
    await user.click(await dialog.findByRole('radio', { name: 'Chosen students' }))
    await user.selectOptions(dialog.getByLabelText('Course run'), '8')
    await dialog.findByText('For every participant of the run, including those who join later.')
    await user.click(dialog.getByRole('button', { name: 'Continue to the summary' }))
    expect(await dialog.findByText('Participants who will see the material right away: 2')).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Release' }))

    expect(runs.release).toHaveBeenCalledWith(8, expect.objectContaining({ audience: 'run', student_ids: null }))
  })

  it('says when the material cannot be released in the run chosen', async () => {
    renderTopic({ materials: [serEstarMaterial], runs: { runs: [inClass], materials: [] } })
    const user = userEvent.setup()

    await user.click((await item('Ser, or estar?')).getByRole('button', { name: 'Release in a run…' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Release in a run' }))
    await user.selectOptions(await dialog.findByLabelText('Course run'), '7')

    expect(await dialog.findByRole('alert')).toHaveTextContent('This material has no version to release; it may have been discarded.')
  })

  it('leads to the course runs when the teacher teaches none', async () => {
    renderTopic({ materials: [serEstarMaterial] })
    const user = userEvent.setup()

    await user.click((await item('Ser, or estar?')).getByRole('button', { name: 'Release in a run…' }))

    const dialog = within(screen.getByRole('dialog', { name: 'Release in a run' }))
    expect(await dialog.findByText('You teach no run of this course yet. Start one first.')).toBeInTheDocument()
    expect(dialog.getByRole('link', { name: 'Go to the course runs' })).toHaveAttribute('href', '/courses/1?tab=runs')
  })
})

describe('classroom material preview', () => {
  it('renders the exercises and the answer key after them', async () => {
    renderApp('/preview/courses/1/topics/2/materials/41', { materials: [serEstarMaterial] })

    expect(await screen.findByRole('heading', { level: 1, name: 'Ser, or estar?' })).toBeInTheDocument()
    const key = screen.getByRole('region', { name: 'Answer key' })
    expect(within(key).getAllByRole('listitem')[0]).toHaveTextContent('está')
  })

  it('marks answers the assistant proposed until the material is reviewed', async () => {
    const proposing = { ...serEstarMaterial, proposed_answers: ['location'] }
    renderApp('/preview/courses/1/topics/2/materials/41', { materials: [proposing] })

    const key = await screen.findByRole('region', { name: 'Answer key' })
    const flag = within(within(key).getAllByRole('listitem')[0]).getByText('Proposed by the assistant: check it')
    expect(flag).toHaveClass('answer-key-proposed')
    cleanup()
    renderApp('/preview/courses/1/topics/2/materials/41', { materials: [{ ...proposing, reviewed: true }] })
    const reviewed = await screen.findByRole('region', { name: 'Answer key' })
    expect(within(reviewed).queryByText('Proposed by the assistant: check it')).not.toBeInTheDocument()
  })

  it('says when the material is not there', async () => {
    renderApp('/preview/courses/1/topics/2/materials/99')

    expect(await screen.findByRole('alert')).toHaveTextContent('No classroom material here.')
  })
})

describe('classroom material transcribed from a source', () => {
  const test3: SourceDetail = { ...textbook, id: 7, name: 'Test 3.pdf', extracted_with: 'ocr' }
  const keySheet: SourceDetail = { ...textbook, id: 8, name: 'Klíč.pdf' }
  const unread: SourceDetail = { ...textbook, id: 9, name: 'Scan.png', characters: null, text: null, extracted_with: null }
  const reading: SourceDetail = {
    ...unread,
    id: 10,
    name: 'Reading.png',
    job: { id: 90, kind: 'source_extraction', state: 'running', progress: 'extracting', result: null, error_kind: null, raw_output: null },
  }
  const appendix: SourceDetail = { ...textbook, id: 11, name: 'Příloha.pdf', page_count: 4 }
  const proposed: ScriptedMaterial = {
    ...written,
    lesson: {
      ...sampleLesson,
      blocks: [...sampleLesson.blocks, { type: 'paper_only', id: 'timeline', prompt: 'Draw a timeline.', answer_lines: 4 }],
    },
    proposed_answers: ['location'],
  }

  it('transcribes a read source of the course, with an optional answer key, even before the concept map is approved', async () => {
    const { materials } = renderTopic({
      map: preteritMap,
      sources: [test3, keySheet, unread, reading],
      script: [proposed],
    })
    const user = userEvent.setup()
    const materialSection = await section()

    const form = within(await materialSection.findByRole('form', { name: 'Create from a source' }))
    const choice = form.getByRole('combobox', { name: 'Source to transcribe' })
    // One not read yet is read first; one being read is not offered until it is read.
    expect(within(choice).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Test 3.pdf',
      'Klíč.pdf',
      'Scan.png (not read yet)',
      'Upload a new file…',
    ])
    await user.selectOptions(choice, 'Test 3.pdf')
    await user.selectOptions(form.getByRole('combobox', { name: 'Answer key (optional)' }), 'Klíč.pdf')
    await user.click(form.getByRole('button', { name: 'Transcribe' }))

    expect(materials.transcribe).toHaveBeenCalledWith(1, 2, transcription(7, 8))
    const material = await item('Ser, or estar?')
    expect(material.getByText('Transcribed from Test 3.pdf')).toBeInTheDocument()
    expect(material.getByText('Answers proposed by the assistant: 1. Check them in the preview.')).toBeInTheDocument()
    expect(material.getByText('Paper-only exercises: 1. They are printed but not done in the app.')).toBeInTheDocument()
  })

  it('uploads the test and its key right in the form, reads them, then transcribes', async () => {
    const { materials, sources, jobs } = renderTopic({ script: [written] })
    jobs.pollMs = 50
    const user = userEvent.setup()
    const form = within(await (await section()).findByRole('form', { name: 'Create from a source' }))

    expect(form.getByRole('combobox', { name: 'Source to transcribe' })).toHaveDisplayValue('Upload a new file…')
    await user.upload(form.getByLabelText('Test file'), new File(['scan'], 'Test 3.png', { type: 'image/png' }))
    await user.selectOptions(form.getByRole('combobox', { name: 'Answer key (optional)' }), 'Upload a new file…')
    await user.upload(form.getByLabelText('Answer key file'), new File(['Klíč: 1a'], 'Klíč.txt', { type: 'text/plain' }))
    await user.click(form.getByRole('button', { name: 'Transcribe' }))

    expect(sources.store).toHaveBeenCalledTimes(2)
    expect(materials.transcribe).toHaveBeenCalledWith(1, 2, transcription(100, 101))
    expect(await (await section()).findByRole('status')).toHaveTextContent('Reading the text…')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('The assistant is working…'))
    const material = await item('Ser, or estar?')
    expect(material.getByText('Transcribed from Test 3.png')).toBeInTheDocument()
  })

  it('uploads nothing and transcribes nothing without a provider key', async () => {
    const { materials, sources } = renderTopic({ hasKey: false })
    const user = userEvent.setup()
    const form = within(await (await section()).findByRole('form', { name: 'Create from a source' }))

    expect(form.getByRole('button', { name: 'Transcribe' })).toBeDisabled()
    await user.upload(form.getByLabelText('Test file'), new File(['scan'], 'Test 3.png', { type: 'image/png' }))
    await user.click(form.getByRole('button', { name: 'Transcribe' }))

    expect(await (await section()).findByRole('alert')).toHaveTextContent('Add an AI provider key in Settings first.')
    expect(await sources.list(1)).toEqual([])
    expect(materials.transcribe).not.toHaveBeenCalled()
  })

  it('says why a file was refused', async () => {
    const { materials } = renderTopic()
    const user = userEvent.setup()
    const form = within(await (await section()).findByRole('form', { name: 'Create from a source' }))

    await user.upload(form.getByLabelText('Test file'), new File([], 'Test 3.pdf', { type: 'application/pdf' }))
    await user.click(form.getByRole('button', { name: 'Transcribe' }))

    expect(await (await section()).findByRole('alert')).toHaveTextContent('The file is empty.')
    expect(materials.transcribe).not.toHaveBeenCalled()
  })

  it('transcribes chosen pages, with the answer key on other pages of the same PDF, and names them on the material', async () => {
    const { materials } = renderTopic({ sources: [appendix], script: [written] })
    const user = userEvent.setup()
    const form = within(await (await section()).findByRole('form', { name: 'Create from a source' }))

    await user.type(form.getByRole('textbox', { name: 'Pages of the test' }), '1-2')
    await user.selectOptions(form.getByRole('combobox', { name: 'Answer key (optional)' }), 'Příloha.pdf')
    await user.type(form.getByRole('textbox', { name: 'Pages of the answer key' }), '4')
    await user.click(form.getByRole('button', { name: 'Transcribe' }))

    expect(materials.transcribe).toHaveBeenCalledWith(1, 2, transcription(11, 11, { source_pages: '1-2', key_pages: '4' }))
    expect((await item('Ser, or estar?')).getByText('Transcribed from Příloha.pdf, pages 1–2')).toBeInTheDocument()
  })

  it('asks for pages only of a PDF, an uploaded one too', async () => {
    renderTopic({ sources: [{ ...unread, kind: 'image', media_type: 'image/png' }] })
    const user = userEvent.setup()
    const form = within(await (await section()).findByRole('form', { name: 'Create from a source' }))

    expect(form.queryByRole('textbox', { name: 'Pages of the test' })).not.toBeInTheDocument()
    await user.selectOptions(form.getByRole('combobox', { name: 'Source to transcribe' }), 'Upload a new file…')
    await user.upload(form.getByLabelText('Test file'), new File(['%PDF-'], 'Příloha.pdf', { type: 'application/pdf' }))
    expect(form.getByRole('textbox', { name: 'Pages of the test' })).toHaveAttribute(
      'placeholder',
      'Such as 1-2 or 3, 5-7; empty for the whole file',
    )
  })

  it('transcribes the pages chosen of a PDF uploaded right in the form', async () => {
    const { materials } = renderTopic({ script: [written] })
    const user = userEvent.setup()
    const form = within(await (await section()).findByRole('form', { name: 'Create from a source' }))

    await user.upload(form.getByLabelText('Test file'), new File(['%PDF-'], 'Příloha.pdf', { type: 'application/pdf' }))
    await user.type(form.getByRole('textbox', { name: 'Pages of the test' }), '2-3')
    await user.click(form.getByRole('button', { name: 'Transcribe' }))

    await waitFor(() => expect(materials.transcribe).toHaveBeenCalledWith(1, 2, transcription(100, null, { source_pages: '2-3' })))
  })

  it('says a PDF read before its pages were kept is read again for the pages chosen', async () => {
    renderTopic({ sources: [{ ...appendix, page_count: null }] })

    const form = within(await (await section()).findByRole('form', { name: 'Create from a source' }))
    expect(form.getByText('Choosing pages reads the file again, page by page.')).toBeInTheDocument()
  })

  it('explains pages the file does not have', async () => {
    renderTopic({ sources: [appendix] })
    const user = userEvent.setup()
    const form = within(await (await section()).findByRole('form', { name: 'Create from a source' }))

    await user.type(form.getByRole('textbox', { name: 'Pages of the test' }), '4-5')
    await user.click(form.getByRole('button', { name: 'Transcribe' }))

    expect(await (await section()).findByRole('alert')).toHaveTextContent('The file does not have all of those pages.')
  })

  it('explains pages written other than as numbers and ranges', async () => {
    const { materials } = renderTopic({ sources: [appendix] })
    const user = userEvent.setup()
    const form = within(await (await section()).findByRole('form', { name: 'Create from a source' }))

    await user.type(form.getByRole('textbox', { name: 'Pages of the test' }), 'the first two')
    await user.click(form.getByRole('button', { name: 'Transcribe' }))

    expect(await (await section()).findByRole('alert')).toHaveTextContent(
      'Write the pages as numbers and ranges, such as 1-2 or 3, 5-7.',
    )
    expect(materials.list).toHaveBeenCalledTimes(1)
  })

  it('says on the material why its source could not be read, and reads it again', async () => {
    const { materials } = renderTopic({ sources: [unread], script: [{ fail: 'nothing_read' }, written] })
    const user = userEvent.setup()
    const form = within(await (await section()).findByRole('form', { name: 'Create from a source' }))

    await user.click(form.getByRole('button', { name: 'Transcribe' }))

    expect(materials.transcribe).toHaveBeenCalledWith(1, 2, transcription(9, null))
    const failed = await item('Classroom material')
    const retry = await failed.findByRole('button', { name: 'Try again' })
    expect(failed.getByText(/The assistant found no text in the file/)).toBeInTheDocument()
    await user.click(retry)
    expect(await item('Ser, or estar?')).toBeTruthy()
  })
})
