import { A, useNavigate } from '@solidjs/router'
import { createResource, createSignal, For, Show } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import '../admin/admin.css'
import { TeachersOnly } from '../students/StudentsPage'
import type { CourseBasics } from './api'
import { accessNames } from './AccessDialog'
import { CourseBasicsForm } from './CourseBasicsForm'

/** The teacher's own courses and those shared with them, and the form to create one. */
export function CoursesPage() {
  return (
    <TeachersOnly>
      <CoursesList />
    </TeachersOnly>
  )
}

function CoursesList() {
  const { t } = useI18n()
  const api = useApi().courses
  const navigate = useNavigate()
  const [courses] = createResource(() => api.list())
  const [failed, setFailed] = createSignal(false)

  async function create(basics: CourseBasics) {
    setFailed(false)
    try {
      const created = await api.create(basics)
      navigate(`/courses/${created.id}`)
    } catch {
      setFailed(true)
    }
  }

  return (
    <section class="admin-section" aria-labelledby="courses-heading">
      <h1 id="courses-heading">{t('courses.heading')}</h1>
      <Show when={courses.error}>
        <p role="alert">{t('courses.loadFailed')}</p>
      </Show>
      <Show when={!courses.error && courses()}>
        {(list) => (
          <Show when={list().length > 0} fallback={<p>{t('courses.none')}</p>}>
            <div class="table-scroll">
              <table class="admin-table">
                <thead>
                  <tr>
                    <th scope="col">{t('courses.name')}</th>
                    <th scope="col">{t('courses.subject')}</th>
                    <th scope="col">{t('access.yours')}</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={list()}>
                    {(course) => (
                      <tr>
                        <td>
                          <A href={`/courses/${course.id}`}>{course.name}</A>
                        </td>
                        <td>{course.subject}</td>
                        <td>{t(accessNames[course.access])}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        )}
      </Show>
      <h2>{t('courses.new')}</h2>
      <CourseBasicsForm submitLabel={t('courses.create')} onSubmit={create} />
      <Show when={failed()}>
        <p role="alert">{t('smtp.requestFailed')}</p>
      </Show>
    </section>
  )
}
