import { createMemoryHistory } from '@solidjs/router'
import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import { withI18n } from '../lesson/testing'
import { fakeAuthApi, findAccountMenu } from './testing'

function renderApp(path: string, auth = fakeAuthApi()) {
  const history = createMemoryHistory()
  history.set({ value: path })
  render(withI18n(() => <App apis={fakeApis({ auth })} history={history} />))
  return { auth, history }
}

describe('password reset', () => {
  it('is offered from the sign-in form', async () => {
    const { history } = renderApp('/sign-in')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'Forgot your password?' }))

    expect(await screen.findByRole('heading', { name: 'Reset your password' })).toBeInTheDocument()
    expect(history.get()).toBe('/forgot-password')
  })

  it('answers a request the same way whatever the email', async () => {
    const { auth } = renderApp('/forgot-password')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Email'), 'nobody@skola.example')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'If an account uses this email, a link to set a new password is on its way.',
    )
    expect(auth.requestReset).toHaveBeenCalledWith('nobody@skola.example')
  })

  it('sets a new password from the link and signs in', async () => {
    const { auth, history } = renderApp('/reset-password#reset-token')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('New password'), 'a brand new password')
    await user.type(screen.getByLabelText('Repeat the password'), 'a brand new password')
    await user.click(screen.getByRole('button', { name: 'Set password and sign in' }))

    expect(await findAccountMenu()).toBeInTheDocument()
    expect(auth.completeReset).toHaveBeenCalledWith('reset-token', 'a brand new password')
    expect(history.get()).toBe('/')
  })

  it.each([
    ['used', 'This reset link has already been used.'],
    ['revoked', 'A newer reset link replaced this one.'],
    ['expired', 'This reset link has expired.'],
  ] as const)('says plainly when the link was %s and offers a new one', async (state, message) => {
    renderApp('/reset-password#reset-token', fakeAuthApi({ reset: state }))

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('link', { name: 'Ask for a new link' })).toBeInTheDocument()
  })

  it('tells an inactive account so', async () => {
    renderApp('/reset-password#reset-token', fakeAuthApi({ inactive: true }))
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('New password'), 'a brand new password')
    await user.type(screen.getByLabelText('Repeat the password'), 'a brand new password')
    await user.click(screen.getByRole('button', { name: 'Set password and sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This account is inactive.')
  })
})
