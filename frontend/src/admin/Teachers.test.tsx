import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { withI18n } from '../lesson/testing'
import type { Teacher } from './api'
import { TeachersSection } from './TeachersSection'
import { adminTeacher, fakeAdminApi, unconfigured } from './testing'

const novak: Teacher = { id: 2, email: 'novak@skola.example', language: 'cs', is_admin: false, state: 'active' }
const invited: Teacher = { id: 3, email: 'smith@skola.example', language: 'en', is_admin: false, state: 'invited' }

function renderSection(options: Parameters<typeof fakeAdminApi>[2] = {}) {
  const api = fakeAdminApi(unconfigured, null, { teachers: [adminTeacher, novak, invited], ...options })
  render(withI18n(() => <TeachersSection api={api} />))
  return api
}

const row = async (email: string) => (await screen.findByText(email)).closest('tr')!

describe('teachers', () => {
  it('lists the teachers with their state and role', async () => {
    renderSection()

    expect(within(await row('admin@skola.example')).getByText('Admin')).toBeInTheDocument()
    expect(within(await row('novak@skola.example')).getByText('Active')).toBeInTheDocument()
    expect(within(await row('smith@skola.example')).getByText('Invited')).toBeInTheDocument()
  })

  it('invites a new teacher in the language chosen for them', async () => {
    const api = renderSection()
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Email of the new teacher'), 'dvorak@skola.example')
    await user.selectOptions(screen.getByLabelText('Their language'), 'cs')
    await user.click(screen.getByRole('button', { name: 'Invite teacher' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Invitation sent to dvorak@skola.example.')
    expect(api.createTeacher).toHaveBeenCalledWith('dvorak@skola.example', 'cs')
    expect(within(await row('dvorak@skola.example')).getByText('Invited')).toBeInTheDocument()
  })

  it('says when the invitation email could not be sent', async () => {
    renderSection({ mailError: 'Could not connect to smtp.skola.example:587.' })
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Email of the new teacher'), 'dvorak@skola.example')
    await user.click(screen.getByRole('button', { name: 'Invite teacher' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The account was created, but the invitation was not sent: Could not connect to smtp.skola.example:587.',
    )
  })

  it('says a failed resend kept the previous link, not that an account was created', async () => {
    renderSection({ mailError: 'Could not connect to smtp.skola.example:587.' })
    const user = userEvent.setup()

    await user.click(within(await row('smith@skola.example')).getByRole('button', { name: 'Resend invitation' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The invitation was not sent, and the previous link still works: Could not connect',
    )
  })

  it('refuses an email that already has an account', async () => {
    renderSection()
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Email of the new teacher'), 'novak@skola.example')
    await user.click(screen.getByRole('button', { name: 'Invite teacher' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This email already belongs to an account.')
  })

  it('deactivates and reactivates a teacher', async () => {
    const api = renderSection()
    const user = userEvent.setup()

    await user.click(within(await row('novak@skola.example')).getByRole('button', { name: 'Deactivate' }))
    expect(within(await row('novak@skola.example')).getByText('Inactive')).toBeInTheDocument()
    await user.click(within(await row('novak@skola.example')).getByRole('button', { name: 'Reactivate' }))

    expect(within(await row('novak@skola.example')).getByText('Active')).toBeInTheDocument()
    expect(api.changeTeacher).toHaveBeenCalledWith(2, { active: false })
    expect(api.changeTeacher).toHaveBeenCalledWith(2, { active: true })
  })

  it('grants the admin role', async () => {
    const api = renderSection()
    const user = userEvent.setup()

    await user.click(within(await row('novak@skola.example')).getByRole('button', { name: 'Make admin' }))

    expect(within(await row('novak@skola.example')).getByText('Admin')).toBeInTheDocument()
    expect(api.changeTeacher).toHaveBeenCalledWith(2, { is_admin: true })
  })

  it('explains why the last active admin cannot step down', async () => {
    renderSection()
    const user = userEvent.setup()

    await user.click(within(await row('admin@skola.example')).getByRole('button', { name: 'Remove admin role' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The instance needs at least one active admin.')
    expect(within(await row('admin@skola.example')).getByText('Admin')).toBeInTheDocument()
  })

  it('resends an invitation that has not been accepted', async () => {
    const api = renderSection()
    const user = userEvent.setup()

    expect(within(await row('novak@skola.example')).queryByRole('button', { name: 'Resend invitation' })).toBeNull()
    await user.click(within(await row('smith@skola.example')).getByRole('button', { name: 'Resend invitation' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Invitation sent to smith@skola.example.')
    expect(api.resendInvitation).toHaveBeenCalledWith(3)
  })
})
