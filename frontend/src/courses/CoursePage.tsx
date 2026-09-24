import { A, useNavigate, useParams } from '@solidjs/router'
import { createResource, createSignal, Show } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import '../admin/admin.css'
import { TeachersOnly } from '../students/StudentsPage'
import { AccessDialog } from './AccessDialog'
import type { Course, CourseBasics, CourseRight } from './api'
import { BriefEditor } from './BriefEditor'
import { CourseBasicsForm } from './CourseBasicsForm'
import { CourseInterviewPanel } from './InterviewPanel'
import { SourcesSection } from '../sources/SourcesSection'
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
  const navigate = useNavigate()
  const [course, { mutate }] = createResource(() => Number(params.courseId), (id) => api.get(id))
  const [outcome, setOutcome] = createSignal<'saved' | 'failed' | null>(null)
  // Bumped when the brief changed elsewhere (the interview), so its editor starts afresh.
  const [briefRevision, setBriefRevision] = createSignal(0)
  const [sharing, setSharing] = createSignal(false)
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

  async function briefChanged(id: number) {
    try {
      mutate(await api.get(id))
      setBriefRevision((n) => n + 1)
    } catch {
      setOutcome('failed')
    }
  }

  async function transferred(id: number, kept: CourseRight | null) {
    setSharing(false)
    // With no right left, the course is gone for this teacher.
    if (kept !== null) {
      try {
        mutate(await api.get(id))
        return
      } catch {
        // Fall through to the list.
      }
    }
    navigate('/courses')
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
            <Show when={!loaded()!.can_edit}>
              <p class="settings-note">{t('courses.readOnly')}</p>
            </Show>
            <Show when={loaded()!.can_manage_access}>
              <Show
                when={sharing()}
                fallback={
                  <div class="settings-actions">
                    <button type="button" onClick={() => setSharing(true)}>
                      {t('access.share')}
                    </button>
                  </div>
                }
              >
                <AccessDialog
                  courseId={id}
                  onClose={() => setSharing(false)}
                  onTransferred={(kept) => void transferred(id, kept)}
                />
              </Show>
            </Show>
            {/* Keyed by the right too, so a form becomes read-only or editable as the right changes. */}
            <Show when={String(loaded()!.can_edit)} keyed>
              {(_editable) => (
                <CourseBasicsForm
                  initial={loaded()}
                  readOnly={!loaded()!.can_edit}
                  submitLabel={t('courses.save')}
                  onSubmit={save(loaded()!)}
                />
              )}
            </Show>
            <Show when={outcome()}>
              {(current) =>
                current() === 'saved' ? (
                  <p role="status">{t('courses.saved')}</p>
                ) : (
                  <p role="alert">{t('courses.saveFailed')}</p>
                )
              }
            </Show>
            <Show when={loaded()!.can_edit}>
              <CourseInterviewPanel courseId={id} onBriefChanged={() => briefChanged(id)} />
            </Show>
            <Show when={`${briefRevision()}-${loaded()!.can_edit}`} keyed>
              {(_revision) => (
                <BriefEditor
                  initial={loaded()!.brief}
                  readOnly={!loaded()!.can_edit}
                  save={(change) => api.changeBrief(id, change)}
                  onSaved={(brief) => mutate((current) => current && { ...current, brief })}
                />
              )}
            </Show>
            <TopicsSection courseId={id} canEdit={loaded()!.can_edit} />
            <SourcesSection courseId={id} canEdit={loaded()!.can_edit} />
          </>
        )}
      </Show>
    </section>
  )
}
