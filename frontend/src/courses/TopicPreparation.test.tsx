import { createMemoryHistory } from '@solidjs/router'
import { render, screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { fakeAuthApi, invitedTeacher } from '../auth/testing'
import type { ConceptMap } from '../concepts/api'
import { fakeConceptsApi, preteritMap, type ScriptedProposal } from '../concepts/testing'
import { fakeJobsApi } from '../jobs/testing'
import { withI18n } from '../lesson/testing'
import type { Course, Topic } from './api'
import { fakeCoursesApi, spanish, topicFixture } from './testing'

const teacher: Account = { ...invitedTeacher, language: 'en' }
const topics: Topic[] = [
  topicFixture({ id: 1, name: 'Presente', position: 0 }),
  topicFixture({ id: 2, name: 'Pretérito indefinido', position: 1 }),
  topicFixture({ id: 3, name: 'Imperfecto', position: 2 }),
]
const approved: ConceptMap = { ...preteritMap, id: 7, topic_id: 1, state: 'approved', approved_before: true }
const proposal: ScriptedProposal = {
  concepts: [
    { name: 'estar', description: 'Estuve, estuviste, estuvo.' },
    { name: 'tener', description: 'Tuve, tuviste, tuvo.' },
  ],
}

function renderCourse(
  options: { course?: Course; maps?: Record<number, ConceptMap>; proposals?: ScriptedProposal[]; hasKey?: boolean } = {},
) {
  const course = options.course ?? spanish
  const history = createMemoryHistory()
  history.set({ value: `/courses/${course.id}?tab=topics` })
  const jobs = fakeJobsApi()
  const courses = fakeCoursesApi({ courses: [course], topics: { [course.id]: topics } })
  const concepts = fakeConceptsApi({
    maps: options.maps ?? { 1: approved },
    proposals: options.proposals,
    topics: topics.map((t) => t.id),
    jobs,
    hasKey: options.hasKey,
  })
  const apis = fakeApis({ auth: fakeAuthApi({ signedIn: teacher }), courses, concepts, jobs })
  render(withI18n(() => <App apis={apis} history={history} />, 'en'))
  return { concepts }
}

const topicsSection = async () => within(await screen.findByRole('region', { name: 'Topics' }))
const itemOf = async (name: string) => {
  const list = within(await screen.findByRole('list', { name: 'Topics' }))
  return within(list.getAllByRole('listitem').find((li) => li.textContent?.includes(name) || within(li).queryByDisplayValue(name))!)
}

describe('preparing all topics', () => {
  it('shows where the concept map of every topic stands', async () => {
    renderCourse({ maps: { 1: approved, 2: { ...preteritMap, topic_id: 2 } } })

    expect(await (await itemOf('Presente')).findByText('Concept map approved.')).toBeInTheDocument()
    expect((await itemOf('Pretérito indefinido')).getByText('Draft concept map with 3 concepts.')).toBeInTheDocument()
    expect((await itemOf('Imperfecto')).getByText('No concept map yet.')).toBeInTheDocument()
  })

  it('proposes a map for every topic without one as jobs and shows their progress', async () => {
    const { concepts } = renderCourse({ proposals: [proposal, proposal] })
    const user = userEvent.setup()

    await user.click((await topicsSection()).getByRole('button', { name: 'Prepare all topics' }))

    expect(concepts.prepare).toHaveBeenCalledWith(1)
    expect(await (await topicsSection()).findByText('Proposing concepts for 2 topics; 1 skipped.')).toBeInTheDocument()
    await waitFor(async () =>
      expect((await itemOf('Imperfecto')).getByText('Draft concept map with 2 concepts.')).toBeInTheDocument(),
    )
    expect((await itemOf('Pretérito indefinido')).getByText('Draft concept map with 2 concepts.')).toBeInTheDocument()
    expect((await itemOf('Presente')).getByText('Concept map approved.')).toBeInTheDocument()
  })

  it('shows a running proposal while it runs', async () => {
    renderCourse({ proposals: [proposal, proposal] })
    const user = userEvent.setup()

    await user.click((await topicsSection()).getByRole('button', { name: 'Prepare all topics' }))

    expect(await (await itemOf('Imperfecto')).findByText('The assistant is proposing concepts…')).toBeInTheDocument()
  })

  it('says why the proposal of a topic failed', async () => {
    const { concepts } = renderCourse({
      maps: { 1: approved, 2: { ...preteritMap, topic_id: 2 } },
      proposals: [{ fail: 'quota' }],
    })
    const user = userEvent.setup()

    await user.click((await topicsSection()).getByRole('button', { name: 'Prepare all topics' }))

    // Once the statuses were read again after the job ended.
    await waitFor(async () => expect((await itemOf('Imperfecto')).getByText(/run out of credit/)).toBeInTheDocument())
    await waitFor(() => expect(concepts.statuses).toHaveBeenCalledTimes(3))
    expect((await itemOf('Imperfecto')).getByText(/run out of credit/)).toBeInTheDocument()
    expect((await itemOf('Pretérito indefinido')).getByText('Draft concept map with 3 concepts.')).toBeInTheDocument()
  })

  it('needs a provider key', async () => {
    renderCourse({ hasKey: false })
    const user = userEvent.setup()

    await user.click((await topicsSection()).getByRole('button', { name: 'Prepare all topics' }))

    expect(await (await topicsSection()).findByText(/Add an AI provider key/)).toBeInTheDocument()
  })

  it('lets a viewer follow the progress but not prepare', async () => {
    renderCourse({ course: { ...spanish, can_edit: false } })

    expect(await (await itemOf('Presente')).findByText('Concept map approved.')).toBeInTheDocument()
    expect((await topicsSection()).queryByRole('button', { name: 'Prepare all topics' })).not.toBeInTheDocument()
  })
})
