import { createMemoryHistory } from '@solidjs/router'
import { render, screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { fakeAuthApi, invitedTeacher } from '../auth/testing'
import type { Course, Topic } from '../courses/api'
import { fakeCoursesApi, spanish, topicFixture } from '../courses/testing'
import { fakeJobsApi } from '../jobs/testing'
import { withI18n } from '../lesson/testing'
import { ConceptMapRefused, type ConceptMap } from './api'
import { fakeConceptsApi, preteritMap, type ScriptedProposal } from './testing'

const teacher: Account = { ...invitedTeacher, language: 'en' }
const topics: Topic[] = [
  topicFixture({ id: 1, name: 'Presente', position: 0 }),
  topicFixture({ id: 2, name: 'Pretérito indefinido', position: 1 }),
]
const proposal: ScriptedProposal = {
  concepts: [
    { name: 'estar', description: 'Estuve, estuviste, estuvo.' },
    { name: 'tener', description: 'Tuve, tuviste, tuvo.', requires: ['estar'] },
  ],
}

function renderMap(options: { map?: ConceptMap; course?: Course; proposals?: ScriptedProposal[]; path?: string } = {}) {
  const course = options.course ?? spanish
  const history = createMemoryHistory()
  history.set({ value: options.path ?? `/courses/${course.id}/topics/2?tab=map` })
  const jobs = fakeJobsApi()
  const courses = fakeCoursesApi({ courses: [course], topics: { [course.id]: topics } })
  const concepts = fakeConceptsApi({ maps: options.map ? { 2: options.map } : {}, proposals: options.proposals, jobs })
  const apis = fakeApis({ auth: fakeAuthApi({ signedIn: teacher }), courses, concepts, jobs })
  render(withI18n(() => <App apis={apis} history={history} />, 'en'))
  return { concepts, history }
}

const conceptList = async () => within(await screen.findByRole('list', { name: 'Concepts' }))
const row = async (name: string) =>
  (await conceptList()).getAllByRole('listitem').find((li) => within(li).queryByDisplayValue(name))!
const shownNames = async () =>
  (await conceptList())
    .getAllByRole('listitem')
    .map((li) => (within(li).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value)

describe('concept map of a topic', () => {
  it('is reached from the topic in the course', async () => {
    const { history } = renderMap({ path: '/courses/1?tab=topics' })
    const user = userEvent.setup()

    const topicRow = (await screen.findByDisplayValue('Pretérito indefinido')).closest('li')!
    await user.click(within(topicRow).getByRole('link', { name: 'Open the topic' }))

    expect(history.get()).toBe('/courses/1/topics/2')
    expect(await screen.findByRole('heading', { name: 'Pretérito indefinido' })).toBeInTheDocument()
  })

  it('asks the assistant for a proposal and shows the proposed concepts', async () => {
    const { concepts } = renderMap({ proposals: [proposal] })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Propose concepts' }))

    expect(concepts.propose).toHaveBeenCalledWith(1, 2)
    expect(await shownNames()).toEqual(['estar', 'tener'])
    const tener = within(await row('tener'))
    expect(tener.getByRole('checkbox', { name: 'Requires estar' })).toBeChecked()
    expect(screen.getByText('Draft: not tracked until you approve it.')).toBeInTheDocument()
  })

  it('says why a proposal failed and keeps the concepts it had', async () => {
    const { concepts } = renderMap({ map: preteritMap, proposals: [{ fail: 'quota' }] })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Propose again' }))

    // Read again once the job ended, and the reason stays.
    await waitFor(() => expect(concepts.map).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/run out of credit/)).toBeInTheDocument()
    expect(await shownNames()).toEqual(['ser', 'ir', 'Completed actions'])
  })

  it('renames a concept, which keeps its identity', async () => {
    const { concepts } = renderMap({ map: preteritMap })
    const user = userEvent.setup()
    const ir = within(await row('ir'))

    await user.clear(ir.getByRole('textbox', { name: 'Name' }))
    await user.type(ir.getByRole('textbox', { name: 'Name' }), 'ir (pretérito)')
    await user.click(ir.getByRole('button', { name: 'Save' }))

    // Only what changed, so a co-editor's change to the rest is not undone.
    expect(concepts.change).toHaveBeenCalledWith(1, 2, 12, { name: 'ir (pretérito)' })
    expect(await shownNames()).toEqual(['ser', 'ir (pretérito)', 'Completed actions'])
  })

  it('sends only the prerequisites ticked and unticked, so that a co-editor\'s change stays', async () => {
    const { concepts } = renderMap({ map: preteritMap })
    const user = userEvent.setup()
    const actions = within(await row('Completed actions'))
    // A co-editor unticks ser meanwhile; this page still shows it ticked.
    await concepts.change(1, 2, 13, { remove_prerequisite_ids: [11] })

    await user.click(actions.getByRole('checkbox', { name: 'Requires ir' }))
    await user.click(actions.getByRole('button', { name: 'Save' }))

    expect(concepts.change).toHaveBeenLastCalledWith(1, 2, 13, { remove_prerequisite_ids: [12] })
    await waitFor(async () =>
      expect(within(await row('Completed actions')).getByRole('checkbox', { name: 'Requires ser' })).not.toBeChecked(),
    )
    expect(within(await row('Completed actions')).getByRole('checkbox', { name: 'Requires ir' })).not.toBeChecked()
  })

  it('adds a ticked prerequisite and saves nothing for one unticked and ticked again', async () => {
    const estar = { id: 14, name: 'estar', description: '', prerequisite_ids: [] }
    const { concepts } = renderMap({ map: { ...preteritMap, concepts: [...preteritMap.concepts, estar] } })
    const user = userEvent.setup()
    const row14 = within(await row('estar'))

    await user.click(row14.getByRole('checkbox', { name: 'Requires ir' }))
    await user.click(row14.getByRole('checkbox', { name: 'Requires ser' }))
    await user.click(row14.getByRole('checkbox', { name: 'Requires ir' }))
    await user.click(row14.getByRole('button', { name: 'Save' }))

    expect(concepts.change).toHaveBeenCalledWith(1, 2, 14, { add_prerequisite_ids: [11] })
    await waitFor(async () =>
      expect(within(await row('estar')).getByRole('checkbox', { name: 'Requires ser' })).toBeChecked(),
    )
  })

  it('forgets an unsaved prerequisite that left the map', async () => {
    const { concepts } = renderMap({ map: preteritMap })
    const user = userEvent.setup()
    const ser = within(await row('ser'))

    await user.click(ser.getByRole('checkbox', { name: 'Requires ir' }))
    await user.click(within(await row('ir')).getByRole('checkbox', { name: 'Choose ir to merge' }))
    await user.click(within(await row('Completed actions')).getByRole('checkbox', { name: 'Choose Completed actions to merge' }))
    await user.click(within(screen.getByRole('form', { name: 'Merge 2 concepts' })).getByRole('button', { name: 'Merge' }))
    await screen.findByDisplayValue('ir / Completed actions')
    await user.type(ser.getByRole('textbox', { name: 'Name' }), '!')
    await user.click(ser.getByRole('button', { name: 'Save' }))

    expect(concepts.change).toHaveBeenCalledWith(1, 2, 11, { name: 'ser!' })
  })

  it('merges the chosen concepts into a new one', async () => {
    const { concepts } = renderMap({ map: preteritMap })
    const user = userEvent.setup()

    await user.click(within(await row('ser')).getByRole('checkbox', { name: 'Choose ser to merge' }))
    await user.click(within(await row('ir')).getByRole('checkbox', { name: 'Choose ir to merge' }))
    const merge = within(screen.getByRole('form', { name: 'Merge 2 concepts' }))
    expect(merge.getByRole('textbox', { name: 'Name of the merged concept' })).toHaveValue('ser / ir')
    await user.click(merge.getByRole('button', { name: 'Merge' }))

    expect(concepts.merge).toHaveBeenCalledWith(1, 2, [11, 12], { name: 'ser / ir', description: '' })
    expect(await shownNames()).toEqual(['ser / ir', 'Completed actions'])
    expect(screen.queryByRole('form', { name: /Merge/ })).not.toBeInTheDocument()
  })

  it('splits a concept into parts', async () => {
    const { concepts } = renderMap({ map: preteritMap })
    const user = userEvent.setup()
    const ir = within(await row('ir'))

    await user.click(ir.getByRole('button', { name: 'Split' }))
    const split = within(screen.getByRole('form', { name: 'Split ir' }))
    await user.type(split.getByRole('textbox', { name: 'Name of part 1' }), 'ir: singular')
    await user.type(split.getByRole('textbox', { name: 'Name of part 2' }), 'ir: plural')
    await user.click(split.getByRole('button', { name: 'Split' }))

    expect(concepts.split).toHaveBeenCalledWith(1, 2, 12, [
      { name: 'ir: singular', description: '' },
      { name: 'ir: plural', description: '' },
    ])
    expect(await shownNames()).toEqual(['ser', 'ir: singular', 'ir: plural', 'Completed actions'])
  })

  it('removes a concept after confirming', async () => {
    const { concepts } = renderMap({ map: preteritMap })
    const user = userEvent.setup()

    await user.click(within(await row('ir')).getByRole('button', { name: 'Remove' }))
    expect(concepts.remove).not.toHaveBeenCalled()
    await user.click(within(await row('ir')).getByRole('button', { name: 'Remove ir for good' }))

    expect(concepts.remove).toHaveBeenCalledWith(1, 2, 12)
    expect(await shownNames()).toEqual(['ser', 'Completed actions'])
  })

  it('adds a concept', async () => {
    const { concepts } = renderMap({ map: preteritMap })
    const user = userEvent.setup()
    const form = within(await screen.findByRole('form', { name: 'New concept' }))

    await user.type(form.getByRole('textbox', { name: 'Name' }), 'estar')
    await user.click(form.getByRole('button', { name: 'Add concept' }))

    expect(concepts.add).toHaveBeenCalledWith(1, 2, { name: 'estar', description: '', prerequisite_ids: [] })
    expect((await shownNames()).at(-1)).toBe('estar')
  })

  it('approves the map as the teacher saw it, then reopens it for changes', async () => {
    const { concepts } = renderMap({ map: preteritMap })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Approve the map' }))

    expect(concepts.approve).toHaveBeenCalledWith(1, 2, preteritMap.version)
    expect(await screen.findByText('Approved: these concepts are tracked.')).toBeInTheDocument()
    // An approved map is read, not edited, and not proposed again.
    const list = await screen.findByRole('list', { name: 'Concepts' })
    expect(within(list).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('Requires: ser')
    expect(screen.queryByRole('button', { name: /Propose/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reopen for changes' }))

    expect(concepts.reopen).toHaveBeenCalledWith(1, 2)
    expect(await shownNames()).toEqual(['ser', 'ir', 'Completed actions'])
    expect(screen.queryByRole('button', { name: /Propose/ })).not.toBeInTheDocument()
  })

  it('reloads the map when it changed since the teacher saw it', async () => {
    const { concepts } = renderMap({ map: preteritMap })
    concepts.approve.mockRejectedValueOnce(new ConceptMapRefused('map_changed'))
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Approve the map' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The map changed meanwhile and was reloaded. Check it again.')
    expect(concepts.map).toHaveBeenCalledTimes(2)
  })

  it('says why a change of the prerequisites was refused', async () => {
    const { concepts } = renderMap({ map: preteritMap })
    const user = userEvent.setup()
    const ser = within(await row('ser'))

    await user.click(ser.getByRole('checkbox', { name: 'Requires Completed actions' }))
    concepts.change.mockRejectedValueOnce(new ConceptMapRefused('prerequisite_cycle'))
    await user.click(ser.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The prerequisites would go round in a circle.')
  })

  it('shows the map read-only to a teacher who may only view the course', async () => {
    renderMap({ map: preteritMap, course: { ...spanish, can_edit: false } })

    const list = await screen.findByRole('list', { name: 'Concepts' })
    expect(within(list).getAllByRole('listitem')[2]).toHaveTextContent('Completed actions')
    expect(within(list).getAllByRole('listitem')[2]).toHaveTextContent('Requires: ser, ir')
    expect(within(screen.getByRole('region', { name: 'Concepts' })).queryByRole('button')).not.toBeInTheDocument()
  })
})
