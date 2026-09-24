import { createMemoryHistory } from '@solidjs/router'
import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeAdminApi } from '../admin/testing'
import type { Account } from '../auth/api'
import { admin, fakeAuthApi } from '../auth/testing'
import { withI18n } from '../lesson/testing'
import { fakeSettingsApi } from './testing'

function renderApp(path: string, options: { signedIn?: Account; settings?: ReturnType<typeof fakeSettingsApi> } = {}) {
  const history = createMemoryHistory()
  history.set({ value: path })
  const settings = options.settings ?? fakeSettingsApi()
  const auth = fakeAuthApi({ signedIn: options.signedIn })
  render(withI18n(() => <App apis={{ auth, admin: fakeAdminApi(), settings }} history={history} />, 'en'))
  return { settings, auth }
}

describe('teacher settings', () => {
  it('applies the stored language once the teacher is signed in', async () => {
    renderApp('/', { signedIn: { ...admin, language: 'cs' } })

    expect(await screen.findByRole('button', { name: 'Odhlásit se' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('cs')
  })

  it('switches the interface at once and stores the language on the account', async () => {
    const { settings } = renderApp('/settings', { signedIn: admin })
    const user = userEvent.setup()

    await user.selectOptions(await screen.findByLabelText('Interface language'), 'cs')

    expect(await screen.findByRole('heading', { name: 'Nastavení' })).toBeInTheDocument()
    expect(settings.change).toHaveBeenCalledWith(admin.id, { language: 'cs' })
  })

  it('stores the language chosen in the header too', async () => {
    const { settings } = renderApp('/', { signedIn: admin })
    const user = userEvent.setup()

    await user.selectOptions(await screen.findByLabelText('Language'), 'cs')

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
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Odhlásit se' }))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('en')
  })

  it('does not sign the account back in when a language save finishes after sign-out', async () => {
    const settings = fakeSettingsApi()
    let finish: () => void = () => {}
    settings.change.mockImplementationOnce(
      (_id, change) =>
        new Promise((resolve) => {
          finish = () => resolve({ language: change.language ?? null, digest_time: '07:00', digest_time_is_default: true })
        }),
    )
    renderApp('/', { signedIn: admin, settings })
    const user = userEvent.setup()

    await user.selectOptions(await screen.findByLabelText('Language'), 'cs')
    await user.click(screen.getByRole('button', { name: 'Odhlásit se' }))
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    finish()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })

  it('is reachable from the navigation', async () => {
    renderApp('/', { signedIn: admin })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'Settings' }))

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  })
})
