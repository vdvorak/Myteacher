import { createMemoryHistory } from '@solidjs/router'
import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { fakeAuthApi, invitedTeacher } from '../auth/testing'
import { withI18n } from '../lesson/testing'
import type { Course } from './api'
import { fakeCoursesApi, spanish } from './testing'

const teacher: Account = { ...invitedTeacher, language: 'en' }
const forkable: Course = { ...spanish, access: 'fork', can_edit: false, can_manage_access: false, can_fork: true }

function renderCourse(course: Course) {
  const history = createMemoryHistory()
  history.set({ value: `/courses/${course.id}` })
  const courses = fakeCoursesApi({ courses: [course] })
  const apis = fakeApis({ auth: fakeAuthApi({ signedIn: teacher }), courses })
  render(withI18n(() => <App apis={apis} history={history} />, 'en'))
  return { courses, history }
}

describe('forking a course', () => {
  it('makes the teacher their own copy and opens it', async () => {
    const { courses, history } = renderCourse(forkable)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('button', { name: 'Make my own copy' }))

    expect(courses.fork).toHaveBeenCalledWith(1)
    expect(await screen.findByRole('heading', { level: 1, name: `${forkable.name} (copy)` })).toBeInTheDocument()
    expect(await screen.findByText('This course is a copy of another course. It does not follow changes to it.')).toBeInTheDocument()
    expect(history.get()).toMatch(/^\/courses\/\d+$/)
    expect(history.get()).not.toBe('/courses/1')
    expect(screen.queryByText('You can view this course but not change it.')).not.toBeInTheDocument()
  })

  it('is not offered without the fork right', async () => {
    renderCourse({ ...forkable, access: 'view', can_fork: false })

    await userEvent.setup().click(await screen.findByRole('button', { name: 'More actions' }))
    expect(screen.queryByRole('button', { name: 'Make my own copy' })).not.toBeInTheDocument()
  })

  it('says when the copy could not be made', async () => {
    const { courses } = renderCourse(forkable)
    courses.fork.mockRejectedValueOnce(new Error('offline'))
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('button', { name: 'Make my own copy' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The copy could not be made. Try again.')
  })
})
