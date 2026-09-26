import { createMemoryHistory } from '@solidjs/router'
import { render, screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Locale } from '../i18n/messages'
import { OtherDevice } from '../attempts/api'
import { fakeAttemptsApi, releaseOf } from '../attempts/testing'
import { ApiError } from '../lesson/api'
import { withI18n } from '../lesson/testing'
import { fakeParticipantsApi, lobbyRun } from './testing'

beforeEach(() => localStorage.clear())
afterEach(() => vi.useRealTimers())

function renderApp(
  path: string,
  options: { participants?: ReturnType<typeof fakeParticipantsApi>; locale?: Locale } = {},
) {
  const history = createMemoryHistory()
  history.set({ value: path })
  const participants = options.participants ?? fakeParticipantsApi()
  render(withI18n(() => <App apis={fakeApis({ participants })} history={history} />, options.locale ?? 'en'))
  return { participants, history }
}

async function joinAs(name: string) {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Your name'), name)
  await user.click(screen.getByRole('button', { name: 'Join' }))
  return user
}

describe('the join page', () => {
  it('names the run and its course and asks for a name, without signing in', async () => {
    renderApp('/join#join-7')

    expect(await screen.findByRole('heading', { name: lobbyRun.run })).toBeInTheDocument()
    expect(screen.getByText(lobbyRun.course)).toBeInTheDocument()
    expect(screen.getByLabelText('Your name')).toHaveAttribute('maxLength', '60')
    expect(screen.getByLabelText('Language')).toBeInTheDocument()
  })

  it('joins under the typed name and gives the personal link at once', async () => {
    const { participants, history } = renderApp('/join#join-7')

    await joinAs('  Jan Novák ')

    expect(participants.join).toHaveBeenCalledWith('join-7', 'Jan Novák')
    expect(await screen.findByRole('heading', { name: lobbyRun.run })).toBeInTheDocument()
    expect(history.get()).toBe('/participant#personal-7-1')
    expect(screen.getByText('Hi, Jan Novák')).toBeInTheDocument()
    expect(screen.getByText('Save this link to come back, even from another device.')).toBeInTheDocument()
    expect(screen.getByLabelText('Your personal link')).toHaveValue(
      `${window.location.origin}/participant#personal-7-1`,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Wait until your teacher starts.')
  })

  it('copies the personal link', async () => {
    renderApp('/join#join-7')
    const user = await joinAs('Jan Novák')

    await user.click(await screen.findByRole('button', { name: 'Copy the link' }))

    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/participant#personal-7-1`)
    // Announced: the live region was there before the text came.
    expect(await screen.findByText('Copied')).toHaveAttribute('aria-live', 'polite')
  })

  it('does not join without a name', async () => {
    const { participants } = renderApp('/join#join-7')

    await joinAs('   ')

    expect(participants.join).not.toHaveBeenCalled()
  })

  it('says so when the run is full', async () => {
    const participants = fakeParticipantsApi({
      runs: [{ ...lobbyRun, capacity: 1, participants: [{ name: 'Eva', token: 'personal-eva' }] }],
    })
    renderApp('/join#join-7', { participants })

    expect(await screen.findByRole('alert')).toHaveTextContent('This run is full.')
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument()
  })

  it('says so when joining is closed', async () => {
    renderApp('/join#join-7', { participants: fakeParticipantsApi({ runs: [{ ...lobbyRun, closed: true }] }) })

    expect(await screen.findByRole('alert')).toHaveTextContent('Joining this run is closed. Ask your teacher.')
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument()
  })

  it('says so when joining was closed while typing the name', async () => {
    const participants = fakeParticipantsApi()
    participants.join.mockResolvedValueOnce('joining_closed')
    renderApp('/join#join-7', { participants })

    await joinAs('Jan Novák')

    expect(await screen.findByRole('alert')).toHaveTextContent('Joining this run is closed. Ask your teacher.')
  })

  it('says so when the run filled up while typing the name', async () => {
    const participants = fakeParticipantsApi({ runs: [{ ...lobbyRun, capacity: 1 }] })
    renderApp('/join#join-7', { participants })
    await screen.findByLabelText('Your name')
    await participants.join('join-7', 'Eva')

    await joinAs('Jan Novák')

    expect(await screen.findByRole('alert')).toHaveTextContent('This run is full.')
  })

  it('says so for a link that leads nowhere', async () => {
    renderApp('/join#not-a-link')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This link does not work. Ask your teacher for a new one.',
    )
  })

  it('says so when the link could not be checked', async () => {
    const participants = fakeParticipantsApi()
    participants.check.mockRejectedValueOnce(new Error('offline'))
    renderApp('/join#join-7', { participants })

    expect(await screen.findByRole('alert')).toHaveTextContent('The link could not be checked. Try again.')
    expect(screen.getByRole('heading', { name: 'Join a course run' })).toBeInTheDocument()
  })

  it('brings back someone who joined before instead of joining twice', async () => {
    const { participants } = renderApp('/join#join-7')
    await joinAs('Jan Novák')
    await screen.findByText('Hi, Jan Novák')
    document.body.innerHTML = ''
    participants.open.mockClear()
    const again = renderApp('/join#join-7', { participants })
    const user = userEvent.setup()

    expect(await screen.findByText('On this device, you are in this run as Jan Novák.')).toBeInTheDocument()
    // The join link only asks; the work stays on whichever device it is open on until they continue.
    expect(participants.open).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Continue as Jan Novák' }))

    expect(await screen.findByText('Hi, Jan Novák')).toBeInTheDocument()
    expect(again.history.get()).toBe('/participant#personal-7-1')
    expect(participants.join).toHaveBeenCalledTimes(1)
  })

  it('lets the next person on a shared device join as themselves', async () => {
    const participants = fakeParticipantsApi({
      runs: [{ ...lobbyRun, participants: [{ name: 'Eva', token: 'personal-eva' }] }],
    })
    localStorage.setItem('myteacher.participant.7', 'personal-eva')
    const { history } = renderApp('/join#join-7', { participants })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'I am someone else' }))
    await joinAs('Adam')

    expect(await screen.findByText('Hi, Adam')).toBeInTheDocument()
    expect(history.get()).toBe('/participant#personal-7-2')
    expect(localStorage.getItem('myteacher.participant.7')).toBe('personal-7-2')
  })

  it('brings back someone who joined before even when the run is full now', async () => {
    const participants = fakeParticipantsApi({
      runs: [{ ...lobbyRun, capacity: 1, participants: [{ name: 'Eva', token: 'personal-eva' }] }],
    })
    localStorage.setItem('myteacher.participant.7', 'personal-eva')

    renderApp('/join#join-7', { participants })

    expect(await screen.findByRole('button', { name: 'Continue as Eva' })).toBeInTheDocument()
  })

  it('offers joining when the remembered link no longer works, and forgets it', async () => {
    localStorage.setItem('myteacher.participant.7', 'personal-gone')

    renderApp('/join#join-7')

    expect(await screen.findByLabelText('Your name')).toBeInTheDocument()
    expect(localStorage.getItem('myteacher.participant.7')).toBeNull()
  })

  it('addresses the student with ty in Czech', async () => {
    renderApp('/join#join-7', { locale: 'cs' })

    expect(await screen.findByLabelText('Tvoje jméno')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Připojit se' })).toBeInTheDocument()
  })
})

describe('the personal link', () => {
  const joined = () =>
    fakeParticipantsApi({ runs: [{ ...lobbyRun, participants: [{ name: 'Eva Malá', token: 'personal-eva' }] }] })

  it('opens the lobby on any device, and is remembered there', async () => {
    const { participants } = renderApp('/participant#personal-eva', { participants: joined() })

    expect(await screen.findByText('Hi, Eva Malá')).toBeInTheDocument()
    // Landing here moves the work to this device.
    expect(participants.open).toHaveBeenCalledWith('personal-eva')
    expect(await screen.findByRole('status')).toHaveTextContent('Wait until your teacher starts.')
    await waitFor(() => expect(localStorage.getItem('myteacher.participant.7')).toBe('personal-eva'))
  })

  it('says so for a link that does not work, and forgets it', async () => {
    localStorage.setItem('myteacher.participant.7', 'personal-gone')

    renderApp('/participant#personal-gone', { participants: joined() })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This link does not work. Ask your teacher for a new one.',
    )
    expect(screen.getByRole('heading', { name: 'Your course run' })).toBeInTheDocument()
    expect(localStorage.getItem('myteacher.participant.7')).toBeNull()
  })

  it('says so when the page could not be loaded, and keeps the link', async () => {
    localStorage.setItem('myteacher.participant.7', 'personal-eva')
    const participants = joined()
    participants.open.mockRejectedValueOnce(new Error('offline'))

    renderApp('/participant#personal-eva', { participants })

    expect(await screen.findByRole('alert')).toHaveTextContent('Your page could not be loaded. Try again.')
    expect(screen.getByRole('heading', { name: 'Your course run' })).toBeInTheDocument()
    expect(localStorage.getItem('myteacher.participant.7')).toBe('personal-eva')
  })

  it('addresses the student with ty in Czech', async () => {
    renderApp('/participant#personal-eva', { participants: joined(), locale: 'cs' })

    expect(await screen.findByText('Ahoj, Eva Malá')).toBeInTheDocument()
    expect(await screen.findByRole('status')).toHaveTextContent('Počkej, až učitel začne.')
    const save = 'Ulož si tenhle odkaz, ať se můžeš vrátit, i z jiného zařízení.'
    expect(screen.getByText(save)).toBeInTheDocument()
  })
})

describe('a participant’s work', () => {
  const withWork = (attempts = fakeAttemptsApi({ releases: [releaseOf({ id: 1, title: 'Ser, or estar?' })] })) =>
    fakeParticipantsApi({
      runs: [{ ...lobbyRun, participants: [{ name: 'Eva Malá', token: 'personal-eva' }] }],
      attempts,
    })

  it('shows the work to do instead of the lobby, once the teacher released it', async () => {
    const participants = withWork()
    renderApp('/participant#personal-eva', { participants })

    const card = (await screen.findByRole('heading', { name: 'Ser, or estar?' })).closest('article')!
    expect(within(card).getByRole('link', { name: 'Start' })).toHaveAttribute(
      'href',
      '/participant/work/1#personal-eva',
    )
    expect(screen.queryByText('Wait until your teacher starts.')).not.toBeInTheDocument()
    expect(participants.attempts).toHaveBeenCalledWith('personal-eva')
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument()
  })

  it('shows the work as soon as it is released, without reloading', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const attempts = fakeAttemptsApi()
    renderApp('/participant#personal-eva', { participants: withWork(attempts) })
    expect(await screen.findByRole('status')).toHaveTextContent('Wait until your teacher starts.')

    attempts.releases.mockResolvedValue([releaseOf({ id: 1, title: 'Ser, or estar?' })])
    await vi.advanceTimersByTimeAsync(10_000)

    expect(await screen.findByRole('heading', { name: 'Ser, or estar?' })).toBeInTheDocument()
  })

  it('keeps the waiting message and the cards as they were across a poll', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const attempts = fakeAttemptsApi()
    renderApp('/participant#personal-eva', { participants: withWork(attempts) })
    const waiting = await screen.findByRole('status')

    await vi.advanceTimersByTimeAsync(10_000)
    expect(screen.getByRole('status')).toBe(waiting)

    attempts.releases.mockResolvedValue([releaseOf({ id: 1, title: 'Ser, or estar?' })])
    await vi.advanceTimersByTimeAsync(10_000)
    const start = await screen.findByRole('link', { name: 'Start' })
    start.focus()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(attempts.releases.mock.calls.length).toBeGreaterThanOrEqual(4)
    expect(document.activeElement).toBe(start)
  })

  it('keeps showing the work when one poll fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const attempts = fakeAttemptsApi({ releases: [releaseOf({ id: 1, title: 'Ser, or estar?' })] })
    renderApp('/participant#personal-eva', { participants: withWork(attempts) })
    await screen.findByRole('heading', { name: 'Ser, or estar?' })

    attempts.releases.mockRejectedValueOnce(new Error('offline'))
    await vi.advanceTimersByTimeAsync(10_000)

    expect(screen.getByRole('heading', { name: 'Ser, or estar?' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows another participant’s own work when their link is opened in the same tab', async () => {
    const participants = fakeParticipantsApi({
      runs: [
        {
          ...lobbyRun,
          participants: [
            { name: 'Eva Malá', token: 'personal-eva' },
            { name: 'Adam', token: 'personal-adam' },
          ],
        },
      ],
    })
    const { history } = renderApp('/participant#personal-eva', { participants })
    await screen.findByText('Hi, Eva Malá')

    history.set({ value: '/participant#personal-adam' })

    expect(await screen.findByText('Hi, Adam')).toBeInTheDocument()
    await waitFor(() => expect(participants.attempts).toHaveBeenLastCalledWith('personal-adam'))
  })

  it('names the work and leads back home from it', async () => {
    renderApp('/participant/work/1#personal-eva', { participants: withWork() })

    expect(await screen.findByRole('heading', { level: 1, name: 'Ser, or estar?' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to your work' })).toHaveAttribute('href', '/participant#personal-eva')
  })

  it('says so when the personal link behind the work no longer works', async () => {
    const attempts = fakeAttemptsApi()
    attempts.release.mockRejectedValue(new ApiError(401))
    renderApp('/participant/work/1#personal-gone', { participants: withWork(attempts) })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This link does not work. Ask your teacher for a new one.',
    )
  })

  it('gives way to a notice once the work moved to another device, and moves it back on request', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const attempts = fakeAttemptsApi({ releases: [releaseOf({ id: 1, title: 'Ser, or estar?' })] })
    const participants = withWork(attempts)
    renderApp('/participant#personal-eva', { participants })
    await screen.findByRole('heading', { name: 'Ser, or estar?' })

    attempts.releases.mockRejectedValueOnce(new OtherDevice())
    await vi.advanceTimersByTimeAsync(10_000)

    const notice = await screen.findByRole('heading', { name: 'Your work continues on another device' })
    await waitFor(() => expect(notice).toHaveFocus())
    expect(screen.queryByRole('heading', { name: 'Ser, or estar?' })).not.toBeInTheDocument()
    // The way back stays.
    expect(screen.getByRole('button', { name: 'Copy the link' })).toBeInTheDocument()
    participants.open.mockClear()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Continue on this device' }))

    expect(participants.open).toHaveBeenCalledWith('personal-eva')
    expect(await screen.findByRole('heading', { name: 'Ser, or estar?' })).toBeInTheDocument()
    expect(screen.queryByText('Your work continues on another device')).not.toBeInTheDocument()
  })

  it('keeps the notice and says so when the work could not be moved back', async () => {
    const attempts = fakeAttemptsApi()
    attempts.releases.mockRejectedValue(new OtherDevice())
    const participants = withWork(attempts)
    renderApp('/participant#personal-eva', { participants })
    await screen.findByRole('heading', { name: 'Your work continues on another device' })
    participants.open.mockRejectedValueOnce(new Error('offline'))

    await userEvent.setup().click(screen.getByRole('button', { name: 'Continue on this device' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Your page could not be loaded. Try again.')
    expect(screen.getByRole('heading', { name: 'Your work continues on another device' })).toBeInTheDocument()
  })

  it('shows the notice when a piece of work opened here moved away', async () => {
    const attempts = fakeAttemptsApi()
    attempts.release.mockRejectedValue(new OtherDevice())
    renderApp('/participant/work/1#personal-eva', { participants: withWork(attempts) })

    expect(await screen.findByRole('heading', { name: 'Your work continues on another device' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to your work' })).toBeInTheDocument()
  })

  it('stops a piece of work whose draft was refused, so nothing more typed here is sent', async () => {
    const attempts = fakeAttemptsApi({ releases: [releaseOf({ id: 1, title: 'Ser, or estar?' })] })
    const { history } = renderApp('/participant#personal-eva', { participants: withWork(attempts) })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('link', { name: 'Start' }))
    await user.click(await screen.findByRole('button', { name: 'Start' }))
    const choice = await screen.findByRole('radio', { name: 'está' })
    attempts.saveDraft.mockRejectedValue(new OtherDevice())

    await user.click(choice)

    expect(await screen.findByRole('heading', { name: 'Your work continues on another device' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'está' })).not.toBeInTheDocument()
    expect(attempts.tryAnswer).not.toHaveBeenCalled()
    expect(history.get()).toBe('/participant/work/1#personal-eva')
  })

  it('tells the student in Czech with ty that the work moved', async () => {
    const attempts = fakeAttemptsApi()
    attempts.releases.mockRejectedValue(new OtherDevice())
    renderApp('/participant#personal-eva', { participants: withWork(attempts), locale: 'cs' })

    expect(await screen.findByRole('heading', { name: 'Tvoje práce pokračuje na jiném zařízení' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pokračovat na tomhle zařízení' })).toBeInTheDocument()
  })

  it('opens a piece of work behind the personal link, and starts it', async () => {
    const attempts = fakeAttemptsApi({ releases: [releaseOf({ id: 1, title: 'Ser, or estar?' })] })
    const { history } = renderApp('/participant#personal-eva', { participants: withWork(attempts) })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'Start' }))

    expect(history.get()).toBe('/participant/work/1#personal-eva')
    expect(await screen.findByRole('heading', { name: 'Before you start' })).toBeInTheDocument()
    expect(screen.getByLabelText('Language')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(attempts.start).toHaveBeenCalledWith(1))
  })
})
