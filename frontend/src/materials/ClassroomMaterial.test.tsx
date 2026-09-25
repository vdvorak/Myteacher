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
import type { Course } from '../courses/api'
import { fakeCoursesApi, spanish, topicFixture } from '../courses/testing'
import { fakeJobsApi } from '../jobs/testing'
import { sampleLesson, withI18n } from '../lesson/testing'
import { fakeStudentsApi, jana } from '../students/testing'
import type { Material } from './api'
import { fakeMaterialsApi, serEstarMaterial, written, type ScriptedMaterial } from './testing'

const teacher: Account = { ...invitedTeacher, language: 'en' }
const approvedMap: ConceptMap = { ...preteritMap, state: 'approved', approved_at: '2026-09-24T08:00:00Z', approved_before: true }
const shorter: ScriptedMaterial = { ...written, lesson: { ...sampleLesson, title: 'Ser o estar, short' } }

function renderApp(
  path: string,
  options: { materials?: Material[]; map?: ConceptMap; course?: Course; script?: ScriptedMaterial[] } = {},
) {
  const course = options.course ?? spanish
  const history = createMemoryHistory()
  history.set({ value: path })
  const jobs = fakeJobsApi()
  const materials = fakeMaterialsApi({ materials: { 2: options.materials ?? [] }, script: options.script, jobs })
  const apis = fakeApis({
    auth: fakeAuthApi({ signedIn: teacher }),
    courses: fakeCoursesApi({
      courses: [course],
      topics: { [course.id]: [topicFixture({ id: 2, name: 'Pretérito indefinido', position: 0 })] },
    }),
    concepts: fakeConceptsApi({ maps: { 2: options.map ?? approvedMap }, jobs }),
    students: fakeStudentsApi(),
    materials,
    jobs,
  })
  render(withI18n(() => <App apis={apis} history={history} />, 'en'))
  return { materials }
}

const renderTopic = (options: Parameters<typeof renderApp>[1] = {}) => renderApp('/courses/1/topics/2', options)
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

  it('asks for an approved concept map first', async () => {
    renderTopic({ map: preteritMap })

    const materialSection = await section()
    expect(materialSection.getByText('Approve the concept map to generate material from it.')).toBeInTheDocument()
    expect(materialSection.queryByRole('button', { name: 'Generate material' })).not.toBeInTheDocument()
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

  it('says why a rework failed until the teacher moves on', async () => {
    renderTopic({ materials: [serEstarMaterial], script: [{ fail: 'quota' }] })
    const user = userEvent.setup()
    const material = await item('Ser, or estar?')

    await user.type(material.getByRole('textbox', { name: 'Instruction' }), 'Shorter.')
    await user.click(material.getByRole('button', { name: 'Rework' }))
    await waitFor(async () => expect((await item('Ser, or estar?')).getByText(/run out of credit/)).toBeInTheDocument())
    await user.click((await item('Ser, or estar?')).getByRole('button', { name: 'Keep as it is' }))

    await waitFor(async () =>
      expect((await item('Ser, or estar?')).queryByText(/run out of credit/)).not.toBeInTheDocument(),
    )
    expect((await item('Ser, or estar?')).getByText('Version 1')).toBeInTheDocument()
  })

  it('records that the teacher keeps the material as it is', async () => {
    const { materials } = renderTopic({ materials: [serEstarMaterial] })
    const user = userEvent.setup()
    const material = await item('Ser, or estar?')

    await user.click(material.getByRole('button', { name: 'Keep as it is' }))

    expect(materials.keep).toHaveBeenCalledWith(1, 2, 41)
    expect(await material.findByRole('status')).toHaveTextContent('Noted: kept as it is.')
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
    expect(material.queryByRole('button')).not.toBeInTheDocument()
    expect(material.queryByRole('textbox')).not.toBeInTheDocument()
    expect((await section()).queryByRole('button', { name: 'Generate material' })).not.toBeInTheDocument()
  })
})

describe('classroom material preview', () => {
  it('renders the exercises and the answer key after them', async () => {
    renderApp('/preview/courses/1/topics/2/materials/41', { materials: [serEstarMaterial] })

    expect(await screen.findByRole('heading', { level: 1, name: 'Ser, or estar?' })).toBeInTheDocument()
    const key = screen.getByRole('region', { name: 'Answer key' })
    expect(within(key).getAllByRole('listitem')[0]).toHaveTextContent('está')
  })

  it('says when the material is not there', async () => {
    renderApp('/preview/courses/1/topics/2/materials/99')

    expect(await screen.findByRole('alert')).toHaveTextContent('No classroom material here.')
  })
})
