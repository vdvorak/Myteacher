import { createMemoryHistory } from '@solidjs/router'
import { render, screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { fakeAuthApi, invitedTeacher } from '../auth/testing'
import type { Topic } from '../courses/api'
import { fakeCoursesApi, spanish, topicFixture } from '../courses/testing'
import { fakeJobsApi } from '../jobs/testing'
import { withI18n } from '../lesson/testing'
import type { ConceptMap } from './api'
import { fakeConceptsApi, preteritMap } from './testing'

const teacher: Account = { ...invitedTeacher, language: 'en' }
const approvedMap: ConceptMap = { ...preteritMap, state: 'approved', approved_at: '2026-09-24T09:00:00Z' }

function renderTopic(options: { map?: ConceptMap; topic?: Partial<Topic>; tab?: string } = {}) {
  const history = createMemoryHistory()
  history.set({ value: `/courses/1/topics/2${options.tab ? `?tab=${options.tab}` : ''}` })
  const jobs = fakeJobsApi()
  const topic = topicFixture({ id: 2, name: 'Pretérito indefinido', position: 0, ...options.topic })
  const courses = fakeCoursesApi({ courses: [spanish], topics: { 1: [topic] } })
  const concepts = fakeConceptsApi({ maps: options.map ? { 2: options.map } : {}, jobs })
  const apis = fakeApis({ auth: fakeAuthApi({ signedIn: teacher }), courses, concepts, jobs })
  render(withI18n(() => <App apis={apis} history={history} />, 'en'))
}

const steps = () => screen.findByRole('navigation', { name: 'Topic steps' })
const names = async () =>
  within(await steps())
    .getAllByRole('link')
    .map((link) => link.getAttribute('aria-current') === 'page' ? `[${link.textContent}]` : link.textContent)
const nextStep = () => screen.findByRole('complementary', { name: 'Next step' })

describe('topic steps', () => {
  it('opens on the concept map and keeps what is made from it locked until it is approved', async () => {
    renderTopic()

    await screen.findByRole('region', { name: 'Concepts' })
    expect(await names()).toEqual([
      '1Additions, open',
      '[2Concept map, do this next]',
      '3Reference documents, locked',
      '4Classroom material, locked',
    ])
    expect(await nextStep()).toHaveTextContent('Let the assistant propose the concept map, or add the concepts yourself.')
  })

  it('says why a locked step is locked', async () => {
    renderTopic({ tab: 'materials' })

    expect(
      await screen.findByText('This step opens once the concept map is approved: everything here is made from it.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Classroom material' })).not.toBeInTheDocument()
  })

  it('puts approving at the head of the map step', async () => {
    renderTopic({ map: preteritMap })

    const concepts = await screen.findByRole('region', { name: 'Concepts' })
    const heading = within(concepts).getByRole('heading', { name: 'Concepts' })
    expect(heading.nextElementSibling).toHaveAccessibleName('Approve the map')
    expect(await nextStep()).toHaveTextContent('Review the proposed concepts, then approve the map.')
  })

  it('moves on to classroom material once the map is approved', async () => {
    renderTopic({ map: approvedMap, topic: { concept_map: 'approved' } })

    await screen.findByRole('region', { name: 'Classroom material' })
    expect(await names()).toEqual([
      '1Additions, open',
      '✓Concept map, done',
      '3Reference documents, open',
      '[4Classroom material, do this next]',
    ])
    expect(await nextStep()).toHaveTextContent('Create classroom material from the approved map.')
  })

  it('points to releasing once there is material', async () => {
    renderTopic({ map: approvedMap, topic: { concept_map: 'approved', materials: 1 } })

    const next = await nextStep()
    expect(next).toHaveTextContent('Release the material to your students in a course run.')
    expect(within(next).getByRole('link', { name: 'Open the course runs' })).toHaveAttribute('href', '/courses/1?tab=runs')
  })

  it('stays on the map once it is approved', async () => {
    renderTopic({ map: preteritMap })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Approve the map' }))

    await waitFor(async () => expect((await names())[1]).toBe('[✓Concept map, done]'))
    expect(screen.getByRole('region', { name: 'Concepts' })).toBeInTheDocument()
  })

  it('keeps what a topic holds within reach while its map is reopened', async () => {
    renderTopic({ map: preteritMap, topic: { concept_map: 'draft', materials: 1 }, tab: 'materials' })

    expect(await screen.findByRole('region', { name: 'Classroom material' })).toBeInTheDocument()
    expect(screen.queryByText(/This step opens once the concept map is approved/)).not.toBeInTheDocument()
    expect((await names())[3]).toBe('[4Classroom material, open]')
    const region = await screen.findByRole('region', { name: 'Classroom material' })
    expect(within(region).getByRole('link', { name: 'Open the concept map' })).toHaveAttribute(
      'href',
      '/courses/1/topics/2?tab=map',
    )
  })

  it('marks the additions done once the teacher gave some', async () => {
    renderTopic({ topic: { additions: { goals: 'Tell stories in the past.', prior_knowledge: null, emphasis: null, notes: null } } })

    expect((await names())[0]).toBe('✓Additions, done')
  })
})
