import { createMemoryHistory } from '@solidjs/router'
import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import { admin, fakeAuthApi } from '../auth/testing'
import { withI18n } from '../lesson/testing'
import { fakeStudentsApi, jana, petr } from '../students/testing'
import { fakeAdminApi } from './testing'

function renderAdmin() {
  const history = createMemoryHistory()
  history.set({ value: '/admin' })
  const adminApi = fakeAdminApi()
  const students = fakeStudentsApi({ students: [jana, petr] })
  render(
    withI18n(() => (
      <App apis={fakeApis({ auth: fakeAuthApi({ signedIn: admin }), admin: adminApi, students })} history={history} />
    )),
  )
  return { adminApi, students }
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(await screen.findByLabelText('Student to erase'), String(jana.id))
  await user.click(screen.getByRole('button', { name: 'Erase…' }))
  return screen.getByRole('dialog', { name: 'Erase Jana Veselá?' })
}

describe('erasure', () => {
  it('explains what erasure does before anything happens', async () => {
    const { adminApi } = renderAdmin()
    const user = userEvent.setup()

    const dialog = await openDialog(user)

    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument()
    expect(within(dialog).getByText(/deactivate the student instead/)).toBeInTheDocument()
    expect(adminApi.eraseStudent).not.toHaveBeenCalled()
  })

  it('erases only once the student’s name is typed', async () => {
    const { adminApi } = renderAdmin()
    const user = userEvent.setup()

    const dialog = await openDialog(user)
    const erase = within(dialog).getByRole('button', { name: 'Erase permanently' })
    expect(erase).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Type the student’s name to confirm: Jana Veselá'), 'Jana')
    expect(erase).toBeDisabled()
    await user.type(within(dialog).getByLabelText(/Type the student’s name/), ' Veselá')
    await user.click(erase)

    expect(await screen.findByRole('status')).toHaveTextContent('The data of Jana Veselá was erased.')
    expect(adminApi.eraseStudent).toHaveBeenCalledWith(jana.id, 'Jana Veselá')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const picker = screen.getByLabelText('Student to erase')
    expect(within(picker).queryByRole('option', { name: /Jana Veselá/ })).not.toBeInTheDocument()
  })

  it('can be cancelled', async () => {
    const { adminApi } = renderAdmin()
    const user = userEvent.setup()

    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(adminApi.eraseStudent).not.toHaveBeenCalled()
  })

  it('says so when the server does not take the confirmation', async () => {
    const history = createMemoryHistory()
    history.set({ value: '/admin' })
    const adminApi = fakeAdminApi(undefined, null, { erasureName: 'Jana Nová' })
    render(
      withI18n(() => (
        <App apis={fakeApis({ auth: fakeAuthApi({ signedIn: admin }), admin: adminApi })} history={history} />
      )),
    )
    const user = userEvent.setup()

    const dialog = await openDialog(user)
    await user.type(within(dialog).getByLabelText(/Type the student’s name/), 'Jana Veselá')
    await user.click(within(dialog).getByRole('button', { name: 'Erase permanently' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The name does not match. The student may have been renamed; reload the page.',
    )
  })
})

describe('erasure of a student erased meanwhile', () => {
  it('says the student is already erased and drops them from the list', async () => {
    const history = createMemoryHistory()
    history.set({ value: '/admin' })
    const adminApi = fakeAdminApi()
    adminApi.eraseStudent.mockResolvedValueOnce('already_erased')
    render(
      withI18n(() => (
        <App apis={fakeApis({ auth: fakeAuthApi({ signedIn: admin }), admin: adminApi })} history={history} />
      )),
    )
    const user = userEvent.setup()

    const dialog = await openDialog(user)
    await user.type(within(dialog).getByLabelText(/Type the student’s name/), 'Jana Veselá')
    await user.click(within(dialog).getByRole('button', { name: 'Erase permanently' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Jana Veselá was already erased.')
    const picker = screen.getByLabelText('Student to erase')
    expect(within(picker).queryByRole('option', { name: /Jana Veselá/ })).not.toBeInTheDocument()
  })
})
