import { createMemoryHistory } from '@solidjs/router'
import { render, screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { fakeAuthApi, invitedTeacher } from '../auth/testing'
import type { Course } from '../courses/api'
import { fakeCoursesApi, spanish, topicFixture } from '../courses/testing'
import { fakeJobsApi } from '../jobs/testing'
import { withI18n } from '../lesson/testing'
import { fakeMaterialsApi, transcription } from '../materials/testing'
import type { Credential } from '../settings/api'
import { fakeSettingsApi } from '../settings/testing'
import { fakeSourcesApi } from '../sources/testing'

const teacher: Account = { ...invitedTeacher, language: 'en' }
const key: Credential = {
  provider: 'anthropic',
  masked_key: '…7f3a',
  strong_model: 'claude-opus-5-5',
  fast_model: 'claude-haiku-4-5',
  updated_at: '2026-09-24T08:00:00Z',
}
const viewed: Course = { ...spanish, id: 3, name: 'Dějepis 1.A', subject: 'History', access: 'view', can_edit: false }
const test = new File(['1. Yo ___ (ser) estudiante.'], 'Test ser.txt', { type: 'text/plain' })
const answers = new File(['1. soy'], 'Klíč ser.txt', { type: 'text/plain' })

function renderHome(options: { courses?: Course[]; hasKey?: boolean } = {}) {
  const history = createMemoryHistory()
  history.set({ value: '/' })
  const jobs = fakeJobsApi()
  const courses = fakeCoursesApi({
    courses: options.courses ?? [spanish, viewed],
    topics: { [spanish.id]: [topicFixture({ id: 2, name: 'Pretérito indefinido', position: 0 })] },
  })
  const sources = fakeSourcesApi({ jobs })
  const materials = fakeMaterialsApi({ jobs, sources })
  const apis = fakeApis({
    auth: fakeAuthApi({ signedIn: teacher }),
    settings: fakeSettingsApi({}, { credentials: options.hasKey === false ? [] : [key] }),
    courses,
    sources,
    materials,
    jobs,
  })
  render(withI18n(() => <App apis={apis} history={history} />, 'en'))
  return { history, courses, sources, materials, user: userEvent.setup() }
}

type User = ReturnType<typeof userEvent.setup>
type Dialog = ReturnType<typeof within>

async function openDialog(user: User) {
  await user.click(await screen.findByRole('button', { name: 'Turn a test into classroom material' }))
  return within(await screen.findByRole('dialog', { name: 'Turn a test into classroom material' }))
}

/** A new course "Dějepis 2.A" explained in Czech, with a new topic "Pravěk". */
async function fillNewCourse(dialog: Dialog, user: User) {
  await user.type(await dialog.findByRole('textbox', { name: 'Course name' }), 'Dějepis 2.A')
  await user.type(dialog.getByRole('textbox', { name: 'Subject' }), 'History')
  await user.selectOptions(dialog.getByRole('combobox', { name: 'Language of explanations' }), 'Czech')
  await user.type(dialog.getByRole('textbox', { name: 'Name of the new topic' }), 'Pravěk')
}

describe('turning a test into classroom material from the home page', () => {
  it('transcribes the test into a topic of a course the teacher may edit, and opens its material', async () => {
    const { history, courses, sources, materials, user } = renderHome()
    const dialog = await openDialog(user)

    const course = await dialog.findByRole('combobox', { name: 'Course' })
    expect(within(course).queryByRole('option', { name: 'Dějepis 1.A' })).not.toBeInTheDocument()
    await user.selectOptions(course, 'Španělština 2.B')
    await user.selectOptions(await dialog.findByRole('combobox', { name: 'Topic' }), 'Pretérito indefinido')
    await user.upload(dialog.getByLabelText('Test file'), test)
    await user.click(dialog.getByRole('button', { name: 'Transcribe' }))

    await waitFor(() => expect(history.get()).toBe('/courses/1/topics/2?tab=materials'))
    expect(sources.store).toHaveBeenCalledWith(1, test)
    expect(materials.transcribe).toHaveBeenCalledWith(1, 2, transcription(100, null))
    expect(courses.create).not.toHaveBeenCalled()
    expect(courses.addTopic).not.toHaveBeenCalled()
  })

  it('creates a new course and a new topic on the way, with an answer key', async () => {
    const { history, courses, sources, materials, user } = renderHome()
    const dialog = await openDialog(user)

    await user.selectOptions(await dialog.findByRole('combobox', { name: 'Course' }), 'New course…')
    expect(dialog.queryByRole('combobox', { name: 'Topic' })).not.toBeInTheDocument()
    await fillNewCourse(dialog, user)
    await user.upload(dialog.getByLabelText('Test file'), test)
    await user.upload(dialog.getByLabelText('Answer key file, if you have one'), answers)
    await user.click(dialog.getByRole('button', { name: 'Transcribe' }))

    await waitFor(() => expect(history.get()).toBe('/courses/102/topics/1000?tab=materials'))
    expect(courses.create).toHaveBeenCalledWith({
      name: 'Dějepis 2.A',
      subject: 'History',
      taught_language: null,
      instruction_language: 'cs',
    })
    expect(courses.addTopic).toHaveBeenCalledWith(102, 'Pravěk')
    expect(sources.store).toHaveBeenCalledWith(102, test)
    expect(sources.store).toHaveBeenCalledWith(102, answers)
    expect(materials.transcribe).toHaveBeenCalledWith(102, 1000, transcription(100, 101))
  })

  it('transcribes chosen pages of a PDF, the answer key from other pages of the same file uploaded once', async () => {
    const { sources, materials, user } = renderHome()
    const dialog = await openDialog(user)
    const appendix = new File(['%PDF-1.4'], 'Příloha.pdf', { type: 'application/pdf' })

    await user.upload(await dialog.findByLabelText('Test file'), test)
    expect(dialog.queryByRole('textbox', { name: 'Pages of the test' })).not.toBeInTheDocument()
    await user.upload(dialog.getByLabelText('Test file'), appendix)
    await user.type(dialog.getByRole('textbox', { name: 'Pages of the test' }), '1-2')
    await user.upload(dialog.getByLabelText('Answer key file, if you have one'), appendix)
    await user.type(dialog.getByRole('textbox', { name: 'Pages of the answer key' }), '3')
    await user.click(dialog.getByRole('button', { name: 'Transcribe' }))

    await waitFor(() =>
      expect(materials.transcribe).toHaveBeenCalledWith(1, 2, transcription(100, 100, { source_pages: '1-2', key_pages: '3' })),
    )
    expect(sources.store).toHaveBeenCalledTimes(1)
  })

  it('offers only a new course to a teacher who may edit none', async () => {
    const { user } = renderHome({ courses: [viewed] })
    const dialog = await openDialog(user)

    expect(await dialog.findByRole('group', { name: 'New course' })).toBeInTheDocument()
    expect(dialog.queryByRole('combobox', { name: 'Course' })).not.toBeInTheDocument()
    expect(dialog.queryByRole('combobox', { name: 'Topic' })).not.toBeInTheDocument()
    expect(dialog.getByRole('textbox', { name: 'Name of the new topic' })).toBeInTheDocument()
  })

  it('tells a teacher without a provider key why, with the way to Settings, before the form', async () => {
    const { user } = renderHome({ hasKey: false })
    const dialog = await openDialog(user)

    expect(
      await dialog.findByText(/Reading and transcribing the test is paid by your AI provider key; add one in/),
    ).toBeInTheDocument()
    expect(dialog.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
    expect(dialog.queryByLabelText('Test file')).not.toBeInTheDocument()
  })

  it('lands on the classroom material while the test is being read, then transcribed', async () => {
    const { user } = renderHome()
    const dialog = await openDialog(user)

    // The first course the teacher may edit, and its first topic.
    await user.upload(await dialog.findByLabelText('Test file'), test)
    await user.click(dialog.getByRole('button', { name: 'Transcribe' }))

    const material = within(await screen.findByRole('region', { name: 'Classroom material' }))
    expect(await material.findByRole('status')).toHaveTextContent('Reading the text…')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps what was created when a file is refused, so trying again creates and uploads it no more', async () => {
    const { history, courses, sources, materials, user } = renderHome()
    const dialog = await openDialog(user)

    await user.selectOptions(await dialog.findByRole('combobox', { name: 'Course' }), 'New course…')
    await fillNewCourse(dialog, user)
    await user.upload(dialog.getByLabelText('Test file'), test)
    const empty = new File([], 'Klíč.txt', { type: 'text/plain' })
    await user.upload(dialog.getByLabelText('Answer key file, if you have one'), empty)
    await user.click(dialog.getByRole('button', { name: 'Transcribe' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent('The file is empty.')
    expect(await dialog.findByRole('combobox', { name: 'Course' })).toHaveDisplayValue('Dějepis 2.A')
    expect(await dialog.findByRole('combobox', { name: 'Topic' })).toHaveDisplayValue('Pravěk')
    await user.upload(dialog.getByLabelText('Answer key file, if you have one'), answers)
    await user.click(dialog.getByRole('button', { name: 'Transcribe' }))

    await waitFor(() => expect(history.get()).toBe('/courses/102/topics/1000?tab=materials'))
    expect(courses.create).toHaveBeenCalledTimes(1)
    expect(courses.addTopic).toHaveBeenCalledTimes(1)
    expect(sources.store).toHaveBeenCalledTimes(3)
    expect(materials.transcribe).toHaveBeenCalledWith(102, 1000, transcription(100, 101))
  })
})
