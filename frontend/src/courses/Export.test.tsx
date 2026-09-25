import { createMemoryHistory } from '@solidjs/router'
import { render, screen } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { fakeAuthApi, invitedTeacher } from '../auth/testing'
import { withI18n } from '../lesson/testing'
import type { Course } from './api'
import { fakeCoursesApi, spanish } from './testing'

const teacher: Account = { ...invitedTeacher, language: 'en' }

function renderCourse(course: Course) {
  const history = createMemoryHistory()
  history.set({ value: `/courses/${course.id}` })
  const apis = fakeApis({ auth: fakeAuthApi({ signedIn: teacher }), courses: fakeCoursesApi({ courses: [course] }) })
  render(withI18n(() => <App apis={apis} history={history} />, 'en'))
}

describe('exporting a course', () => {
  it('downloads the course archive', async () => {
    renderCourse(spanish)

    const link = await screen.findByRole('link', { name: 'Export the course' })
    expect(link).toHaveAttribute('href', '/api/courses/1/export')
    expect(link).toHaveAttribute('download')
  })

  it('is open to a teacher who may only view the course', async () => {
    renderCourse({ ...spanish, access: 'view', can_edit: false, can_manage_access: false })

    expect(await screen.findByRole('link', { name: 'Export the course' })).toBeInTheDocument()
  })
})
