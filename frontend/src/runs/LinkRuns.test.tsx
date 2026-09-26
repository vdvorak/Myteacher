import { createMemoryHistory } from '@solidjs/router'
import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { fakeAuthApi, invitedTeacher } from '../auth/testing'
import { fakeCoursesApi, spanish } from '../courses/testing'
import type { Locale } from '../i18n/messages'
import { withI18n } from '../lesson/testing'
import { defaultSettings, type ReleasableMaterial, type Release, type ReleaseResults } from './api'
import { fakeRunsApi } from './testing'

const preterite: ReleasableMaterial = {
  id: 4,
  topic: 'Pretérito indefinido',
  title: 'Pretérito in class',
  versions: [1],
  target_student_ids: [],
}
const released: Release = {
  ...defaultSettings,
  id: 1,
  material_id: 4,
  title: 'Pretérito in class',
  topic: 'Pretérito indefinido',
  topic_id: 2,
  version: 1,
  audience: 'run',
  students: [],
  released_by_id: 2,
  released_at: '2026-09-24T08:00:00Z',
  retracted_at: null,
  retraction_reason: null,
}
const twoJans = [
  { id: 1, name: 'Jan Novák (1)', joined_at: '2026-09-25T08:00:00Z' },
  { id: 2, name: 'Jan Novák (2)', joined_at: '2026-09-25T08:03:00Z' },
]

const teacher: Account = { ...invitedTeacher, language: null }

afterEach(() => vi.useRealTimers())

const linkRun = (
  participants: { id: number; name: string; joined_at: string }[] = [],
  state: { erasedAt?: string; closed?: boolean } = {},
) => ({
  id: 7,
  courseId: spanish.id,
  name: 'Den otevřených dveří',
  classIds: [],
  studentIds: [],
  link: { capacity: 30, joinToken: 'join-7', participants, ...state },
})

function renderApp(
  path: string,
  options: {
    runs?: ReturnType<typeof linkRun>[]
    locale?: Locale
    releases?: Record<number, Release[]>
    results?: Record<number, ReleaseResults>
  } = {},
) {
  const history = createMemoryHistory()
  history.set({ value: path })
  const runs = fakeRunsApi({
    runs: options.runs,
    materials: [preterite],
    releases: options.releases,
    results: options.results,
  })
  const apis = fakeApis({
    auth: fakeAuthApi({ signedIn: teacher }),
    courses: fakeCoursesApi({ courses: [spanish] }),
    runs,
  })
  render(withI18n(() => <App apis={apis} history={history} />, options.locale ?? 'en'))
  return { runs, history }
}

describe('starting a link run', () => {
  it('starts a run for people with a link, with a capacity and the teacher’s confirmation', async () => {
    const { runs, history } = renderApp(`/courses/${spanish.id}?tab=runs`)
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Run name'), 'Den otevřených dveří')
    await user.click(screen.getByRole('radio', { name: 'People with a link' }))
    const capacity = screen.getByRole('spinbutton', { name: 'Capacity' })
    expect(capacity).toHaveValue(30)
    expect(capacity).toHaveAttribute('max', '200')
    await user.clear(capacity)
    await user.type(capacity, '24')
    await user.click(screen.getByRole('checkbox', { name: /I am responsible for the people I share the link with/ }))
    await user.click(screen.getByRole('button', { name: 'Start a run' }))

    expect(await screen.findByRole('heading', { name: 'Den otevřených dveří' })).toBeInTheDocument()
    expect(runs.start).toHaveBeenCalledWith(spanish.id, {
      name: 'Den otevřených dveří',
      mode: 'link',
      capacity: 24,
      responsible: true,
    })
    expect(history.get()).toMatch(/^\/runs\/\d+$/)
  })

  it('asks for the capacity and the confirmation only for a link run', async () => {
    renderApp(`/courses/${spanish.id}?tab=runs`)
    const user = userEvent.setup()

    expect(await screen.findByRole('radio', { name: 'Enrolled classes and students' })).toBeChecked()
    expect(screen.queryByRole('spinbutton', { name: 'Capacity' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'People with a link' }))
    expect(screen.getByRole('spinbutton', { name: 'Capacity' })).toBeInTheDocument()
  })

  it('does not start a link run without the confirmation', async () => {
    const { runs } = renderApp(`/courses/${spanish.id}?tab=runs`)
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Run name'), 'Den otevřených dveří')
    await user.click(screen.getByRole('radio', { name: 'People with a link' }))
    // Past the browser's own check of the required box, as a script could submit it.
    fireEvent.submit(screen.getByRole('button', { name: 'Start a run' }).closest('form')!)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Confirm that you are responsible for the people you share the link with.',
    )
    expect(runs.start).not.toHaveBeenCalled()
  })

  it('keeps the capacity between one and two hundred', async () => {
    const { runs } = renderApp(`/courses/${spanish.id}?tab=runs`)
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Run name'), 'Den otevřených dveří')
    await user.click(screen.getByRole('radio', { name: 'People with a link' }))
    const capacity = screen.getByRole('spinbutton', { name: 'Capacity' })
    await user.clear(capacity)
    await user.type(capacity, '500')
    await user.click(screen.getByRole('checkbox', { name: /I am responsible/ }))
    fireEvent.submit(capacity.closest('form')!)

    await waitFor(() => expect(runs.start).toHaveBeenCalled())
    expect(runs.start.mock.calls[0][1]).toMatchObject({ capacity: 200 })
  })
})

describe('link runs in lists', () => {
  const joinedTwo = linkRun([
    { id: 1, name: 'Eva Malá', joined_at: '2026-09-25T08:00:00Z' },
    { id: 2, name: 'Jan Novák', joined_at: '2026-09-25T08:03:00Z' },
  ])

  it('counts the participants of a link run among the course’s runs', async () => {
    renderApp(`/courses/${spanish.id}?tab=runs`, { runs: [joinedTwo] })

    const link = await screen.findByRole('link', { name: 'Den otevřených dveří' })
    expect(within(link.closest('li')!).getByText('Participants: 2')).toBeInTheDocument()
  })

  it('counts the participants of a link run among all runs', async () => {
    renderApp('/runs', { runs: [joinedTwo] })

    const row = (await screen.findByRole('link', { name: 'Den otevřených dveří' })).closest('tr')!
    expect(within(row).getByText('Participants: 2')).toBeInTheDocument()
  })
})

describe('the lobby of a link run', () => {
  it('shows participants in place of students', async () => {
    renderApp('/runs/7', { runs: [linkRun()] })

    const tabs = within(await screen.findByRole('navigation', { name: 'Course run' }))
    expect(tabs.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Overview',
      'Releases',
      'Participants',
      'Settings',
    ])
    const start = within(screen.getByRole('region', { name: 'Start the run' }))
    expect(start.getByRole('link', { name: 'Share the join link, not done yet' })).toHaveAttribute(
      'href',
      '/runs/7?tab=participants',
    )
  })

  it('shows the join link with a copy button', async () => {
    renderApp('/runs/7?tab=participants', { runs: [linkRun()] })
    const user = userEvent.setup()

    const link = await screen.findByLabelText('Join link')
    expect(link).toHaveValue(`${window.location.origin}/join#join-7`)
    await user.click(screen.getByRole('button', { name: 'Copy the link' }))

    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/join#join-7`)
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('shows the join link as a QR code over the whole screen', async () => {
    renderApp('/runs/7?tab=participants', { runs: [linkRun()] })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Show QR code' }))

    const dialog = within(screen.getByRole('dialog', { name: 'Den otevřených dveří' }))
    expect(dialog.getByRole('img', { name: 'QR code of the join link' })).toBeInTheDocument()
    expect(dialog.getByText(`${window.location.origin}/join#join-7`)).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('counts who joined of the capacity, and lists them with the time they joined', async () => {
    renderApp('/runs/7?tab=participants', {
      runs: [
        linkRun([
          { id: 1, name: 'Eva Malá', joined_at: '2026-09-25T08:00:00Z' },
          { id: 2, name: 'Jan Novák', joined_at: '2026-09-25T08:03:00Z' },
        ]),
      ],
    })

    expect(await screen.findByText('2 / 30')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('2 of 30 joined')).toHaveClass('visually-hidden')
    const list = within(screen.getByRole('list', { name: 'Lobby' }))
    expect(list.getAllByRole('listitem').map((item) => item.querySelector('span')!.textContent)).toEqual([
      'Eva Malá',
      'Jan Novák',
    ])
    expect(list.getAllByRole('listitem')[0].querySelector('time')).toHaveAttribute('datetime', '2026-09-25T08:00:00Z')
  })

  it('says when nobody has joined yet', async () => {
    renderApp('/runs/7?tab=participants', { runs: [linkRun()] })

    expect(await screen.findByText('Nobody has joined yet.')).toBeInTheDocument()
    expect(screen.getByText('0 / 30')).toBeInTheDocument()
  })

  it('fills as people join', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { runs } = renderApp('/runs/7?tab=participants', { runs: [linkRun()] })
    await screen.findByText('0 / 30')

    runs.join(7, 'Adam Dvořák')
    await vi.advanceTimersByTimeAsync(5_000)

    expect(await screen.findByText('Adam Dvořák')).toBeInTheDocument()
    expect(screen.getByText('1 / 30')).toBeInTheDocument()
  })

  it('offers no enrolling in a link run', async () => {
    renderApp('/runs/7?tab=students', { runs: [linkRun()] })

    expect(await screen.findByLabelText('Join link')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enrol a class or student' })).not.toBeInTheDocument()
  })

  it('addresses the teacher with vy in Czech', async () => {
    renderApp('/runs/7?tab=participants', { runs: [linkRun()], locale: 'cs' })

    expect(await screen.findByLabelText('Odkaz pro připojení')).toBeInTheDocument()
    expect(screen.getByText('Zatím se nikdo nepřipojil.')).toBeInTheDocument()
  })
})

describe('releasing to participants and their results', () => {
  it('releases to every participant, and the summary counts them', async () => {
    renderApp('/runs/7', { runs: [linkRun(twoJans)] })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Release material' }))
    const form = within(screen.getByRole('dialog', { name: 'Release in a run' }))
    await user.selectOptions(await form.findByLabelText('Material'), String(preterite.id))
    expect(form.getByText('For every participant of the run, including those who join later.')).toBeInTheDocument()
    expect(form.queryByRole('radio', { name: /Chosen students/ })).not.toBeInTheDocument()
    await user.click(form.getByRole('button', { name: 'Continue to the summary' }))

    const summary = within(screen.getByRole('region', { name: 'Summary' }))
    expect(summary.getByText('Participants who will see the material right away: 2')).toBeInTheDocument()
  })

  it('names who is behind without a page of their own', async () => {
    renderApp('/runs/7', {
      runs: [linkRun(twoJans)],
      releases: { 7: [{ ...released, due_at: '2026-09-24T18:00:00Z' }] },
    })

    const behind = within(await screen.findByRole('region', { name: 'Who is behind' }))
    expect(behind.getByText('Jan Novák (2)')).toBeInTheDocument()
    expect(behind.queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows the results of participants, a name typed twice numbered', async () => {
    const results: ReleaseResults = {
      release: released,
      open_answers: { waiting: 0, assessed: 0, flagged: 0, unpublished: 0 },
      exercises: [],
      students: twoJans.map(({ id, name }) => ({
        id,
        name,
        in_run: true,
        state: 'submitted',
        late: false,
        attempts: 1,
        cells: {},
      })),
    }
    renderApp('/runs/7/releases/1', { runs: [linkRun(twoJans)], releases: { 7: [released] }, results: { 1: results } })

    expect(await screen.findByRole('link', { name: 'Jan Novák (2)' })).toHaveAttribute(
      'href',
      '/runs/7/releases/1/students/2',
    )
    expect(screen.getByRole('link', { name: 'Jan Novák (1)' })).toBeInTheDocument()
  })
})

describe('managing the lobby', () => {
  const two = () =>
    linkRun([
      { id: 1, name: 'Eva Malá', joined_at: '2026-09-25T08:00:00Z' },
      { id: 2, name: 'Jan Novák', joined_at: '2026-09-25T08:03:00Z' },
    ])
  const confirmDialog = () => within(screen.getByRole('alertdialog'))

  it('closes joining and opens it again', async () => {
    const { runs } = renderApp('/runs/7?tab=participants', { runs: [two()] })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Close joining' }))

    expect(runs.setJoining).toHaveBeenCalledWith(7, false)
    expect(await screen.findByText(/Joining is closed/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open joining' }))
    expect(runs.setJoining).toHaveBeenLastCalledWith(7, true)
    await waitFor(() => expect(screen.queryByText(/Joining is closed/)).not.toBeInTheDocument())
  })

  it('replaces the join link after confirming', async () => {
    const { runs } = renderApp('/runs/7?tab=participants', { runs: [two()] })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Replace the link' }))
    expect(confirmDialog().getByText(/Those who joined keep their personal links/)).toBeInTheDocument()
    await user.click(confirmDialog().getByRole('button', { name: 'Replace the link' }))

    await waitFor(() =>
      expect(screen.getByLabelText('Join link')).toHaveValue(`${window.location.origin}/join#join-7-new`),
    )
    expect(runs.replaceJoinLink).toHaveBeenCalledWith(7)
  })

  it('keeps the join link when replacing is cancelled', async () => {
    const { runs } = renderApp('/runs/7?tab=participants', { runs: [two()] })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Replace the link' }))
    await user.click(confirmDialog().getByRole('button', { name: 'Cancel' }))

    expect(runs.replaceJoinLink).not.toHaveBeenCalled()
  })

  it('removes a participant after confirming', async () => {
    const { runs } = renderApp('/runs/7?tab=participants', { runs: [two()] })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Remove Eva Malá' }))
    expect(confirmDialog().getByText(/Their personal link stops working/)).toBeInTheDocument()
    await user.click(confirmDialog().getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(screen.queryByText('Eva Malá')).not.toBeInTheDocument())
    expect(runs.removeParticipant).toHaveBeenCalledWith(7, 1)
    expect(screen.getByText('1 / 30')).toBeInTheDocument()
  })

  it('says a participant was removed, and keeps the focus in the lobby', async () => {
    renderApp('/runs/7?tab=participants', { runs: [two()] })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Remove Eva Malá' }))
    expect(confirmDialog().getByText(/close joining or replace the link/)).toBeInTheDocument()
    await user.click(confirmDialog().getByRole('button', { name: 'Remove' }))

    expect(await screen.findByText('Eva Malá was removed.')).toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Participants' })))
  })

  it('says in the dialog when renaming failed', async () => {
    const { runs } = renderApp('/runs/7?tab=participants', { runs: [two()] })
    runs.renameParticipant.mockRejectedValueOnce(new Error('offline'))
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Rename Jan Novák' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Rename Jan Novák' }))
    await user.click(dialog.getByRole('button', { name: 'Rename' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent('The change could not be made. Try again.')
  })

  it('renames a participant', async () => {
    const { runs } = renderApp('/runs/7?tab=participants', { runs: [two()] })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Rename Jan Novák' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Rename Jan Novák' }))
    const name = dialog.getByLabelText('New name')
    expect(name).toHaveAttribute('maxLength', '60')
    await user.clear(name)
    await user.type(name, 'Jan Novák st.')
    await user.click(dialog.getByRole('button', { name: 'Rename' }))

    expect(await screen.findByText('Jan Novák st.')).toBeInTheDocument()
    expect(runs.renameParticipant).toHaveBeenCalledWith(7, 2, 'Jan Novák st.')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps the focus on a participant’s button across a poll', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderApp('/runs/7?tab=participants', { runs: [two()] })
    const remove = await screen.findByRole('button', { name: 'Remove Eva Malá' })
    remove.focus()

    await vi.advanceTimersByTimeAsync(5_000)

    expect(document.activeElement).toBe(remove)
  })
})

describe('deleting the participants’ names and answers', () => {
  const zone = async () => within(await screen.findByRole('region', { name: 'Participants’ names and answers' }))

  it('deletes them from the settings after confirming', async () => {
    const { runs } = renderApp('/runs/7?tab=settings', { runs: [linkRun(twoJans)] })
    const user = userEvent.setup()

    const danger = await zone()
    expect(danger.getByText(/deleted automatically 90 days after the last release/)).toBeInTheDocument()
    await user.click(danger.getByRole('button', { name: 'Delete names and answers now' }))
    const dialog = within(screen.getByRole('alertdialog'))
    expect(dialog.getByText(/This cannot be undone/)).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Delete names and answers now' }))

    expect(await danger.findByRole('status')).toHaveTextContent(/were deleted on/)
    expect(runs.eraseParticipants).toHaveBeenCalledWith(7)
    expect(danger.queryByRole('button')).not.toBeInTheDocument()
  })

  it('keeps them when deleting is cancelled', async () => {
    const { runs } = renderApp('/runs/7?tab=settings', { runs: [linkRun(twoJans)] })
    const user = userEvent.setup()

    await user.click((await zone()).getByRole('button', { name: 'Delete names and answers now' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))

    expect(runs.eraseParticipants).not.toHaveBeenCalled()
  })

  it('says when they could not be deleted', async () => {
    const { runs } = renderApp('/runs/7?tab=settings', { runs: [linkRun(twoJans)] })
    runs.eraseParticipants.mockRejectedValueOnce(new Error('offline'))
    const user = userEvent.setup()

    await user.click((await zone()).getByRole('button', { name: 'Delete names and answers now' }))
    const dialog = within(screen.getByRole('alertdialog'))
    await user.click(dialog.getByRole('button', { name: 'Delete names and answers now' }))

    expect(await (await zone()).findByRole('alert')).toHaveTextContent('They could not be deleted. Try again.')
  })

  it('says when they were deleted', async () => {
    renderApp('/runs/7?tab=settings', { runs: [linkRun(twoJans, { erasedAt: '2026-12-24T08:00:00Z' })] })

    expect(await (await zone()).findByRole('status')).toHaveTextContent('deleted on December 24, 2026')
  })

  it('offers no reopening of joining once they were deleted', async () => {
    renderApp('/runs/7?tab=participants', {
      runs: [linkRun(twoJans, { erasedAt: '2026-12-24T08:00:00Z', closed: true })],
    })

    expect(await screen.findByText(/Joining is closed/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open joining' })).not.toBeInTheDocument()
  })

  it('is not there for an enrolled run', async () => {
    renderApp('/runs/7?tab=settings', { runs: [{ ...linkRun(), link: undefined }] as never })

    expect(await screen.findByLabelText('Run name')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Participants’ names and answers' })).not.toBeInTheDocument()
  })
})
