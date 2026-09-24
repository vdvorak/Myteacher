import { createMemoryHistory } from '@solidjs/router'
import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { fakeAuthApi, invitedTeacher } from '../auth/testing'
import { ApiError } from '../lesson/api'
import { withI18n } from '../lesson/testing'
import type { Course, Topic } from './api'
import { fakeCoursesApi, spanish } from './testing'

const teacher: Account = { ...invitedTeacher, language: 'en' }
const topics: Topic[] = [
  { id: 1, name: 'Presente', position: 0, diagnostic_wanted: true },
  { id: 2, name: 'Pretérito indefinido', position: 1, diagnostic_wanted: false },
  { id: 3, name: 'Imperfecto', position: 2, diagnostic_wanted: false },
]

function renderCourse(course: Course = spanish) {
  const history = createMemoryHistory()
  history.set({ value: `/courses/${course.id}` })
  const courses = fakeCoursesApi({ courses: [course], topics: { [course.id]: topics } })
  const apis = fakeApis({ auth: fakeAuthApi({ signedIn: teacher }), courses })
  render(withI18n(() => <App apis={apis} history={history} />, 'en'))
  return { courses }
}

const topicList = async () => within(await screen.findByRole('list', { name: 'Topics' }))
const shownNames = async () =>
  (await topicList()).getAllByRole('listitem').map((item) => (within(item).getByRole('textbox') as HTMLInputElement).value)
const item = async (name: string) =>
  (await topicList()).getAllByRole('listitem').find((li) => within(li).queryByDisplayValue(name))!

describe('topics of a course', () => {
  it('lists the topics in the course order', async () => {
    renderCourse()

    expect(await shownNames()).toEqual(['Presente', 'Pretérito indefinido', 'Imperfecto'])
    expect(within(await item('Presente')).getByRole('checkbox', { name: 'Diagnostic lesson wanted' })).toBeChecked()
  })

  it('adds a topic at the end', async () => {
    const { courses } = renderCourse()
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('New topic'), 'Futuro')
    await user.click(screen.getByRole('button', { name: 'Add topic' }))

    await screen.findByDisplayValue('Futuro')
    expect(courses.addTopic).toHaveBeenCalledWith(1, 'Futuro')
    expect((await shownNames()).at(-1)).toBe('Futuro')
    expect(screen.getByLabelText('New topic')).toHaveValue('')
  })

  it('asks for a name instead of sending one of spaces', async () => {
    const { courses } = renderCourse()
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('New topic'), '   ')
    await user.click(screen.getByRole('button', { name: 'Add topic' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A topic needs a name.')

    const row = within(await item('Imperfecto'))
    await user.clear(row.getByRole('textbox'))
    await user.type(row.getByRole('textbox'), '  ')
    await user.click(row.getByRole('button', { name: 'Rename' }))

    expect(screen.getByRole('alert')).toHaveTextContent('A topic needs a name.')
    expect(courses.addTopic).not.toHaveBeenCalled()
    expect(courses.changeTopic).not.toHaveBeenCalled()
  })

  it('renames a topic', async () => {
    const { courses } = renderCourse()
    const user = userEvent.setup()
    const row = within(await item('Imperfecto'))

    await user.clear(row.getByRole('textbox'))
    await user.type(row.getByRole('textbox'), 'Pretérito imperfecto')
    await user.click(row.getByRole('button', { name: 'Rename' }))

    expect(courses.changeTopic).toHaveBeenCalledWith(1, 3, { name: 'Pretérito imperfecto' })
    expect(await shownNames()).toEqual(['Presente', 'Pretérito indefinido', 'Pretérito imperfecto'])
  })

  it('moves a topic up and down', async () => {
    const { courses } = renderCourse()
    const user = userEvent.setup()

    await user.click(within(await item('Imperfecto')).getByRole('button', { name: 'Move up' }))
    expect(courses.reorderTopics).toHaveBeenLastCalledWith(1, [1, 3, 2])
    await screen.findByDisplayValue('Imperfecto')
    expect(await shownNames()).toEqual(['Presente', 'Imperfecto', 'Pretérito indefinido'])

    await user.click(within(await item('Presente')).getByRole('button', { name: 'Move down' }))
    expect(courses.reorderTopics).toHaveBeenLastCalledWith(1, [3, 1, 2])
  })

  it('cannot move the first topic up or the last one down', async () => {
    renderCourse()

    expect(within(await item('Presente')).getByRole('button', { name: 'Move up' })).toBeDisabled()
    expect(within(await item('Imperfecto')).getByRole('button', { name: 'Move down' })).toBeDisabled()
  })

  it('sets whether a diagnostic lesson is wanted', async () => {
    const { courses } = renderCourse()
    const user = userEvent.setup()

    await user.click(within(await item('Imperfecto')).getByRole('checkbox', { name: 'Diagnostic lesson wanted' }))

    expect(courses.changeTopic).toHaveBeenCalledWith(1, 3, { diagnostic_wanted: true })
  })

  it('puts the diagnostic box back when the change was not saved', async () => {
    const { courses } = renderCourse()
    courses.changeTopic.mockRejectedValueOnce(new ApiError(500))
    const user = userEvent.setup()
    const box = within(await item('Imperfecto')).getByRole('checkbox', { name: 'Diagnostic lesson wanted' })

    await user.click(box)

    expect(await screen.findByRole('alert')).toHaveTextContent('The change could not be saved.')
    expect(box).not.toBeChecked()
  })

  it('removes a topic after confirming', async () => {
    const { courses } = renderCourse()
    const user = userEvent.setup()

    await user.click(within(await item('Presente')).getByRole('button', { name: 'Remove' }))
    expect(courses.removeTopic).not.toHaveBeenCalled()
    await user.click(within(await item('Presente')).getByRole('button', { name: 'Remove Presente for good' }))

    expect(courses.removeTopic).toHaveBeenCalledWith(1, 1)
    await screen.findByRole('list', { name: 'Topics' })
    expect(await shownNames()).toEqual(['Pretérito indefinido', 'Imperfecto'])
  })

  it('reloads the topics when someone else changed them meanwhile', async () => {
    const { courses } = renderCourse()
    courses.reorderTopics.mockRejectedValueOnce(new ApiError(409))
    const user = userEvent.setup()

    await user.click(within(await item('Imperfecto')).getByRole('button', { name: 'Move up' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The topics changed meanwhile and were reloaded.')
    expect(courses.topics).toHaveBeenCalledTimes(2)
  })

  it('shows the topics read-only to a teacher who may only view the course', async () => {
    renderCourse({ ...spanish, can_edit: false })

    const list = await screen.findByRole('list', { name: 'Topics' })
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Presente (diagnostic lesson wanted)',
      'Pretérito indefinido',
      'Imperfecto',
    ])
    expect(within(list).queryByRole('button')).not.toBeInTheDocument()
    expect(within(list).queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('New topic')).not.toBeInTheDocument()
  })
})
