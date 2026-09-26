import { A, useNavigate, useParams, useSearchParams } from '@solidjs/router'
import { createEffect, createResource, createSignal, Match, Show, Switch } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import '../admin/admin.css'
import { RunsSection } from '../runs/RunsSection'
import { useBreadcrumbs } from '../shell/breadcrumbs'
import { PageHeader } from '../shell/PageHeader'
import { NextStep, StepTabs, type StepState, type Tab } from '../shell/StepTabs'
import { SourcesSection } from '../sources/SourcesSection'
import { TeachersOnly } from '../students/StudentsPage'
import { AccessDialog } from './AccessDialog'
import type { Course, CourseBasics, CourseChange, CourseRight, Topic } from './api'
import { BriefEditor } from './BriefEditor'
import { CourseBasicsForm } from './CourseBasicsForm'
import { CourseInterviewPanel } from './InterviewPanel'
import { TopicsSection } from './TopicsSection'

type TabId = 'brief' | 'sources' | 'topics' | 'runs' | 'access'
const tabIds: TabId[] = ['brief', 'sources', 'topics', 'runs', 'access']

/** One course as numbered steps: brief, sources, topics; then its runs and who may use it. */
export function CoursePage() {
  return (
    <TeachersOnly>
      <CourseDetail />
    </TeachersOnly>
  )
}

/** Where the course's preparation stands, read from what the course holds. */
function progressOf(course: Course, topics: Topic[]) {
  const briefDone = course.setup.interview_finished || course.setup.brief_confirmed
  const sourcesDone = course.setup.read_sources > 0 || course.setup.sources_skipped
  const ready = topics.filter((topic) => topic.materials > 0).length
  const done = { brief: briefDone, sources: sourcesDone, topics: ready > 0 }
  const next = (['brief', 'sources', 'topics'] as const).find((step) => !done[step])
  return { done, next, ready }
}

function CourseDetail() {
  const { t } = useI18n()
  const apis = useApi()
  const api = apis.courses
  const params = useParams<{ courseId: string }>()
  const [search] = useSearchParams<{ tab?: string }>()
  const navigate = useNavigate()
  const courseId = () => Number(params.courseId)
  const [course, { mutate }] = createResource(courseId, (id) => api.get(id))
  const [topics, { mutate: setTopics }] = createResource(courseId, (id) => api.topics(id))
  // Starting a run opens it, so the list is read once per visit.
  const [runs] = createResource(courseId, (id) => apis.runs.list(id))
  const [outcome, setOutcome] = createSignal<'saved' | 'failed' | null>(null)
  const [editingBasics, setEditingBasics] = createSignal(false)
  // Bumped when the brief changed elsewhere (the interview), so its editor starts afresh.
  const [briefRevision, setBriefRevision] = createSignal(0)
  const loaded = () => (course.error ? undefined : course())
  const topicList = () => (topics.error ? [] : (topics() ?? []))
  const progress = () => progressOf(loaded()!, topicList())

  useBreadcrumbs(() => [{ label: t('nav.courses'), href: '/courses' }, { label: loaded()?.name ?? '…' }])

  const hasTab = (id: TabId) => id !== 'access' || loaded()?.can_manage_access === true
  // The step to do when the course opened; the page stays there as steps get done.
  const [landed, setLanded] = createSignal<{ course: number; tab: TabId }>()
  createEffect(() => {
    const ready = loaded() && (topics.state === 'ready' || topics.error)
    if (ready && landed()?.course !== courseId()) {
      setLanded({ course: courseId(), tab: progress().next ?? 'topics' })
    }
  })
  /** The tab in the address, or else the step that was next when the course opened. */
  const current = (): TabId => {
    const asked = tabIds.find((id) => id === search.tab)
    if (asked && hasTab(asked)) return asked
    const opened = landed()
    return opened?.course === courseId() ? opened.tab : (progress().next ?? 'topics')
  }
  const href = (id: string) => `/courses/${courseId()}?tab=${id}`

  const stepState = (step: 'brief' | 'sources' | 'topics'): StepState =>
    progress().done[step] ? 'done' : progress().next === step ? 'next' : 'open'
  const tabs = (): Tab[] => [
    { id: 'brief', label: t('courseTabs.brief'), step: { number: 1, state: stepState('brief') } },
    { id: 'sources', label: t('courseTabs.sources'), step: { number: 2, state: stepState('sources') } },
    {
      id: 'topics',
      label: t('courseTabs.topics'),
      step: {
        number: 3,
        state: stepState('topics'),
        note:
          topicList().length > 0 ? t('courseTabs.topicsReady', { ready: progress().ready, all: topicList().length }) : undefined,
      },
    },
    { id: 'runs', label: t('courseTabs.runs') },
    ...(hasTab('access') ? [{ id: 'access', label: t('courseTabs.access') }] : []),
  ]

  /** One sentence on what to do next, and the button that leads there. */
  const suggestion = (): { sentence: string; action: { label: string; href: string } } | undefined => {
    const { next } = progress()
    if (next === 'brief') return { sentence: t('nextStep.brief'), action: { label: t('nextStep.openBrief'), href: href('brief') } }
    if (next === 'sources') {
      return { sentence: t('nextStep.sources'), action: { label: t('nextStep.openSources'), href: href('sources') } }
    }
    const list = topicList()
    if (list.length === 0) return { sentence: t('nextStep.topics'), action: { label: t('nextStep.openTopics'), href: href('topics') } }
    if (next === 'topics') {
      const topicHref = (topic: Topic, tab: string) => `/courses/${courseId()}/topics/${topic.id}?tab=${tab}`
      const unapproved = list.find((topic) => topic.concept_map !== 'approved')
      const approved = list.find((topic) => topic.concept_map === 'approved')
      if (approved) {
        return {
          sentence: t('nextStep.material', { topic: approved.name }),
          action: { label: t('nextStep.openTopic'), href: topicHref(approved, 'materials') },
        }
      }
      if (unapproved && unapproved.concept_map === 'draft') {
        return {
          sentence: t('nextStep.approveMap', { topic: unapproved.name }),
          action: { label: t('nextStep.openTopic'), href: topicHref(unapproved, 'map') },
        }
      }
      return { sentence: t('nextStep.prepare'), action: { label: t('nextStep.openTopics'), href: href('topics') } }
    }
    if (!runs.error && runs()?.length === 0) {
      return { sentence: t('nextStep.run'), action: { label: t('courses.startRun'), href: href('runs') } }
    }
    return undefined
  }

  async function change(current: Course, update: CourseChange) {
    setOutcome(null)
    try {
      mutate(await api.change(current.id, update))
      return true
    } catch {
      setOutcome('failed')
      return false
    }
  }

  const save = (current: Course) => async (basics: CourseBasics) => {
    if (await change(current, basics)) {
      setOutcome('saved')
      setEditingBasics(false)
    }
  }

  async function reloadCourse() {
    try {
      mutate(await api.get(courseId()))
    } catch {
      // The steps keep what they showed.
    }
  }

  async function briefChanged() {
    await reloadCourse()
    setBriefRevision((n) => n + 1)
  }

  async function transferred(id: number, kept: CourseRight | null) {
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
              action={
                <Show when={loaded()!.can_edit}>
                  <A class="button-link" href={href('runs')}>
                    {t('courses.startRun')}
                  </A>
                </Show>
              }
              more={
                <>
                  <Show when={loaded()!.can_edit}>
                    <button type="button" onClick={() => setEditingBasics(true)}>
                      {t('courses.editBasics')}
                    </button>
                  </Show>
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
            <Show when={editingBasics()}>
              <section class="settings-form panel" aria-labelledby="basics-heading">
                <h2 id="basics-heading">{t('courses.basicsHeading')}</h2>
                <CourseBasicsForm initial={loaded()} submitLabel={t('courses.save')} onSubmit={save(loaded()!)} />
                <div class="settings-actions">
                  <button type="button" class="button-secondary" onClick={() => setEditingBasics(false)}>
                    {t('courses.closeBasics')}
                  </button>
                </div>
              </section>
            </Show>
            <Show when={outcome()}>
              {(result) =>
                result() === 'saved' ? (
                  <p role="status">{t('courses.saved')}</p>
                ) : (
                  <p role="alert">{t('courses.saveFailed')}</p>
                )
              }
            </Show>
            <StepTabs label={t('courseTabs.label')} tabs={tabs()} current={current()} href={href} />
            <NextStep sentence={suggestion()?.sentence} action={suggestion()?.action} here={href(current())} />
            <Switch>
              <Match when={current() === 'brief'}>
                <div class="admin-section">
                  <Show when={loaded()!.can_edit}>
                    <p class="settings-note">{t('courses.briefNote')}</p>
                    <p>
                      <A class="button-link" href={href('topics')}>
                        {t('emptyState.toTopics')}
                      </A>
                    </p>
                    <CourseInterviewPanel courseId={id} onBriefChanged={() => void briefChanged()} />
                  </Show>
                  <Show when={`${briefRevision()}-${loaded()!.can_edit}`} keyed>
                    {(_revision) => (
                      <BriefEditor
                        initial={loaded()!.brief}
                        readOnly={!loaded()!.can_edit}
                        save={(brief) => api.changeBrief(id, brief)}
                        onSaved={(brief) => mutate((previous) => previous && { ...previous, brief })}
                      />
                    )}
                  </Show>
                  <Show when={loaded()!.can_edit && !progress().done.brief}>
                    <div class="settings-actions">
                      <button type="button" onClick={() => void change(loaded()!, { brief_confirmed: true })}>
                        {t('courses.briefDone')}
                      </button>
                    </div>
                    <p class="settings-note">{t('courses.briefDoneNote')}</p>
                  </Show>
                </div>
              </Match>
              <Match when={current() === 'sources'}>
                <SourcesSection courseId={id} canEdit={loaded()!.can_edit} onChanged={() => void reloadCourse()} />
                <Show when={loaded()!.can_edit && loaded()!.setup.read_sources === 0}>
                  <Show
                    when={loaded()!.setup.sources_skipped}
                    fallback={
                      <div class="settings-actions">
                        <button
                          type="button"
                          class="button-secondary"
                          onClick={() => void change(loaded()!, { sources_skipped: true })}
                        >
                          {t('courses.skipSources')}
                        </button>
                      </div>
                    }
                  >
                    <p class="settings-note">{t('courses.sourcesSkipped')}</p>
                    <div class="settings-actions">
                      <button
                        type="button"
                        class="button-secondary"
                        onClick={() => void change(loaded()!, { sources_skipped: false })}
                      >
                        {t('courses.useSources')}
                      </button>
                    </div>
                  </Show>
                </Show>
              </Match>
              <Match when={current() === 'topics'}>
                <TopicsSection courseId={id} canEdit={loaded()!.can_edit} onChanged={setTopics} />
              </Match>
              <Match when={current() === 'runs'}>
                <RunsSection courseId={id} canEdit={loaded()!.can_edit} />
              </Match>
              <Match when={current() === 'access'}>
                <AccessDialog courseId={id} onTransferred={(kept) => void transferred(id, kept)} />
              </Match>
            </Switch>
          </>
        )}
      </Show>
    </section>
  )
}
