import { createMemoryHistory } from '@solidjs/router'
import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { sampleLesson, withI18n } from '../lesson/testing'
import type { Locale } from '../i18n/messages'
import { fakeAdminApi } from '../admin/testing'
import { admin, fakeAuthApi } from './testing'

function renderApp(path: string, auth = fakeAuthApi(), locale: Locale = 'en') {
  const history = createMemoryHistory()
  history.set({ value: path })
  render(withI18n(() => <App auth={auth} admin={fakeAdminApi()} history={history} />, locale))
  return { auth, history }
}

async function signIn(email: string, password: string) {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Email'), email)
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  return user
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sign-in', () => {
  it('sends an anonymous visitor to the sign-in form', async () => {
    const { history } = renderApp('/')

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email')
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    expect(history.get()).toBe('/sign-in')
  })

  it('shows one generic message for wrong credentials', async () => {
    renderApp('/sign-in')

    await signIn('admin@skola.example', 'wrong password')

    expect(await screen.findByRole('alert')).toHaveTextContent('The email or password is not right.')
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('lands a signed-in teacher in the shell that says who they are', async () => {
    const { history } = renderApp('/sign-in')

    await signIn('admin@skola.example', 'correct horse battery')

    expect(await screen.findByText('admin@skola.example')).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(history.get()).toBe('/')
  })

  it('signs out back to the sign-in form', async () => {
    const { auth } = renderApp('/', fakeAuthApi({ signedIn: admin }))
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(auth.signOut).toHaveBeenCalled()
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('takes a visitor who is already signed in past the form', async () => {
    const { history } = renderApp('/sign-in', fakeAuthApi({ signedIn: admin }))

    expect(await screen.findByText('admin@skola.example')).toBeInTheDocument()
    expect(history.get()).toBe('/')
  })

  it('tells an inactive account plainly that it is inactive', async () => {
    renderApp('/sign-in', fakeAuthApi({ inactive: true }))

    await signIn('admin@skola.example', 'correct horse battery')

    expect(await screen.findByRole('alert')).toHaveTextContent('This account is inactive.')
  })

  it('still offers the form when the session cannot be checked', async () => {
    renderApp('/sign-in', fakeAuthApi({ meFails: true }))

    await signIn('admin@skola.example', 'correct horse battery')

    expect(await screen.findByText('admin@skola.example')).toBeInTheDocument()
  })

  it('says so when a signed-in page cannot check the session', async () => {
    renderApp('/', fakeAuthApi({ meFails: true }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Your account could not be loaded.')
  })

  it('offers the administration only to admins', async () => {
    const { history } = renderApp('/', fakeAuthApi({ signedIn: admin }))
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'Administration' }))

    expect(await screen.findByRole('heading', { name: 'Email (SMTP)' })).toBeInTheDocument()
    expect(history.get()).toBe('/admin')
  })

  it('refuses the administration to a teacher who is not an admin', async () => {
    renderApp('/admin', fakeAuthApi({ signedIn: { ...admin, roles: ['teacher'] } }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Only admins can open this page.')
    expect(screen.queryByRole('link', { name: 'Administration' })).not.toBeInTheDocument()
  })

  it('is available in Czech', async () => {
    renderApp('/sign-in', fakeAuthApi(), 'cs')

    expect(await screen.findByRole('heading', { name: 'Přihlášení' })).toBeInTheDocument()
    expect(screen.getByLabelText('Heslo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Přihlásit se' })).toBeInTheDocument()
  })

  it('keeps the lesson preview reachable', async () => {
    const fetch = vi.fn(async (_url: string) => Response.json(sampleLesson))
    vi.stubGlobal('fetch', fetch)
    renderApp('/preview/es%2Dser-estar?seed=1')

    expect(await screen.findByRole('heading', { name: 'Ser, or estar?' })).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/lessons/es-ser-estar')
  })
})
