import { createMemoryHistory } from '@solidjs/router'
import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { admin, fakeAuthApi } from '../auth/testing'
import { withI18n } from '../lesson/testing'
import { jana, petr } from '../students/testing'
import type { Release } from './api'
import { fakeRunsApi } from './testing'

const teacher: Account = { ...admin, roles: ['teacher'] }

function renderRuns(options: { runs?: Parameters<typeof fakeRunsApi>[0] } = {}) {
  const history = createMemoryHistory()
  history.set({ value: '/runs' })
  const runs = fakeRunsApi(options.runs)
  render(withI18n(() => <App apis={fakeApis({ auth: fakeAuthApi({ signedIn: teacher }), runs })} history={history} />))
  return { runs }
}

const latest = { id: 3, title: 'Pretérito in class', released_at: '2026-09-24T08:00:00Z' } as Release

describe('my course runs', () => {
  it('lists every run the teacher teaches, with its course, students and latest release', async () => {
    renderRuns({
      runs: {
        runs: [
          { id: 7, courseId: 1, name: 'Španělština 2.B 2026/27', classIds: [1], studentIds: [petr.id] },
          { id: 8, courseId: 4, name: 'Algebra 2026/27', classIds: [], studentIds: [] },
        ],
        courseNames: { 4: 'Algebra 1.A' },
        releases: { 7: [{ ...latest, retracted_at: null } as Release] },
        students: [jana, petr],
      },
    })

    const table = await screen.findByRole('table', { name: 'Course runs' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual([
      'Algebra 2026/27',
      'Španělština 2.B 2026/27',
    ])
    const spanish = within(rows[1])
    expect(spanish.getByRole('link', { name: 'Španělština 2.B 2026/27' })).toHaveAttribute('href', '/runs/7')
    expect(spanish.getByRole('link', { name: 'Španělština 2.B' })).toHaveAttribute('href', '/courses/1')
    expect(spanish.getByText('2')).toBeInTheDocument()
    expect(spanish.getByRole('link', { name: 'Pretérito in class' })).toHaveAttribute('href', '/runs/7/releases/3')
    expect(within(rows[0]).getByText('Nothing released yet')).toBeInTheDocument()
  })

  it('says how to start one when there is none', async () => {
    renderRuns()

    expect(await screen.findByText('You teach no course run yet. Start one from a course.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to courses' })).toHaveAttribute('href', '/courses')
  })

  it('counts a run started meanwhile', async () => {
    const history = createMemoryHistory()
    history.set({ value: '/courses/1?tab=runs' })
    const runs = fakeRunsApi()
    const apis = fakeApis({ auth: fakeAuthApi({ signedIn: teacher }), runs })
    render(withI18n(() => <App apis={apis} history={history} />))
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Run name'), 'Běh 2.B')
    await user.click(screen.getByRole('button', { name: 'Start a run' }))

    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(await within(within(nav).getByRole('link', { name: /Course runs/ })).findByText('1')).toBeInTheDocument()
  })

  it('counts the runs in the navigation', async () => {
    renderRuns({ runs: { runs: [{ id: 7, courseId: 1, name: 'Běh', classIds: [], studentIds: [] }] } })

    const nav = await screen.findByRole('navigation', { name: 'Main' })
    const link = within(nav).getByRole('link', { name: /Course runs/ })
    expect(await within(link).findByText('1')).toBeInTheDocument()
  })
})
