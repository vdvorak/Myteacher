import { useNavigate, useParams } from '@solidjs/router'
import { createResource, createSignal, Show } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import '../admin/admin.css'
import { useBreadcrumbs } from '../shell/breadcrumbs'
import { PageHeader } from '../shell/PageHeader'
import { TeachersOnly } from '../students/StudentsPage'
import { AccessDialog } from './AccessDialog'
import type { Course, CourseBasics, CourseRight } from './api'
import { BriefEditor } from './BriefEditor'
import { CourseBasicsForm } from './CourseBasicsForm'
import { CourseInterviewPanel } from './InterviewPanel'
import { RunsSection } from '../runs/RunsSection'
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

  const [forking, setForking] = createSignal(false)
  const [forkFailed, setForkFailed] = createSignal(false)

  async function forkCourse(id: number) {
    setForking(true)
    setForkFailed(false)
    try {
      const copy = await api.fork(id)
      navigate(`/courses/${copy.id}`)
    } catch {
      setForkFailed(true)
    } finally {
      setForking(false)
    }
  }

  useBreadcrumbs(() => [{ label: t('nav.courses'), href: '/courses' }, { label: loaded()?.name ?? '' }])

  return (
    <section class="admin-section">
      <Show when={course.error}>
        <p role="alert">{t('courses.courseLoadFailed')}</p>
      </Show>
      {/* Keyed by id, so the forms are filled once per course and never overwrite typing. */}
      <Show when={loaded()?.id} keyed>
        {(id) => (
          <>
            <PageHeader
              title={loaded()?.name}
              meta={loaded()?.subject}
              more={
                <>
                  <Show when={loaded()!.can_fork}>
                    <button type="button" disabled={forking()} onClick={() => void forkCourse(id)}>
                      {t('courses.fork')}
                    </button>
                  </Show>
                  {/* The browser saves the archive the server names; anyone who may view the course may export it. */}
                  <a href={`/api/courses/${id}/export`} download="">
                    {t('courses.export')}
                  </a>
                  <p class="settings-note">{t('courses.exportNote')}</p>
                </>
              }
            />
            <Show when={!loaded()!.can_edit}>
              <p class="settings-note">{t('courses.readOnly')}</p>
            </Show>
            <Show when={loaded()!.forked_from_id !== null}>
              <p class="settings-note">{t('courses.forkNote')}</p>
            </Show>
            <Show when={forkFailed()}>
              <p role="alert">{t('courses.forkFailed')}</p>
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
            <RunsSection courseId={id} canEdit={loaded()!.can_edit} />
            <TopicsSection courseId={id} canEdit={loaded()!.can_edit} />
            <SourcesSection courseId={id} canEdit={loaded()!.can_edit} />
          </>
        )}
      </Show>
    </section>
  )
}
