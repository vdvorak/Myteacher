import { createMemoryHistory } from '@solidjs/router'
import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Locale } from '../i18n/messages'
import { withI18n } from '../lesson/testing'
import { fakeAuthApi } from './testing'

function renderApp(path: string, auth = fakeAuthApi(), locale: Locale = 'en') {
  const history = createMemoryHistory()
  history.set({ value: path })
  render(withI18n(() => <App apis={fakeApis({ auth })} history={history} />, locale))
  return { auth, history }
}

async function setPassword(password: string, repeated = password) {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('New password'), password)
  await user.type(screen.getByLabelText('Repeat the password'), repeated)
  await user.click(screen.getByRole('button', { name: 'Set password and sign in' }))
}

describe('accepting an invitation', () => {
  it('sets the password and lands the teacher signed in', async () => {
    const { auth, history } = renderApp('/invitation#the-token')

    expect(await screen.findByText('novak@skola.example')).toBeInTheDocument()
    await setPassword('the teacher password')

    expect(await screen.findByRole('button', { name: 'Odhlásit se' })).toBeInTheDocument()
    expect(auth.acceptInvitation).toHaveBeenCalledWith('the-token', 'the teacher password')
    expect(history.get()).toBe('/')
  })

  it('asks for the same password twice', async () => {
    const { auth } = renderApp('/invitation#the-token')

    await setPassword('the teacher password', 'a different password')

    expect(await screen.findByRole('alert')).toHaveTextContent('The passwords differ.')
    expect(auth.acceptInvitation).not.toHaveBeenCalled()
  })

  it('asks for a long enough password', async () => {
    const { auth } = renderApp('/invitation#the-token')

    await setPassword('short')

    expect(await screen.findByRole('alert')).toHaveTextContent('at least 12 characters')
    expect(auth.acceptInvitation).not.toHaveBeenCalled()
  })

  it.each([
    ['used', 'This invitation link has already been used.'],
    ['revoked', 'This invitation link was replaced by a newer one or withdrawn.'],
    ['expired', 'This invitation link has expired.'],
  ] as const)('says plainly when the link was %s', async (state, message) => {
    renderApp('/invitation#the-token', fakeAuthApi({ invitation: state }))

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to sign-in' })).toBeInTheDocument()
  })

  it('says plainly when the link is not an invitation', async () => {
    renderApp('/invitation')

    expect(await screen.findByRole('alert')).toHaveTextContent('This link is not a valid invitation.')
  })

  it('tells an inactive account so', async () => {
    renderApp('/invitation#the-token', fakeAuthApi({ inactive: true }))

    await setPassword('the teacher password')

    expect(await screen.findByRole('alert')).toHaveTextContent('This account is inactive.')
  })

  it('is available in Czech', async () => {
    renderApp('/invitation#the-token', fakeAuthApi(), 'cs')

    expect(await screen.findByRole('heading', { name: 'Nastavení hesla' })).toBeInTheDocument()
  })
})
