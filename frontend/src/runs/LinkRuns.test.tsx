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
import { fakeRunsApi } from './testing'

const teacher: Account = { ...invitedTeacher, language: null }

afterEach(() => vi.useRealTimers())

const linkRun = (participants: { id: number; name: string; joined_at: string }[] = []) => ({
  id: 7,
  courseId: spanish.id,
  name: 'Den otevřených dveří',
  classIds: [],
  studentIds: [],
  link: { capacity: 30, joinToken: 'join-7', participants },
})

function renderApp(path: string, options: { runs?: ReturnType<typeof linkRun>[]; locale?: Locale } = {}) {
  const history = createMemoryHistory()
  history.set({ value: path })
  const runs = fakeRunsApi({ runs: options.runs })
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
