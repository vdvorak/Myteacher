import { A, useParams } from '@solidjs/router'
import { createResource, createSignal, Show } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import '../admin/admin.css'
import { TeachersOnly } from '../students/StudentsPage'
import type { Course, CourseBasics } from './api'
import { BriefEditor } from './BriefEditor'
import { CourseBasicsForm } from './CourseBasicsForm'
import { TopicsSection } from './TopicsSection'

/** One course: its basics and its brief, each brief field edited on its own. */
export function CoursePage() {
  return (
    <TeachersOnly>
      <CourseDetail />
    </TeachersOnly>
  )
}

function CourseDetail() {
  const { t } = useI18n()
  const api = useApi().courses
  const params = useParams<{ courseId: string }>()
  const [course, { mutate }] = createResource(() => Number(params.courseId), (id) => api.get(id))
  const [outcome, setOutcome] = createSignal<'saved' | 'failed' | null>(null)
  const loaded = () => (course.error ? undefined : course())

  const save = (current: Course) => async (basics: CourseBasics) => {
    setOutcome(null)
    try {
      mutate(await api.change(current.id, basics))
      setOutcome('saved')
    } catch {
      setOutcome('failed')
    }
  }

  return (
    <section class="admin-section">
      <A href="/courses">{t('courses.all')}</A>
      <Show when={course.error}>
        <p role="alert">{t('courses.courseLoadFailed')}</p>
      </Show>
      {/* Keyed by id, so the forms are filled once per course and never overwrite typing. */}
      <Show when={loaded()?.id} keyed>
        {(id) => (
          <>
            <h1>{loaded()?.name}</h1>
            <CourseBasicsForm initial={loaded()} submitLabel={t('courses.save')} onSubmit={save(loaded()!)} />
            <Show when={outcome()}>
              {(current) =>
                current() === 'saved' ? (
                  <p role="status">{t('courses.saved')}</p>
                ) : (
                  <p role="alert">{t('courses.saveFailed')}</p>
                )
              }
            </Show>
            <BriefEditor
              initial={loaded()!.brief}
              save={(change) => api.changeBrief(id, change)}
              onSaved={(brief) => mutate((current) => current && { ...current, brief })}
            />
            <TopicsSection courseId={id} canEdit={loaded()!.can_edit} />
          </>
        )}
      </Show>
    </section>
  )
}
