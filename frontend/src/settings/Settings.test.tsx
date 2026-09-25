import { createMemoryHistory } from '@solidjs/router'
import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { admin, fakeAuthApi, findAccountMenu, openAccountMenu } from '../auth/testing'
import { withI18n } from '../lesson/testing'
import { fakeSettingsApi } from './testing'
import { THEME_KEY } from './theme'

function renderApp(path: string, options: { signedIn?: Account; settings?: ReturnType<typeof fakeSettingsApi> } = {}) {
  const history = createMemoryHistory()
  history.set({ value: path })
  const settings = options.settings ?? fakeSettingsApi()
  const auth = fakeAuthApi({ signedIn: options.signedIn })
  render(withI18n(() => <App apis={fakeApis({ auth, settings })} history={history} />, 'en'))
  return { settings, auth }
}

describe('teacher settings', () => {
  it('applies the stored language once the teacher is signed in', async () => {
    renderApp('/', { signedIn: { ...admin, language: 'cs' } })

    expect(await screen.findByRole('button', { name: `Účet: ${admin.email}` })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('cs')
  })

  it('switches the interface at once and stores the language on the account', async () => {
    const { settings } = renderApp('/settings', { signedIn: admin })
    const user = userEvent.setup()

    await user.selectOptions(await screen.findByLabelText('Interface language'), 'cs')

    expect(await screen.findByRole('heading', { name: 'Nastavení' })).toBeInTheDocument()
    expect(settings.change).toHaveBeenCalledWith(admin.id, { language: 'cs' })
  })

  it('stores the language chosen in the account menu too', async () => {
    const { settings } = renderApp('/', { signedIn: admin })
    const user = await openAccountMenu()

    await user.selectOptions(screen.getByLabelText('Language'), 'cs')

    expect(settings.change).toHaveBeenCalledWith(admin.id, { language: 'cs' })
    expect(await screen.findByRole('button', { name: 'Odhlásit se' })).toBeInTheDocument()
  })

  it('shows the instance default digest time until the teacher sets one', async () => {
    const { settings } = renderApp('/settings', { signedIn: admin })
    const user = userEvent.setup()

    const time = await screen.findByLabelText('Daily digest at')
    expect(time).toHaveValue('07:00')
    expect(screen.getByText('The instance default is used.')).toBeInTheDocument()

    await user.clear(time)
    await user.type(time, '18:30')
    await user.click(screen.getByRole('button', { name: 'Save digest time' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Saved.')
    expect(settings.change).toHaveBeenCalledWith(admin.id, { digest_time: '18:30' })
    expect(screen.queryByText('The instance default is used.')).not.toBeInTheDocument()
  })

  it('returns the digest time to the instance default', async () => {
    const settings = fakeSettingsApi({ digest_time: '18:30', digest_time_is_default: false })
    renderApp('/settings', { signedIn: admin, settings })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Use the instance default' }))

    expect(settings.change).toHaveBeenCalledWith(admin.id, { digest_time: null })
    expect(await screen.findByLabelText('Daily digest at')).toHaveValue('07:00')
    expect(await screen.findByText('The instance default is used.')).toBeInTheDocument()
  })

  it('returns to the browser language when the account signs out', async () => {
    renderApp('/', { signedIn: { ...admin, language: 'cs' } })
    const user = await openAccountMenu()

    await user.click(screen.getByRole('button', { name: 'Odhlásit se' }))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('en')
  })

  it('does not sign the account back in when a language save finishes after sign-out', async () => {
    const settings = fakeSettingsApi()
    let finish: () => void = () => {}
    settings.change.mockImplementationOnce(
      (_id, change) =>
        new Promise((resolve) => {
          finish = () =>
            resolve({
              language: change.language ?? null,
              theme: 'system',
              digest_time: '07:00',
              digest_time_is_default: true,
            })
        }),
    )
    renderApp('/', { signedIn: admin, settings })
    const user = await openAccountMenu()

    await user.selectOptions(screen.getByLabelText('Language'), 'cs')
    await user.click(screen.getByRole('button', { name: 'Odhlásit se' }))
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    finish()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Account/ })).not.toBeInTheDocument()
  })

  it('is reachable from the navigation', async () => {
    renderApp('/', { signedIn: admin })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'Settings' }))

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  })
})

describe('theme', () => {
  const root = document.documentElement

  afterEach(() => {
    delete root.dataset.theme
    localStorage.clear()
  })

  it('applies the account theme once signed in and remembers it for the next page load', async () => {
    renderApp('/', { signedIn: { ...admin, theme: 'dark' } })

    expect(await findAccountMenu()).toBeInTheDocument()
    expect(root.dataset.theme).toBe('dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
  })

  it('switches the theme at once and stores it on the account', async () => {
    const { settings } = renderApp('/settings', { signedIn: admin })
    const user = userEvent.setup()

    await user.selectOptions(await screen.findByLabelText('Theme'), 'dark')

    expect(root.dataset.theme).toBe('dark')
    expect(settings.change).toHaveBeenCalledWith(admin.id, { theme: 'dark' })
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.')
    expect(screen.getByLabelText('Theme')).toHaveValue('dark')
  })

  it('follows the device again when the teacher chooses the system theme', async () => {
    const settings = fakeSettingsApi({ theme: 'light' })
    renderApp('/settings', { signedIn: { ...admin, theme: 'light' }, settings })
    const user = userEvent.setup()
    expect(await screen.findByLabelText('Theme')).toHaveValue('light')

    await user.selectOptions(screen.getByLabelText('Theme'), 'system')

    expect(root.dataset.theme).toBeUndefined()
    expect(localStorage.getItem(THEME_KEY)).toBeNull()
    expect(settings.change).toHaveBeenCalledWith(admin.id, { theme: 'system' })
  })

  it('returns a shared device to the system theme when the account signs out', async () => {
    renderApp('/', { signedIn: { ...admin, theme: 'dark' } })
    const user = await openAccountMenu()

    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(root.dataset.theme).toBeUndefined()
    expect(localStorage.getItem(THEME_KEY)).toBeNull()
  })

  it('puts back the account theme when saving it fails', async () => {
    const settings = fakeSettingsApi()
    settings.change.mockRejectedValueOnce(new Error('offline'))
    renderApp('/settings', { signedIn: admin, settings })
    const user = userEvent.setup()

    await user.selectOptions(await screen.findByLabelText('Theme'), 'dark')

    expect(await screen.findByRole('alert')).toHaveTextContent('Saving failed')
    expect(root.dataset.theme).toBeUndefined()
    expect(screen.getByLabelText('Theme')).toHaveValue('system')
  })
})
