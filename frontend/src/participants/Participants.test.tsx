import { createMemoryHistory } from '@solidjs/router'
import { render, screen, waitFor } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Locale } from '../i18n/messages'
import { withI18n } from '../lesson/testing'
import { fakeParticipantsApi, lobbyRun } from './testing'

beforeEach(() => localStorage.clear())

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
    const again = renderApp('/join#join-7', { participants })
    const user = userEvent.setup()

    expect(await screen.findByText('On this device, you are in this run as Jan Novák.')).toBeInTheDocument()
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
    renderApp('/participant#personal-eva', { participants: joined() })

    expect(await screen.findByText('Hi, Eva Malá')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Wait until your teacher starts.')
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
    participants.me.mockRejectedValueOnce(new Error('offline'))

    renderApp('/participant#personal-eva', { participants })

    expect(await screen.findByRole('alert')).toHaveTextContent('Your page could not be loaded. Try again.')
    expect(screen.getByRole('heading', { name: 'Your course run' })).toBeInTheDocument()
    expect(localStorage.getItem('myteacher.participant.7')).toBe('personal-eva')
  })

  it('addresses the student with ty in Czech', async () => {
    renderApp('/participant#personal-eva', { participants: joined(), locale: 'cs' })

    expect(await screen.findByText('Ahoj, Eva Malá')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Počkej, až učitel začne.')
    const save = 'Ulož si tenhle odkaz, ať se můžeš vrátit, i z jiného zařízení.'
    expect(screen.getByText(save)).toBeInTheDocument()
  })
})
