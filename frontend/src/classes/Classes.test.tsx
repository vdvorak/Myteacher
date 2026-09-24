import { createMemoryHistory } from '@solidjs/router'
import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import { admin, fakeAuthApi, student } from '../auth/testing'
import type { Account } from '../auth/api'
import { withI18n } from '../lesson/testing'
import type { Student } from '../students/api'
import { fakeStudentsApi, jana, petr } from '../students/testing'
import { fakeClassesApi } from './testing'

const teacher: Account = { ...admin, roles: ['teacher'] }
const inactive: Student = { ...petr, id: 12, name: 'Ota Starý', email: 'ota@skola.example', state: 'inactive' }

function renderApp(path: string, signedIn: Account = teacher, studentsList: Student[] = [jana, petr, inactive]) {
  const history = createMemoryHistory()
  history.set({ value: path })
  const classes = fakeClassesApi({
    classes: [
      { id: 1, name: '2.B 2026/27', memberIds: [jana.id, inactive.id] },
      { id: 2, name: '2.A 2026/27', memberIds: [] },
    ],
    students: studentsList,
  })
  const students = fakeStudentsApi({ students: studentsList })
  render(withI18n(() => <App apis={fakeApis({ auth: fakeAuthApi({ signedIn }), classes, students })} history={history} />, 'en'))
  return { classes, history }
}

const row = async (text: string) => (await screen.findByText(text)).closest('tr')!

describe('classes list', () => {
  it('is in every teacher’s navigation and lists the classes with their sizes', async () => {
    const { history } = renderApp('/')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'Classes' }))

    expect(history.get()).toBe('/classes')
    expect(within(await row('2.B 2026/27')).getByText('2')).toBeInTheDocument()
    expect(within(await row('2.A 2026/27')).getByText('0')).toBeInTheDocument()
  })

  it('creates a class and opens it', async () => {
    const { classes, history } = renderApp('/classes')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Class name'), '1.C 2026/27')
    await user.click(screen.getByRole('button', { name: 'Create class' }))

    expect(await screen.findByRole('heading', { name: '1.C 2026/27' })).toBeInTheDocument()
    expect(classes.create).toHaveBeenCalledWith('1.C 2026/27')
    expect(history.get()).toMatch(/^\/classes\/\d+$/)
  })

  it('refuses a name another class has', async () => {
    renderApp('/classes')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Class name'), '2.A 2026/27')
    await user.click(screen.getByRole('button', { name: 'Create class' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Another class already has this name.')
  })

  it('is closed to students', async () => {
    renderApp('/classes', student)

    expect(await screen.findByRole('alert')).toHaveTextContent('Only teachers can open this page.')
    expect(screen.queryByRole('link', { name: 'Classes' })).not.toBeInTheDocument()
  })
})

describe('class page', () => {
  it('shows the members, deactivated ones marked inactive', async () => {
    renderApp('/classes/1')

    expect(await screen.findByRole('heading', { name: '2.B 2026/27' })).toBeInTheDocument()
    const members = screen.getByRole('table', { name: 'Members' })
    expect(within(within(members).getByText('Jana Veselá').closest('tr')!).getByText('Active')).toBeInTheDocument()
    expect(within(within(members).getByText('Ota Starý').closest('tr')!).getByText('Inactive')).toBeInTheDocument()
  })

  it('adds a student who is not in the class yet', async () => {
    const { classes } = renderApp('/classes/1')
    const user = userEvent.setup()

    const picker = await screen.findByLabelText('Add a student')
    const offered = within(picker)
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(offered).toContain('Petr Malý (petr@skola.example)')
    expect(offered).not.toContain('Jana Veselá (jana@skola.example)')
    await user.selectOptions(picker, String(petr.id))
    await user.click(screen.getByRole('button', { name: 'Add to class' }))

    const members = screen.getByRole('table', { name: 'Members' })
    expect(await within(members).findByText('Petr Malý')).toBeInTheDocument()
    expect(classes.addMember).toHaveBeenCalledWith(1, petr.id)
  })

  it('removes a member', async () => {
    const { classes } = renderApp('/classes/1')
    const user = userEvent.setup()

    await user.click(within(await row('Jana Veselá')).getByRole('button', { name: 'Remove from class' }))

    const members = screen.getByRole('table', { name: 'Members' })
    expect(within(members).queryByText('Jana Veselá')).not.toBeInTheDocument()
    expect(classes.removeMember).toHaveBeenCalledWith(1, jana.id)
  })

  it('renames the class', async () => {
    const { classes } = renderApp('/classes/1')
    const user = userEvent.setup()

    const name = await screen.findByLabelText('Class name')
    await user.clear(name)
    await user.type(name, '3.B 2027/28')
    await user.click(screen.getByRole('button', { name: 'Rename' }))

    expect(await screen.findByRole('heading', { name: '3.B 2027/28' })).toBeInTheDocument()
    expect(classes.rename).toHaveBeenCalledWith(1, '3.B 2027/28')
  })

  it('keeps a name being typed when the members change', async () => {
    renderApp('/classes/1')
    const user = userEvent.setup()

    const name = await screen.findByLabelText('Class name')
    await user.clear(name)
    await user.type(name, '3.B 2027/28')
    await user.click(within(await row('Jana Veselá')).getByRole('button', { name: 'Remove from class' }))

    expect(await screen.findByText('Ota Starý')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Jana Veselá' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Class name')).toHaveValue('3.B 2027/28')
  })

  it('links each member to their student page', async () => {
    const { history } = renderApp('/classes/1')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'Jana Veselá' }))

    expect(history.get()).toBe(`/students/${jana.id}`)
  })

  it('says so when the class does not exist', async () => {
    renderApp('/classes/999')

    expect(await screen.findByRole('alert')).toHaveTextContent('The class could not be loaded.')
  })
})

describe('student page', () => {
  it('shows the classes the student is in, linked', async () => {
    const inClass: Student = { ...jana, classes: [{ id: 1, name: '2.B 2026/27' }] }
    const { history } = renderApp(`/students/${jana.id}`, teacher, [inClass, petr])
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: '2.B 2026/27' }))

    expect(history.get()).toBe('/classes/1')
  })

  it('says when the student is in no class', async () => {
    renderApp(`/students/${petr.id}`)

    expect(await screen.findByText('Not in any class.')).toBeInTheDocument()
  })
})
