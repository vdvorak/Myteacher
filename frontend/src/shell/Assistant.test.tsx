import { createMemoryHistory } from '@solidjs/router'
import { render, screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { admin, fakeAuthApi } from '../auth/testing'
import type { RecentJob } from '../jobs/api'
import { fakeJobsApi } from '../jobs/testing'
import { withI18n } from '../lesson/testing'
import { noticeJobs } from './Assistant'

const teacher: Account = { ...admin, roles: ['teacher'] }

const proposal: RecentJob = {
  id: 501,
  kind: 'concept_map',
  state: 'running',
  progress: 'asking_assistant',
  result: null,
  error_kind: null,
  raw_output: null,
  course_name: 'Španělština 2.B',
  place: { course_id: 1, topic_id: 2, run_id: null, release_id: null },
  created_at: '2026-09-25T08:00:00Z',
}
const assessing: RecentJob = {
  ...proposal,
  id: 502,
  kind: 'open_assessment',
  state: 'succeeded',
  progress: null,
  place: { course_id: 1, topic_id: null, run_id: 7, release_id: 3 },
}

function renderShell(recent: RecentJob[] = []) {
  const history = createMemoryHistory()
  history.set({ value: '/settings' })
  const jobs = fakeJobsApi({ recent })
  render(withI18n(() => <App apis={fakeApis({ auth: fakeAuthApi({ signedIn: teacher }), jobs })} history={history} />))
  return { jobs, user: userEvent.setup() }
}

describe('assistant indicator', () => {
  it('stays away while the teacher started nothing lately', async () => {
    renderShell()

    await screen.findByRole('heading', { name: 'Settings' })
    expect(screen.queryByRole('button', { name: /Assistant/ })).not.toBeInTheDocument()
  })

  it('says how much work runs and lists the recent work with where it is', async () => {
    const { user } = renderShell([proposal, assessing])

    await user.click(await screen.findByRole('button', { name: 'Assistant working · 1' }))

    const list = screen.getByRole('list', { name: 'Recent assistant work' })
    const [first, second] = within(list).getAllByRole('listitem')
    expect(first).toHaveTextContent('Concept map proposal · Španělština 2.B')
    expect(first).toHaveTextContent('Working')
    expect(within(first).getByRole('link', { name: 'Show' })).toHaveAttribute('href', '/courses/1/topics/2?tab=map')
    expect(second).toHaveTextContent('Assessing open answers')
    expect(second).toHaveTextContent('Done')
    expect(within(second).getByRole('link', { name: 'Show' })).toHaveAttribute('href', '/runs/7/releases/3')
  })

  it('announces work that ended while the teacher was in the app, with a link to the result', async () => {
    const { jobs, user } = renderShell([proposal])
    await screen.findByRole('button', { name: 'Assistant working · 1' })

    jobs.endRecent(proposal.id, { state: 'succeeded', error_kind: null, raw_output: null })

    const notice = await screen.findByRole('status', { name: 'Assistant work done' })
    expect(notice).toHaveTextContent('Done: Concept map proposal · Španělština 2.B')
    expect(within(notice).getByRole('link', { name: 'Show' })).toHaveAttribute('href', '/courses/1/topics/2?tab=map')
    expect(await screen.findByRole('button', { name: 'Assistant' })).toBeInTheDocument()
    await user.click(within(notice).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('status', { name: 'Assistant work done' })).not.toBeInTheDocument()
  })

  it('points a failure to its fix', async () => {
    const { jobs } = renderShell([proposal])
    await screen.findByRole('button', { name: 'Assistant working · 1' })

    jobs.endRecent(proposal.id, { state: 'failed', error_kind: 'no_key', raw_output: null })

    const notice = await screen.findByRole('alert', { name: 'Assistant work failed' })
    expect(notice).toHaveTextContent('Failed: Concept map proposal · Španělština 2.B')
    expect(within(notice).getByRole('link', { name: 'Fix it' })).toHaveAttribute('href', '/settings')
  })

  it('keeps watching running work after a failed look', async () => {
    const { jobs } = renderShell([proposal])
    await screen.findByRole('button', { name: 'Assistant working · 1' })

    jobs.recent.mockRejectedValueOnce(new Error('offline'))
    jobs.endRecent(proposal.id, { state: 'succeeded', error_kind: null, raw_output: null })

    expect(await screen.findByRole('status', { name: 'Assistant work done' })).toBeInTheDocument()
  })

  it('announces ended work once, whatever order the answers come in', async () => {
    const { jobs } = renderShell([proposal])
    await screen.findByRole('button', { name: 'Assistant working · 1' })
    // A look still waiting for its answer, which will say the job runs.
    let answerLate: (jobs: RecentJob[]) => void = () => {}
    jobs.recent.mockImplementationOnce(() => new Promise((resolve) => (answerLate = resolve)))
    await waitFor(() => expect(jobs.recent.mock.calls.length).toBeGreaterThan(1))

    jobs.endRecent(proposal.id, { state: 'succeeded', error_kind: null, raw_output: null })
    noticeJobs()
    await screen.findByRole('status', { name: 'Assistant work done' })
    answerLate([proposal])
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(screen.getAllByRole('status', { name: 'Assistant work done' })).toHaveLength(1)
  })

  it('does not announce work that had ended before the page opened', async () => {
    renderShell([assessing])

    await screen.findByRole('button', { name: 'Assistant' })
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Assistant work done' })).not.toBeInTheDocument())
  })
})
