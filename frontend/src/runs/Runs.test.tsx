import { createMemoryHistory } from '@solidjs/router'
import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { fakeAuthApi, invitedTeacher } from '../auth/testing'
import { fakeClassesApi } from '../classes/testing'
import type { Course } from '../courses/api'
import { fakeCoursesApi, spanish } from '../courses/testing'
import { withI18n } from '../lesson/testing'
import type { Student } from '../students/api'
import { eva, fakeStudentsApi, jana, petr } from '../students/testing'
import { fakeRunsApi } from './testing'

const teacher: Account = { ...invitedTeacher, language: 'en' }
const ota: Student = { ...petr, id: 13, name: 'Ota Starý', email: 'ota@skola.example', state: 'inactive' }
const everyone = [jana, petr, eva, ota]
const classes = [
  { id: 1, name: '2.B 2026/27', memberIds: [jana.id, ota.id] },
  { id: 2, name: '2.A 2026/27', memberIds: [petr.id] },
]

function renderApp(path: string, options: { runs?: ReturnType<typeof run>[]; course?: Course } = {}) {
  const history = createMemoryHistory()
  history.set({ value: path })
  const runs = fakeRunsApi({ runs: options.runs, classes, students: everyone })
  const apis = fakeApis({
    auth: fakeAuthApi({ signedIn: teacher }),
    courses: fakeCoursesApi({ courses: [options.course ?? spanish] }),
    classes: fakeClassesApi({ classes, students: everyone }),
    students: fakeStudentsApi({ students: everyone }),
    runs,
  })
  render(withI18n(() => <App apis={apis} history={history} />, 'en'))
  return { runs, history }
}

const run = (fields: Partial<{ classIds: number[]; studentIds: number[] }> = {}) => ({
  id: 7,
  courseId: spanish.id,
  name: 'Španělština 2.B 2026/27',
  classIds: [],
  studentIds: [],
  ...fields,
})

const table = async (name: string) => within(await screen.findByRole('table', { name }))
const rowOf = async (tableName: string, text: string) => (await table(tableName)).getByText(text).closest('tr')!

describe('runs of a course', () => {
  it('lists the runs the teacher started, with their roster sizes', async () => {
    renderApp(`/courses/${spanish.id}?tab=runs`, { runs: [run({ classIds: [1] })] })

    const link = await screen.findByRole('link', { name: 'Španělština 2.B 2026/27' })
    expect(link).toHaveAttribute('href', '/runs/7')
    expect(within(link.closest('li')!).getByText('Students: 1')).toBeInTheDocument()
  })

  it('starts a named run and opens it', async () => {
    const { runs, history } = renderApp(`/courses/${spanish.id}?tab=runs`)
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Run name'), 'Španělština 2.A 2026/27')
    await user.click(screen.getByRole('button', { name: 'Start a run' }))

    expect(await screen.findByRole('heading', { name: 'Španělština 2.A 2026/27' })).toBeInTheDocument()
    expect(runs.start).toHaveBeenCalledWith(spanish.id, { name: 'Španělština 2.A 2026/27', mode: 'enrolled' })
    expect(history.get()).toMatch(/^\/runs\/\d+$/)
  })

  it('offers starting a run to editors only', async () => {
    renderApp(`/courses/${spanish.id}?tab=runs`, { course: { ...spanish, access: 'view', can_edit: false } })

    expect(await screen.findByRole('heading', { name: 'Course runs' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start a run' })).not.toBeInTheDocument()
  })
})

describe('run page', () => {
  it('shows the run in tabs, the overview first', async () => {
    renderApp('/runs/7', { runs: [run()] })

    const tabs = within(await screen.findByRole('navigation', { name: 'Course run' }))
    expect(tabs.getAllByRole('link').map((link) => link.textContent)).toEqual(['Overview', 'Releases', 'Students', 'Settings'])
    expect(tabs.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    expect(tabs.getByRole('link', { name: 'Students' })).toHaveAttribute('href', '/runs/7?tab=students')
    expect(screen.getByRole('link', { name: spanish.name })).toHaveAttribute('href', `/courses/${spanish.id}`)
  })

  it('starts a new run with enrolling a class, then releasing the first material', async () => {
    renderApp('/runs/7', { runs: [run()] })

    const start = within(await screen.findByRole('region', { name: 'Start the run' }))
    expect(start.getByRole('link', { name: 'Enrol a class, not done yet' })).toHaveAttribute('href', '/runs/7?tab=students')
    expect(start.getByRole('button', { name: 'Release the first material' })).toBeInTheDocument()
  })

  it('lists every student once, saying how each is enrolled, with the classes above', async () => {
    renderApp('/runs/7?tab=students', { runs: [run({ classIds: [1], studentIds: [jana.id, petr.id] })] })

    expect(within(await rowOf('Students', 'Jana Veselá')).getByText('2.B 2026/27, directly')).toBeInTheDocument()
    expect(within(await rowOf('Students', 'Petr Malý')).getByText('directly')).toBeInTheDocument()
    // Ota is in the class but deactivated.
    expect((await table('Students')).queryByText('Ota Starý')).not.toBeInTheDocument()
    const chips = within(screen.getByRole('list', { name: 'Enrolled classes' }))
    expect(chips.getByRole('link', { name: '2.B 2026/27' })).toHaveAttribute('href', '/classes/1')
  })

  it('enrols a class and a student in one dialog, and removes them again', async () => {
    const { runs } = renderApp('/runs/7?tab=students', { runs: [run()] })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Enrol a class or student' }))
    let dialog = within(screen.getByRole('dialog', { name: 'Enrol a class or student' }))
    await user.selectOptions(dialog.getByLabelText('Enrol a class'), '2.B 2026/27')
    await user.click(dialog.getByRole('button', { name: 'Enrol class' }))
    await user.click(await screen.findByRole('button', { name: 'Enrol a class or student' }))
    dialog = within(screen.getByRole('dialog', { name: 'Enrol a class or student' }))
    await user.selectOptions(dialog.getByLabelText('Enrol a student'), String(petr.id))
    await user.click(dialog.getByRole('button', { name: 'Enrol student' }))

    expect(runs.enrolClass).toHaveBeenCalledWith(7, 1)
    expect(runs.enrolStudent).toHaveBeenCalledWith(7, petr.id)
    expect(await rowOf('Students', 'Jana Veselá')).toBeInTheDocument()
    expect(await rowOf('Students', 'Petr Malý')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove the class 2.B 2026/27 from the run' }))
    expect(runs.unenrolClass).not.toHaveBeenCalled()
    await user.click(
      within(screen.getByRole('alertdialog', { name: 'Remove 2.B 2026/27 from the run?' })).getByRole('button', {
        name: 'Remove',
      }),
    )
    await user.click(within(await rowOf('Students', 'Petr Malý')).getByRole('button', { name: 'Remove' }))
    await user.click(
      within(screen.getByRole('alertdialog', { name: 'Remove Petr Malý from the run?' })).getByRole('button', {
        name: 'Remove',
      }),
    )

    expect(runs.unenrolClass).toHaveBeenCalledWith(7, 1)
    expect(runs.unenrolStudent).toHaveBeenCalledWith(7, petr.id)
    expect(await screen.findByText('No students in this run yet.')).toBeInTheDocument()
  })

  it('removes only direct enrolments from a row; a class student leaves with the class', async () => {
    renderApp('/runs/7?tab=students', { runs: [run({ classIds: [1] })] })

    expect(within(await rowOf('Students', 'Jana Veselá')).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
  })

  it('keeps a class enrolled when removing it is cancelled', async () => {
    const { runs } = renderApp('/runs/7?tab=students', { runs: [run({ classIds: [1] })] })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Remove the class 2.B 2026/27 from the run' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))

    expect(runs.unenrolClass).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: '2.B 2026/27' })).toBeInTheDocument()
  })

  it('offers only classes and students not enrolled yet', async () => {
    renderApp('/runs/7?tab=students', { runs: [run({ classIds: [1], studentIds: [petr.id] })] })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Enrol a class or student' }))
    const dialog = within(screen.getByRole('dialog'))
    const classChoice = within(dialog.getByLabelText('Enrol a class'))
    expect(classChoice.queryByRole('option', { name: '2.B 2026/27' })).not.toBeInTheDocument()
    expect(await classChoice.findByRole('option', { name: '2.A 2026/27' })).toBeInTheDocument()
    const studentChoice = within(dialog.getByLabelText('Enrol a student'))
    expect(studentChoice.queryByRole('option', { name: /Petr Malý/ })).not.toBeInTheDocument()
  })

  it('shows a directly enrolled minor awaiting consent in the list, marked', async () => {
    renderApp('/runs/7?tab=students', { runs: [run({ studentIds: [eva.id] })] })

    expect(within(await rowOf('Students', 'Eva Malá')).getByText('Awaiting consent')).toBeInTheDocument()
    expect(screen.getByText(/deactivated students and minors awaiting consent/)).toBeInTheDocument()
  })

  it('renames the run in its settings', async () => {
    const { runs } = renderApp('/runs/7?tab=settings', { runs: [run()] })
    const user = userEvent.setup()

    const name = await screen.findByLabelText('Run name')
    await user.clear(name)
    await user.type(name, '2.B odpoledne')
    await user.click(screen.getByRole('button', { name: 'Rename' }))

    expect(await screen.findByRole('heading', { name: '2.B odpoledne' })).toBeInTheDocument()
    expect(runs.rename).toHaveBeenCalledWith(7, '2.B odpoledne')
  })

  it('says when the run cannot be loaded', async () => {
    renderApp('/runs/99')

    expect(await screen.findByRole('alert')).toHaveTextContent('The run could not be loaded.')
  })
})
