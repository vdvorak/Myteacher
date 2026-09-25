import { createMemoryHistory } from '@solidjs/router'
import { render, screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { fakeAuthApi, invitedTeacher } from '../auth/testing'
import { ApiError } from '../lesson/api'
import { withI18n } from '../lesson/testing'
import { AccessConflict, type AccessEntry, type Course } from './api'
import { fakeCoursesApi, spanish } from './testing'

const teacher: Account = { ...invitedTeacher, language: 'en' }
const colleague: AccessEntry = {
  teacher_id: 5,
  email: 'svoboda@skola.example',
  right: 'view',
}
const viewer: Course = {
  ...spanish,
  access: 'view',
  can_edit: false,
  can_manage_access: false,
}
const editor: Course = {
  ...spanish,
  access: 'edit',
  can_edit: true,
  can_manage_access: false,
}

function renderCourse(options: { course?: Course; access?: AccessEntry[]; path?: string } = {}) {
  const course = options.course ?? spanish
  const history = createMemoryHistory()
  history.set({ value: options.path ?? `/courses/${course.id}` })
  const courses = fakeCoursesApi({
    courses: [course],
    access: { [course.id]: options.access ?? [colleague] },
  })
  const apis = fakeApis({ auth: fakeAuthApi({ signedIn: teacher }), courses })
  render(withI18n(() => <App apis={apis} history={history} />, 'en'))
  return { courses, history }
}

async function openDialog() {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Share the course' }))
  return {
    user,
    dialog: within(await screen.findByRole('dialog', { name: 'Course access' })),
  }
}

const row = (dialog: ReturnType<typeof within>, email: string) =>
  within(dialog.getByRole('cell', { name: email }).closest('tr')!)

describe('course access list', () => {
  it('lists the teachers the owner shared the course with', async () => {
    renderCourse()
    const { dialog } = await openDialog()

    expect(await dialog.findByRole('cell', { name: 'svoboda@skola.example' })).toBeInTheDocument()
    expect(
      row(dialog, 'svoboda@skola.example').getByRole('combobox', {
        name: 'Right of svoboda@skola.example',
      }),
    ).toHaveValue('view')
  })

  it('grants a right to a teacher named by email', async () => {
    const { courses } = renderCourse({ access: [] })
    const { user, dialog } = await openDialog()

    expect(await dialog.findByText('The course is shared with nobody yet.')).toBeInTheDocument()
    await user.type(dialog.getByRole('textbox', { name: 'Teacher’s email' }), 'kralova@skola.example')
    await user.selectOptions(dialog.getByRole('combobox', { name: 'Right' }), 'edit')
    await user.click(dialog.getByRole('button', { name: 'Give access' }))

    expect(courses.grantAccess).toHaveBeenCalledWith(1, 'kralova@skola.example', 'edit')
    expect(await dialog.findByRole('cell', { name: 'kralova@skola.example' })).toBeInTheDocument()
    expect(dialog.getByRole('textbox', { name: 'Teacher’s email' })).toHaveValue('')
  })

  it('offers the three rights in plain words', async () => {
    renderCourse()
    const { dialog } = await openDialog()

    const options = within(dialog.getByRole('combobox', { name: 'Right' })).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Can view', 'Can view and fork', 'Can edit'])
  })

  it('changes and removes a right', async () => {
    const { courses } = renderCourse()
    const { user, dialog } = await openDialog()

    await user.selectOptions(
      await dialog.findByRole('combobox', {
        name: 'Right of svoboda@skola.example',
      }),
      'fork',
    )
    expect(courses.changeAccess).toHaveBeenCalledWith(1, 5, 'fork')
    await user.click(dialog.getByRole('button', { name: 'Remove svoboda@skola.example' }))

    expect(courses.removeAccess).toHaveBeenCalledWith(1, 5)
    await waitFor(() => expect(dialog.queryByRole('cell', { name: 'svoboda@skola.example' })).not.toBeInTheDocument())
  })

  it.each([
    ['not_a_teacher', 'No teacher has this email.'],
    ['is_owner', 'This teacher already owns the course.'],
  ] as const)('explains a refused grant: %s', async (reason, message) => {
    const { courses } = renderCourse()
    courses.grantAccess.mockRejectedValueOnce(new AccessConflict(reason))
    const { user, dialog } = await openDialog()

    await user.type(dialog.getByRole('textbox', { name: 'Teacher’s email' }), 'x@skola.example')
    await user.click(dialog.getByRole('button', { name: 'Give access' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent(message)
    expect(dialog.getByRole('textbox', { name: 'Teacher’s email' })).toHaveValue('x@skola.example')
  })

  it('puts a right back when its change failed', async () => {
    const { courses } = renderCourse()
    courses.changeAccess.mockRejectedValueOnce(new ApiError(500))
    const { user, dialog } = await openDialog()

    await user.selectOptions(await dialog.findByRole('combobox', { name: 'Right of svoboda@skola.example' }), 'edit')

    expect(await dialog.findByRole('alert')).toHaveTextContent('The change could not be saved.')
    await waitFor(() =>
      expect(dialog.getByRole('combobox', { name: 'Right of svoboda@skola.example' })).toHaveValue('view'),
    )
  })

  it('puts a right back and reloads when its change was refused', async () => {
    const { courses } = renderCourse()
    courses.changeAccess.mockRejectedValueOnce(new AccessConflict('access_changed'))
    const { user, dialog } = await openDialog()

    await user.selectOptions(
      await dialog.findByRole('combobox', {
        name: 'Right of svoboda@skola.example',
      }),
      'edit',
    )

    expect(await dialog.findByRole('alert')).toHaveTextContent('The access list changed meanwhile and was reloaded.')
    await waitFor(() =>
      expect(
        dialog.getByRole('combobox', {
          name: 'Right of svoboda@skola.example',
        }),
      ).toHaveValue('view'),
    )
  })

  it('is closed again', async () => {
    renderCourse()
    const { user, dialog } = await openDialog()

    await user.click(dialog.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each([
    ['an editor', editor],
    ['a viewer', viewer],
  ])('is not offered to %s', async (_who, course) => {
    renderCourse({ course })

    await screen.findByRole('heading', { name: 'Španělština 2.B' })
    expect(screen.queryByRole('button', { name: 'Share the course' })).not.toBeInTheDocument()
  })
})

describe('ownership transfer', () => {
  it('asks to confirm, then leaves the course the owner no longer has', async () => {
    const { courses, history } = renderCourse()
    const { user, dialog } = await openDialog()

    await user.type(dialog.getByRole('textbox', { name: 'New owner’s email' }), 'svoboda@skola.example')
    await user.click(dialog.getByRole('button', { name: 'Transfer ownership' }))
    expect(courses.transferOwnership).not.toHaveBeenCalled()
    const confirmation = screen.getByRole('alertdialog', { name: 'Transfer ownership of this course?' })
    expect(confirmation).toHaveAccessibleDescription(/svoboda@skola.example will own the course.*no right/i)
    await user.click(within(confirmation).getByRole('button', { name: 'Confirm the transfer' }))

    expect(courses.transferOwnership).toHaveBeenCalledWith(1, 'svoboda@skola.example', null)
    await waitFor(() => expect(history.get()).toBe('/courses'))
  })

  it('keeps a right for the previous owner when chosen', async () => {
    const { courses } = renderCourse()
    const { user, dialog } = await openDialog()

    await user.type(dialog.getByRole('textbox', { name: 'New owner’s email' }), 'svoboda@skola.example')
    await user.selectOptions(dialog.getByRole('combobox', { name: 'What you keep' }), 'edit')
    await user.click(dialog.getByRole('button', { name: 'Transfer ownership' }))
    await user.click(screen.getByRole('button', { name: 'Confirm the transfer' }))

    expect(courses.transferOwnership).toHaveBeenCalledWith(1, 'svoboda@skola.example', 'edit')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Share the course' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Save course' })).toBeInTheDocument()
  })

  it('is cancelled before it happens', async () => {
    const { courses } = renderCourse()
    const { user, dialog } = await openDialog()

    await user.type(dialog.getByRole('textbox', { name: 'New owner’s email' }), 'svoboda@skola.example')
    await user.click(dialog.getByRole('button', { name: 'Transfer ownership' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))

    expect(courses.transferOwnership).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Transfer ownership' })).toBeInTheDocument()
  })
})

describe('a course seen with a right', () => {
  it('is read-only for a viewer', async () => {
    renderCourse({ course: viewer })

    expect(await screen.findByRole('heading', { name: 'Španělština 2.B' })).toBeInTheDocument()
    expect(screen.getByText('You can view this course but not change it.')).toBeInTheDocument()
    expect(screen.getByLabelText('Course name')).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Level' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Level' })).toHaveValue('A2')
    expect(screen.getByLabelText('Feedback')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save course' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save Level' })).not.toBeInTheDocument()
  })

  it('is editable for an editor', async () => {
    renderCourse({ course: editor })

    expect(await screen.findByRole('button', { name: 'Save course' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Level' })).toBeEnabled()
    expect(screen.queryByText('You can view this course but not change it.')).not.toBeInTheDocument()
  })

  it('shows in the course list with the teacher’s right', async () => {
    renderCourse({ course: { ...viewer, access: 'fork' }, path: '/courses' })

    const course = (await screen.findByRole('link', { name: 'Španělština 2.B' })).closest('tr')!
    expect(within(course).getByText('Can view and fork')).toBeInTheDocument()
  })
})
