import { createMemoryHistory } from '@solidjs/router'
import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import { admin, fakeAuthApi } from '../auth/testing'
import { withI18n } from '../lesson/testing'
import { eva, fakeStudentsApi, jana, petr } from './testing'

function renderApp(path: string) {
  const history = createMemoryHistory()
  history.set({ value: path })
  const students = fakeStudentsApi({ students: [jana, petr, eva] })
  const auth = fakeAuthApi({ signedIn: { ...admin, roles: ['teacher'] } })
  render(withI18n(() => <App apis={fakeApis({ auth, students })} history={history} />, 'en'))
  return { students }
}

const consentForm = async () => (await screen.findByRole('button', { name: 'Record consent' })).closest('form')!

describe('minors and guardian consent', () => {
  it('creates a minor without inviting them and says what comes next', async () => {
    const { students } = renderApp('/students')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Name'), 'Ota Malý')
    await user.type(screen.getByLabelText('Email'), 'ota@skola.example')
    await user.click(screen.getByLabelText(/Minor/))
    await user.click(screen.getByRole('button', { name: 'Create and invite' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'The student was created. As a minor, they get no invitation until you record a guardian’s consent and activate the account.',
    )
    expect(students.create).toHaveBeenCalledWith(expect.objectContaining({ minor: true }))
    expect(within((await screen.findByText('Ota Malý')).closest('tr')!).getByText('Awaiting consent')).toBeInTheDocument()
  })

  it('refuses to activate a minor before consent and shows the reason', async () => {
    renderApp(`/students/${eva.id}`)
    const user = userEvent.setup()

    expect(await screen.findByText('Awaiting consent')).toBeInTheDocument()
    expect(screen.getByText(/No guardian consent is recorded/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Activate' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A minor’s account can be activated only once a guardian’s consent is recorded.',
    )
  })

  it('records consent with the teacher’s attestation and a note, then activates', async () => {
    const { students } = renderApp(`/students/${eva.id}`)
    const user = userEvent.setup()

    const form = await consentForm()
    const attest = within(form).getByLabelText(/I confirm that a legal guardian of this student has agreed/)
    expect(attest).toBeRequired()
    await user.click(attest)
    await user.type(within(form).getByLabelText('Note (optional)'), 'Signed form in the class folder.')
    await user.click(within(form).getByRole('button', { name: 'Record consent' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Consent recorded. You can activate the account now.')
    expect(students.recordConsent).toHaveBeenCalledWith(eva.id, 'Signed form in the class folder.')
    expect(screen.getByText(/attested by admin@skola\.example/)).toBeInTheDocument()
    expect(screen.getByText('Signed form in the class folder.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reactivate' }))
    expect(await screen.findByText('Active')).toBeInTheDocument()
  })

  it('sends no note when it is left empty', async () => {
    const { students } = renderApp(`/students/${eva.id}`)
    const user = userEvent.setup()

    const form = await consentForm()
    await user.click(within(form).getByLabelText(/I confirm/))
    await user.click(within(form).getByRole('button', { name: 'Record consent' }))

    expect(students.recordConsent).toHaveBeenCalledWith(eva.id, null)
  })

  it('does not record consent without the attestation', async () => {
    const { students } = renderApp(`/students/${eva.id}`)
    const user = userEvent.setup()

    await user.click(within(await consentForm()).getByRole('button', { name: 'Record consent' }))

    expect(students.recordConsent).not.toHaveBeenCalled()
  })

  it('says that marking an active student as a minor deactivated them', async () => {
    renderApp(`/students/${jana.id}`)
    const user = userEvent.setup()

    await user.click(await screen.findByLabelText(/Minor/))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Saved. As a minor without a recorded guardian’s consent, the student is deactivated until you record it.',
    )
    expect(screen.getByText('Awaiting consent')).toBeInTheDocument()
    expect(await consentForm()).toBeInTheDocument()
  })

  it('offers no consent form for a student who is not a minor', async () => {
    renderApp(`/students/${jana.id}`)

    expect(await screen.findByRole('heading', { name: 'Jana Veselá' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record consent' })).not.toBeInTheDocument()
  })
})
