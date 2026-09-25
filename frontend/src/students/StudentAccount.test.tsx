import { createMemoryHistory } from '@solidjs/router'
import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import { fakeAuthApi, student, openAccountMenu } from '../auth/testing'
import { withI18n } from '../lesson/testing'
import { fakeSettingsApi } from '../settings/testing'

const PHONE = { width: 375, height: 667 }
const desktop = { width: window.innerWidth, height: window.innerHeight }

function resize(size: { width: number; height: number }) {
  Object.assign(window, { innerWidth: size.width, innerHeight: size.height })
  window.dispatchEvent(new Event('resize'))
}

function renderApp(path: string, auth = fakeAuthApi({ account: student, invited: student }), settings = fakeSettingsApi()) {
  const history = createMemoryHistory()
  history.set({ value: path })
  render(withI18n(() => <App apis={fakeApis({ auth, settings })} history={history} />, 'en'))
  return { history, settings }
}

beforeEach(() => resize(PHONE))
afterEach(() => resize(desktop))

describe('a student on a phone', () => {
  it('accepts the invitation and lands on their placeholder home', async () => {
    const { history } = renderApp('/invitation#the-token')
    const user = userEvent.setup()

    expect(await screen.findByText('jana@skola.example')).toBeInTheDocument()
    await user.type(screen.getByLabelText('New password'), 'the student password')
    await user.type(screen.getByLabelText('Repeat the password'), 'the student password')
    await user.click(screen.getByRole('button', { name: 'Set password and sign in' }))

    expect(await screen.findByRole('heading', { name: 'Hello, Jana Veselá' })).toBeInTheDocument()
    expect(history.get()).toBe('/')
  })

  it('signs in with an email keyboard and lands on the placeholder home', async () => {
    const { history } = renderApp('/sign-in')
    const user = userEvent.setup()

    const email = await screen.findByLabelText('Email')
    expect(email).toHaveAttribute('type', 'email')
    expect(email).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password')
    await user.type(email, 'jana@skola.example')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { name: 'Hello, Jana Veselá' })).toBeInTheDocument()
    expect(await screen.findByText('Your work will appear here once your teacher sends you some.')).toBeInTheDocument()
    await openAccountMenu(user)
    expect(screen.getByText('Student')).toBeInTheDocument()
    expect(history.get()).toBe('/')
  })

  it('is told plainly that a deactivated account is inactive', async () => {
    renderApp('/sign-in', fakeAuthApi({ account: student, inactive: true }))
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Email'), 'jana@skola.example')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This account is inactive.')
  })

  it('has no teacher pages, and reaches their settings from the account menu', async () => {
    renderApp('/', fakeAuthApi({ signedIn: student }))

    await openAccountMenu()
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Students' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Administration' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open the sample lesson' })).not.toBeInTheDocument()
  })

  it('changes their interface language and has no digest time to set', async () => {
    const settings = fakeSettingsApi({ language: 'cs', digest_time: null })
    renderApp('/settings', fakeAuthApi({ signedIn: student }), settings)
    const user = userEvent.setup()

    await user.selectOptions(await screen.findByLabelText('Interface language'), 'cs')

    expect(settings.change).toHaveBeenCalledWith(student.id, { language: 'cs' })
    expect(await screen.findByRole('heading', { name: 'Nastavení' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Denní souhrn v')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Poskytovatelé AI' })).not.toBeInTheDocument()
  })
})
