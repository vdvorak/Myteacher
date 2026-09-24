import { createMemoryHistory } from '@solidjs/router'
import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { admin, fakeAuthApi, student } from '../auth/testing'
import { withI18n } from '../lesson/testing'
import { fakeStudentsApi, jana, petr } from './testing'

const teacher: Account = { ...admin, roles: ['teacher'] }

function renderApp(
  path: string,
  options: { signedIn?: Account; students?: ReturnType<typeof fakeStudentsApi> } = {},
) {
  const history = createMemoryHistory()
  history.set({ value: path })
  const students = options.students ?? fakeStudentsApi()
  const auth = fakeAuthApi({ signedIn: options.signedIn ?? teacher })
  render(withI18n(() => <App apis={fakeApis({ auth, students })} history={history} />, 'en'))
  return { students, history }
}

const NOTES_RULE = 'Only learning-related observations belong in student notes'

const row = async (text: string) => (await screen.findByText(text)).closest('tr')!

describe('students list', () => {
  it('is in the navigation of every teacher and lists every student with their state', async () => {
    const { history } = renderApp('/')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'Students' }))

    expect(history.get()).toBe('/students')
    expect(within(await row('Jana Veselá')).getByText('Active')).toBeInTheDocument()
    expect(within(await row('Petr Malý')).getByText('Invited')).toBeInTheDocument()
    expect(within(await row('Petr Malý')).getByText('petr@skola.example')).toBeInTheDocument()
  })

  it('creates a student and says the invitation went out', async () => {
    const { students } = renderApp('/students')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Name'), 'Eva Dlouhá')
    await user.type(screen.getByLabelText('Email'), 'eva@skola.example')
    await user.selectOptions(screen.getByLabelText('Their language'), 'cs')
    await user.click(screen.getByRole('button', { name: 'Create and invite' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Invitation sent to eva@skola.example.')
    expect(students.create).toHaveBeenCalledWith({ name: 'Eva Dlouhá', email: 'eva@skola.example', language: 'cs' })
    expect(within(await row('Eva Dlouhá')).getByText('Invited')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('')
  })

  it('states on the form that only learning-related observations belong in student notes', async () => {
    renderApp('/students')

    const form = (await screen.findByLabelText('Name')).closest('form')!
    expect(within(form).getByText(new RegExp(NOTES_RULE))).toBeInTheDocument()
  })

  it('says when the invitation email could not be sent', async () => {
    renderApp('/students', { students: fakeStudentsApi({ mailError: 'Could not connect.' }) })
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Name'), 'Eva Dlouhá')
    await user.type(screen.getByLabelText('Email'), 'eva@skola.example')
    await user.click(screen.getByRole('button', { name: 'Create and invite' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The account was created, but the invitation was not sent: Could not connect.',
    )
  })

  it('refuses an email that already has an account', async () => {
    renderApp('/students')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Name'), 'Jana Druhá')
    await user.type(screen.getByLabelText('Email'), 'jana@skola.example')
    await user.click(screen.getByRole('button', { name: 'Create and invite' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This email already belongs to an account.')
  })

  it('leads to the student page', async () => {
    const { history } = renderApp('/students')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'Petr Malý' }))

    expect(await screen.findByRole('heading', { name: 'Petr Malý' })).toBeInTheDocument()
    expect(history.get()).toBe(`/students/${petr.id}`)
  })

  it('is closed to students', async () => {
    renderApp('/students', { signedIn: student })

    expect(await screen.findByRole('alert')).toHaveTextContent('Only teachers can open this page.')
    expect(screen.queryByRole('link', { name: 'Students' })).not.toBeInTheDocument()
  })
})

describe('student page', () => {
  it('edits the basics', async () => {
    const { students } = renderApp(`/students/${jana.id}`)
    const user = userEvent.setup()

    const name = await screen.findByLabelText('Name')
    expect(name).toHaveValue('Jana Veselá')
    expect(screen.getByLabelText('Email')).toHaveValue('jana@skola.example')
    expect(screen.getByText(new RegExp(NOTES_RULE))).toBeInTheDocument()
    await user.clear(name)
    await user.type(name, 'Jana Nová')
    await user.selectOptions(screen.getByLabelText('Their language'), 'en')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Saved.')
    expect(students.change).toHaveBeenCalledWith(jana.id, {
      name: 'Jana Nová',
      email: 'jana@skola.example',
      language: 'en',
    })
    expect(screen.getByRole('heading', { name: 'Jana Nová' })).toBeInTheDocument()
  })

  it('says a corrected email voided the invitation sent to the old one', async () => {
    renderApp(`/students/${petr.id}`)
    const user = userEvent.setup()

    const email = await screen.findByLabelText('Email')
    await user.clear(email)
    await user.type(email, 'petr.maly@skola.example')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Saved. The invitation sent to the previous email no longer works; resend it to the new one.',
    )
  })

  it('refuses an email another account has', async () => {
    renderApp(`/students/${jana.id}`)
    const user = userEvent.setup()

    const email = await screen.findByLabelText('Email')
    await user.clear(email)
    await user.type(email, 'petr@skola.example')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This email already belongs to an account.')
  })

  it('resends and revokes the invitation of a student who has not accepted', async () => {
    const { students } = renderApp(`/students/${petr.id}`)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Resend invitation' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Invitation sent to petr@skola.example.')
    await user.click(screen.getByRole('button', { name: 'Revoke invitation' }))

    expect(await screen.findByRole('status')).toHaveTextContent('The invitation link no longer works.')
    expect(students.resendInvitation).toHaveBeenCalledWith(petr.id)
    expect(students.revokeInvitation).toHaveBeenCalledWith(petr.id)
  })

  it('offers no invitation actions once the student has accepted', async () => {
    renderApp(`/students/${jana.id}`)

    expect(await screen.findByRole('heading', { name: 'Jana Veselá' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resend invitation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revoke invitation' })).not.toBeInTheDocument()
  })

  it('deactivates and reactivates the student', async () => {
    const { students } = renderApp(`/students/${jana.id}`)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Deactivate' }))
    expect(await screen.findByText('Inactive')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reactivate' }))

    expect(await screen.findByText('Active')).toBeInTheDocument()
    expect(students.change).toHaveBeenCalledWith(jana.id, { active: false })
    expect(students.change).toHaveBeenCalledWith(jana.id, { active: true })
  })

  it('says so when the student does not exist', async () => {
    renderApp('/students/999')

    expect(await screen.findByRole('alert')).toHaveTextContent('The student could not be loaded.')
  })
})
