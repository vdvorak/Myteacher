import { createMemoryHistory } from '@solidjs/router'
import { render, screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { createSignal } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { admin, fakeAuthApi, student } from '../auth/testing'
import { fakeClassesApi } from '../classes/testing'
import { fakeCoursesApi, spanish } from '../courses/testing'
import { fakeRunsApi } from '../runs/testing'
import { withI18n } from '../lesson/testing'
import { fakeSettingsApi } from '../settings/testing'
import { fakeStudentsApi, jana } from '../students/testing'
import { ConfirmProvider, useConfirm } from './confirm'

const teacher: Account = { ...admin, roles: ['teacher'] }

function renderApp(path: string, signedIn: Account = teacher) {
  const history = createMemoryHistory()
  history.set({ value: path })
  const settings = fakeSettingsApi()
  const classes = fakeClassesApi({ classes: [{ id: 1, name: '2.B 2026/27', memberIds: [jana.id] }], students: [jana] })
  const students = fakeStudentsApi({ students: [jana] })
  const apis = fakeApis({ auth: fakeAuthApi({ signedIn }), settings, classes, students })
  render(withI18n(() => <App apis={apis} history={history} />, 'en'))
  return { history, settings }
}

const navigation = async () => screen.findByRole('navigation', { name: 'Main' })

describe('teacher navigation', () => {
  it('orders the sections as the work goes, with places kept for later features', async () => {
    renderApp('/')

    const nav = await navigation()
    const links = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent)
    expect(links).toEqual(['Overview', 'Courses', 'Course runs', 'Classes and students', 'Settings'])
    expect(within(nav).getByRole('list', { name: 'Preparation' })).toHaveTextContent('Courses')
    expect(within(nav).getByRole('list', { name: 'Teaching' })).toHaveTextContent(
      'Course runsReview queue laterStudent questions later',
    )
    expect(within(nav).queryByRole('link', { name: /Review queue/ })).not.toBeInTheDocument()
  })

  it('shows administration to admins only', async () => {
    renderApp('/', admin)

    expect(within(await navigation()).getByRole('link', { name: 'Administration' })).toHaveAttribute('href', '/admin')
  })

  it('marks the section of the current page, classes and students being one', async () => {
    renderApp(`/students/${jana.id}`)

    const nav = await navigation()
    expect(within(nav).getByRole('link', { name: 'Classes and students' })).toHaveClass('active')
    expect(within(nav).getByRole('link', { name: 'Courses' })).not.toHaveClass('active')
  })

  it('opens from the menu button on a narrow screen and closes on choosing a page', async () => {
    const { history } = renderApp('/')
    const user = userEvent.setup()
    const menu = await screen.findByRole('button', { name: 'Menu' })
    expect(menu).toHaveAttribute('aria-expanded', 'false')

    await user.click(menu)
    expect(menu).toHaveAttribute('aria-expanded', 'true')
    await user.click(within(await navigation()).getByRole('link', { name: 'Courses' }))

    expect(history.get()).toBe('/courses')
    expect(menu).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes on Escape or a tap beside it, giving the focus back to the menu button', async () => {
    renderApp('/')
    const user = userEvent.setup()
    const menu = await screen.findByRole('button', { name: 'Menu' })

    await user.click(menu)
    await user.keyboard('{Escape}')
    expect(menu).toHaveAttribute('aria-expanded', 'false')
    expect(menu).toHaveFocus()

    await user.click(menu)
    await user.click(screen.getByRole('button', { name: 'Close the menu' }))
    expect(menu).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows the way to the current page as breadcrumbs', async () => {
    renderApp('/classes/1')

    const crumbs = await screen.findByRole('navigation', { name: 'You are here' })
    expect(await within(crumbs).findByText('2.B 2026/27')).toHaveAttribute('aria-current', 'page')
    expect(within(crumbs).getByRole('link', { name: 'Classes and students' })).toHaveAttribute('href', '/classes')
  })

  it('opens the course runs, pointing to the courses while there is none', async () => {
    renderApp('/runs')

    expect(await screen.findByRole('heading', { name: 'Course runs' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to courses' })).toHaveAttribute('href', '/courses')
  })
})

describe('student frame', () => {
  it('has no navigation, only the account menu', async () => {
    renderApp('/', student)

    expect(await screen.findByRole('button', { name: `Account: ${student.email}` })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'You are here' })).not.toBeInTheDocument()
  })
})

describe('student frame', () => {
  it('leads back home from any page through the app name', async () => {
    const { history } = renderApp('/settings', student)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'Myteacher' }))

    expect(history.get()).toBe('/')
  })
})

describe('account menu', () => {
  it('shows who is signed in, and changes the language and theme there', async () => {
    const { settings } = renderApp('/')
    const user = userEvent.setup()
    const account = await screen.findByRole('button', { name: `Account: ${teacher.email}` })
    expect(account).toHaveTextContent('AS')

    await user.click(account)
    expect(screen.getByText(teacher.email)).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Theme'), 'dark')
    await user.selectOptions(screen.getByLabelText('Language'), 'cs')

    expect(settings.change).toHaveBeenCalledWith(teacher.id, { theme: 'dark' })
    expect(settings.change).toHaveBeenCalledWith(teacher.id, { language: 'cs' })
    delete document.documentElement.dataset.theme
    localStorage.clear()
  })

  it('closes on Escape and gives the focus back to its button', async () => {
    renderApp('/')
    const user = userEvent.setup()
    const account = await screen.findByRole('button', { name: `Account: ${teacher.email}` })

    await user.click(account)
    expect(account).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')

    expect(account).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
    expect(account).toHaveFocus()
  })

  it('signs out', async () => {
    renderApp('/')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: `Account: ${teacher.email}` }))
    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })
})

describe('confirmation on a page that is left', () => {
  it('is cancelled when the page changes under it', async () => {
    const history = createMemoryHistory()
    history.set({ value: '/runs/7' })
    const runs = fakeRunsApi({ runs: [{ id: 7, courseId: spanish.id, name: 'Běh', classIds: [1], studentIds: [] }] })
    const apis = fakeApis({ auth: fakeAuthApi({ signedIn: teacher }), runs, courses: fakeCoursesApi({ courses: [spanish] }) })
    render(withI18n(() => <App apis={apis} history={history} />, 'en'))
    const user = userEvent.setup()

    const enrolled = await screen.findByRole('table', { name: 'Enrolled classes' })
    await user.click(within(enrolled).getByRole('button', { name: 'Remove' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    history.set({ value: '/courses' })

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(runs.unenrolClass).not.toHaveBeenCalled()
  })
})

describe('confirmation dialog', () => {
  function Asker() {
    const confirm = useConfirm()
    const [answer, setAnswer] = createSignal('none')
    return (
      <>
        <button
          type="button"
          onClick={async () =>
            setAnswer(String(await confirm({ title: 'Retract the release?', body: 'Students lose it.', action: 'Retract' })))
          }
        >
          Retract…
        </button>
        <output>{answer()}</output>
      </>
    )
  }

  const renderAsker = () =>
    render(
      withI18n(() => (
        <ConfirmProvider>
          <Asker />
        </ConfirmProvider>
      )),
    )

  it('asks with the focus on cancelling, and keeps the focus inside', async () => {
    renderAsker()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Retract…' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Retract the release?' })
    expect(dialog).toHaveAccessibleDescription('Students lose it.')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: 'Retract' })).toHaveFocus()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(within(dialog).getByRole('button', { name: 'Retract' })).toHaveFocus()
  })

  it('answers yes only when confirmed, and gives the focus back', async () => {
    renderAsker()
    const user = userEvent.setup()
    const trigger = screen.getByRole('button', { name: 'Retract…' })

    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Retract' }))

    expect(await screen.findByText('true')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('answers no on Cancel or Escape', async () => {
    renderAsker()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Retract…' }))
    await user.keyboard('{Escape}')
    expect(await screen.findByText('false')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retract…' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByText('false')).toBeInTheDocument()
  })
})
