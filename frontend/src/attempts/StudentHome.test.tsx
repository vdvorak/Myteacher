import { createMemoryHistory } from '@solidjs/router'
import { render, screen, within } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { fakeAuthApi, student } from '../auth/testing'
import { withI18n } from '../lesson/testing'
import type { ReleaseDetail } from './api'
import { fakeAttemptsApi, releaseOf } from './testing'

const jana: Account = { ...student, name: 'Jana Veselá', language: 'en' }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-25T12:00:00Z'))
})
afterEach(() => vi.useRealTimers())

function home(releases: ReleaseDetail[]) {
  const history = createMemoryHistory()
  history.set({ value: '/' })
  const apis = fakeApis({ auth: fakeAuthApi({ signedIn: jana }), attempts: fakeAttemptsApi({ releases }) })
  render(withI18n(() => <App apis={apis} history={history} />, 'en'))
}

const toDo = async () => within(await screen.findByRole('region', { name: 'To do' }))
const done = async () => within(await screen.findByRole('region', { name: 'Done' }))
const cardOf = async (region: ReturnType<typeof within>, title: string) =>
  within(region.getByRole('heading', { name: title }).closest('article')!)

describe('the student’s home', () => {
  it('greets the student by name', async () => {
    home([])

    expect(await screen.findByRole('heading', { level: 1, name: 'Hello, Jana Veselá' })).toBeInTheDocument()
  })

  it('lists the work to do: overdue first, then by due date, then the new', async () => {
    home([
      releaseOf({ id: 1, title: 'New one', released_at: '2026-09-24T08:00:00Z' }),
      releaseOf({ id: 2, title: 'Due later', due_at: '2026-10-05T18:00:00Z' }),
      releaseOf({ id: 3, title: 'Overdue', due_at: '2026-09-20T18:00:00Z' }),
      releaseOf({ id: 4, title: 'Due soon', due_at: '2026-09-26T18:00:00Z' }),
    ])

    const titles = (await toDo()).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(titles).toEqual(['Overdue', 'Due soon', 'Due later', 'New one'])
  })

  it('labels overdue work and work due soon, with the course', async () => {
    home([
      releaseOf({ id: 3, title: 'Overdue', due_at: '2026-09-20T18:00:00Z' }),
      releaseOf({ id: 4, title: 'Due soon', due_at: '2026-09-26T18:00:00Z' }),
    ])

    const region = await toDo()
    const overdue = await cardOf(region, 'Overdue')
    expect(overdue.getByText(/^Overdue since/)).toHaveAttribute('data-tone', 'incorrect')
    expect(overdue.getByText('Španělština 2.B')).toBeInTheDocument()
    expect(region.getByRole('heading', { name: 'Overdue' }).closest('article')).toHaveAttribute('data-state', 'overdue')
    const soon = await cardOf(region, 'Due soon')
    expect(soon.getByText(/^Due /, { selector: '.work-due' })).toHaveAttribute('data-tone', 'warning')
  })

  it('starts new work, and continues work begun with how far it got', async () => {
    home([
      releaseOf({ id: 1, title: 'New one' }),
      releaseOf({ id: 2, title: 'Begun', state: 'in_progress', progress: { answered: 4, total: 10 } }),
    ])

    const region = await toDo()
    expect((await cardOf(region, 'New one')).getByRole('link', { name: 'Start' })).toHaveAttribute('href', '/work/1')
    const begun = (await cardOf(region, 'Begun')).getByRole('link', { name: 'Continue · 4 of 10' })
    expect(begun).toHaveAttribute('href', '/work/2')
    expect(begun).toHaveAttribute('data-variant', 'filled')
  })

  it('lists done work with its score, marking results published since the last look', async () => {
    home([
      releaseOf({
        id: 5,
        title: 'Pretérito',
        state: 'submitted',
        score: { points: 4.5, total: 6, pending: 0 },
        new_assessment: true,
      }),
      releaseOf({ id: 6, title: 'Ser y estar', state: 'submitted', score: { points: 5, total: 6, pending: 1 } }),
    ])

    const region = await done()
    const preterite = await cardOf(region, 'Pretérito')
    expect(preterite.getByText('75 %')).toBeInTheDocument()
    expect(preterite.getByText('New assessment')).toBeInTheDocument()
    expect(preterite.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/work/5')
    const waiting = await cardOf(region, 'Ser y estar')
    expect(waiting.getByText('Written answers wait for your teacher.')).toBeInTheDocument()
    expect(waiting.queryByText('New assessment')).not.toBeInTheDocument()
  })

  it('folds away older done work', async () => {
    home(
      [1, 2, 3, 4, 5].map((n) =>
        releaseOf({ id: n, title: `Work ${n}`, state: 'submitted', score: { points: 1, total: 1, pending: 0 } }),
      ),
    )

    const region = await done()
    const older = region.getByText('Older work (2)').closest('details')!
    expect(older).not.toHaveAttribute('open')
    expect(within(older).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Work 4', 'Work 5'])
  })

  it('keeps retracted work with the teacher’s reason', async () => {
    home([
      releaseOf({ id: 7, title: 'Withdrawn', retraction: { reason: 'Wrong material.', whole_release: true }, can_start: false }),
      releaseOf({ id: 8, title: 'Again', retraction: { reason: 'A typo.', whole_release: false } }),
    ])

    const withdrawn = await cardOf(await done(), 'Withdrawn')
    expect(withdrawn.getByText('Your teacher withdrew this work: Wrong material.')).toBeInTheDocument()
    const again = await cardOf(await toDo(), 'Again')
    expect(again.getByText('Your teacher retracted your attempt: A typo.')).toBeInTheDocument()
  })

  it('offers only opening work that can no longer be started', async () => {
    home([releaseOf({ id: 3, title: 'Overdue', due_at: '2026-09-20T18:00:00Z', late_submissions: 'refuse', can_start: false })])

    const card = await cardOf(await toDo(), 'Overdue')
    expect(card.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/work/3')
    expect(card.queryByRole('link', { name: 'Start' })).not.toBeInTheDocument()
  })

  it('names the work each button is for', async () => {
    home([releaseOf({ id: 1, title: 'New one' })])

    expect((await cardOf(await toDo(), 'New one')).getByRole('link', { name: 'Start' })).toHaveAccessibleDescription('New one')
  })

  it('says why an attempt at done work was retracted', async () => {
    home([
      releaseOf({
        id: 9,
        title: 'Repeated',
        state: 'submitted',
        score: { points: 0, total: 0, pending: 0 },
        retraction: { reason: 'A typo.', whole_release: false },
      }),
    ])

    const card = await cardOf(await done(), 'Repeated')
    expect(card.getByText('Your teacher retracted your attempt: A typo.')).toBeInTheDocument()
    expect(card.getByText('0 %')).toBeInTheDocument()
  })

  it('says where work will appear before there is any', async () => {
    home([])

    expect(await screen.findByText('Your work will appear here once your teacher sends you some.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Done' })).not.toBeInTheDocument()
  })
})
