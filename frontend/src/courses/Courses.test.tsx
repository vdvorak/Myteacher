import { createMemoryHistory } from '@solidjs/router'
import { render, screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { fakeAuthApi, invitedTeacher, student } from '../auth/testing'
import { withI18n } from '../lesson/testing'
import { ApiError } from '../lesson/api'
import type { Course } from './api'
import { fakeCoursesApi, spanish } from './testing'

const teacher: Account = { ...invitedTeacher, language: 'en' }

function renderApp(path: string, options: { signedIn?: Account; courses?: Course[] } = {}) {
  const history = createMemoryHistory()
  history.set({ value: path })
  const courses = fakeCoursesApi({ courses: options.courses })
  const apis = fakeApis({ auth: fakeAuthApi({ signedIn: options.signedIn ?? teacher }), courses })
  render(withI18n(() => <App apis={apis} history={history} />, 'en'))
  return { courses, history }
}

const briefField = (name: string) => screen.findByRole('textbox', { name })

describe('course list', () => {
  it('is in a teacher’s navigation and lists their courses', async () => {
    const { history } = renderApp('/')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'Courses' }))

    expect(history.get()).toBe('/courses')
    const row = (await screen.findByRole('link', { name: 'Španělština 2.B' })).closest('tr')!
    expect(within(row).getByText('Spanish')).toBeInTheDocument()
  })

  it('says when there are no courses yet', async () => {
    renderApp('/courses', { courses: [] })

    expect(await screen.findByText('No courses yet.')).toBeInTheDocument()
  })

  it('creates a course with separate languages and opens it', async () => {
    const { courses, history } = renderApp('/courses')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Course name'), 'Algebra 1.A')
    await user.type(screen.getByLabelText('Subject'), 'Mathematics')
    await user.selectOptions(screen.getByLabelText('Language taught'), 'none')
    await user.selectOptions(screen.getByLabelText('Language of explanations'), 'cs')
    await user.click(screen.getByRole('button', { name: 'Create course' }))

    expect(await screen.findByRole('heading', { name: 'Algebra 1.A' })).toBeInTheDocument()
    expect(courses.create).toHaveBeenCalledWith({
      name: 'Algebra 1.A',
      subject: 'Mathematics',
      taught_language: null,
      instruction_language: 'cs',
    })
    expect(history.get()).toMatch(/^\/courses\/\d+$/)
  })

  it('is closed to students', async () => {
    renderApp('/courses', { signedIn: student })

    expect(await screen.findByRole('alert')).toHaveTextContent('Only teachers can open this page.')
    expect(screen.queryByRole('link', { name: 'Courses' })).not.toBeInTheDocument()
  })
})

describe('course page', () => {
  it('shows the course basics and its brief', async () => {
    renderApp('/courses/1')

    expect(await screen.findByRole('heading', { name: 'Španělština 2.B' })).toBeInTheDocument()
    expect(screen.getByLabelText('Language taught')).toHaveValue('es')
    expect(screen.getByLabelText('Language of explanations')).toHaveValue('cs')
    expect(await briefField('Level')).toHaveValue('A2')
    expect(screen.getByRole('textbox', { name: 'Audience' })).toHaveValue('')
    const preferred = screen.getByRole('group', { name: 'Preferred exercise types' })
    expect(within(preferred).getByRole('checkbox', { name: 'Cloze' })).toBeChecked()
    expect(screen.getByLabelText('Feedback')).toHaveValue('immediate')
  })

  it('changes the language of explanations without touching the language taught', async () => {
    const { courses } = renderApp('/courses/1')
    const user = userEvent.setup()

    await user.selectOptions(await screen.findByLabelText('Language of explanations'), 'es')
    await user.click(screen.getByRole('button', { name: 'Save course' }))

    await screen.findByText('Course saved.')
    expect(courses.change).toHaveBeenCalledWith(1, {
      name: 'Španělština 2.B',
      subject: 'Spanish',
      taught_language: 'es',
      instruction_language: 'es',
    })
  })

  it('saves one brief field on its own', async () => {
    const { courses } = renderApp('/courses/1')
    const user = userEvent.setup()
    const level = await briefField('Level')

    await user.clear(level)
    await user.type(level, 'B1')
    await user.click(screen.getByRole('button', { name: 'Save Level' }))

    expect(await screen.findByText('Level saved.')).toBeInTheDocument()
    expect(courses.changeBrief).toHaveBeenCalledWith(1, { level: 'B1' })
  })

  it('clears a brief field', async () => {
    const { courses } = renderApp('/courses/1')
    const user = userEvent.setup()

    await user.clear(await briefField('Level'))
    await user.click(screen.getByRole('button', { name: 'Save Level' }))

    await screen.findByText('Level saved.')
    expect(courses.changeBrief).toHaveBeenCalledWith(1, { level: null })
  })

  it('keeps a field being typed when another field is saved', async () => {
    renderApp('/courses/1')
    const user = userEvent.setup()

    await user.type(await briefField('Goals'), 'Talk about the past')
    await user.type(screen.getByRole('textbox', { name: 'Tone' }), 'Friendly')
    await user.click(screen.getByRole('button', { name: 'Save Tone' }))

    await screen.findByText('Tone saved.')
    expect(screen.getByRole('textbox', { name: 'Goals' })).toHaveValue('Talk about the past')
  })

  it('chooses preferred and forbidden types from the catalog, never both', async () => {
    const { courses } = renderApp('/courses/1')
    const user = userEvent.setup()
    const preferred = within(await screen.findByRole('group', { name: 'Preferred exercise types' }))
    const forbidden = within(screen.getByRole('group', { name: 'Forbidden exercise types' }))

    await user.click(preferred.getByRole('checkbox', { name: 'Matching' }))
    await user.click(forbidden.getByRole('checkbox', { name: 'Free text' }))

    expect(courses.changeBrief).toHaveBeenCalledWith(1, { preferred_exercise_types: ['cloze', 'matching'] })
    expect(courses.changeBrief).toHaveBeenCalledWith(1, { forbidden_exercise_types: ['free_text'] })
    expect(forbidden.getByRole('checkbox', { name: 'Cloze' })).toBeDisabled()
    expect(preferred.getByRole('checkbox', { name: 'Free text' })).toBeDisabled()
    // Types without a renderer in this phase are not offered.
    expect(preferred.queryByRole('checkbox', { name: 'Listening' })).not.toBeInTheDocument()
    expect(preferred.getAllByRole('checkbox')).toHaveLength(8)
  })

  it('sets the feedback and retry defaults', async () => {
    const { courses } = renderApp('/courses/1')
    const user = userEvent.setup()

    await user.selectOptions(await screen.findByLabelText('Feedback'), 'at_the_end')
    await user.click(screen.getByRole('checkbox', { name: 'Wrong answers come back in a second round' }))

    expect(courses.changeBrief).toHaveBeenCalledWith(1, { feedback_mode: 'at_the_end' })
    expect(courses.changeBrief).toHaveBeenCalledWith(1, { second_round: false })
    expect(screen.getByRole('checkbox', { name: 'Wrong answers come back in a second round' })).not.toBeChecked()
  })

  it('says when a change was not saved and keeps the text', async () => {
    const { courses } = renderApp('/courses/1')
    courses.changeBrief.mockRejectedValueOnce(new ApiError(500))
    const user = userEvent.setup()

    await user.type(await briefField('Audience'), 'Adults')
    await user.click(screen.getByRole('button', { name: 'Save Audience' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The change could not be saved.')
    expect(screen.getByRole('textbox', { name: 'Audience' })).toHaveValue('Adults')
  })

  it('keeps both of two types ticked quickly one after the other', async () => {
    const { courses } = renderApp('/courses/1')
    const save = courses.changeBrief.getMockImplementation()!
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    courses.changeBrief.mockImplementationOnce(async (id, change) => {
      await held
      return save(id, change)
    })
    const user = userEvent.setup()
    const preferred = within(await screen.findByRole('group', { name: 'Preferred exercise types' }))

    await user.click(preferred.getByRole('checkbox', { name: 'Matching' }))
    await user.click(preferred.getByRole('checkbox', { name: 'Translation' }))
    release()

    await waitFor(() => expect(courses.changeBrief).toHaveBeenCalledTimes(2))
    expect(courses.changeBrief).toHaveBeenLastCalledWith(1, {
      preferred_exercise_types: ['cloze', 'matching', 'translation'],
    })
    expect(preferred.getByRole('checkbox', { name: 'Matching' })).toBeChecked()
    expect(preferred.getByRole('checkbox', { name: 'Translation' })).toBeChecked()
  })

  it('puts a control back when its change was not saved', async () => {
    const { courses } = renderApp('/courses/1')
    courses.changeBrief.mockRejectedValue(new ApiError(500))
    const user = userEvent.setup()
    const retry = await screen.findByRole('checkbox', { name: 'One retry with a hint after a wrong answer' })
    const preferred = within(screen.getByRole('group', { name: 'Preferred exercise types' }))

    await user.click(retry)
    await user.click(preferred.getByRole('checkbox', { name: 'Cloze' }))
    await user.selectOptions(screen.getByLabelText('Feedback'), 'at_the_end')

    expect(await screen.findByRole('alert')).toHaveTextContent('The change could not be saved.')
    await waitFor(() => expect(screen.getByLabelText('Feedback')).toHaveValue('immediate'))
    expect(retry).toBeChecked()
    expect(preferred.getByRole('checkbox', { name: 'Cloze' })).toBeChecked()
  })

  it('says when the course cannot be opened', async () => {
    renderApp('/courses/999')

    expect(await screen.findByRole('alert')).toHaveTextContent('The course could not be loaded.')
  })

  it('offers the courses list from the page', async () => {
    const { history } = renderApp('/courses/1', { courses: [spanish] })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'All courses' }))

    expect(history.get()).toBe('/courses')
  })
})
