import { A } from '@solidjs/router'
import { createResource, createSignal, For, Match, Show, Switch } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import type { MessageKey } from '../i18n/messages'
import { PageHeader } from '../shell/PageHeader'
import type { AttentionItem, Checklist } from './api'
import './home.css'
import { TurnTestDialog } from './TurnTestDialog'

/** The teacher's home: what to do now. */
export function TeacherHome() {
  const { t } = useI18n()
  const api = useApi().home
  const [home] = createResource(() => api.get())
  const found = () => (home.error ? undefined : home())
  const [turningTest, setTurningTest] = createSignal(false)

  return (
    <div class="home">
      <PageHeader
        title={t('nav.home')}
        action={
          <button type="button" onClick={() => setTurningTest(true)}>
            {t('turnTest.title')}
          </button>
        }
      />
      <Show when={turningTest()}>
        <TurnTestDialog onClose={() => setTurningTest(false)} />
      </Show>
      <Show when={home.error}>
        <p role="alert">{t('home.loadFailed')}</p>
      </Show>
      <Show when={found()}>
        {(loaded) => (
          <>
            <Show when={loaded().instance}>
              {(instance) => (
                <section class="home-card" aria-labelledby="home-instance">
                  <h2 id="home-instance">{t('home.instance')}</h2>
                  <ol class="checklist">
                    <CheckItem number={1} label={t('home.setUpEmail')} done={instance().smtp} href="/admin" />
                    <CheckItem number={2} label={t('home.inviteTeacher')} done={instance().teacher_invited} href="/admin" />
                  </ol>
                </section>
              )}
            </Show>
            <Show when={loaded().checklist}>{(checklist) => <GettingStarted checklist={checklist()} />}</Show>
            <Attention items={loaded().attention} />
          </>
        )}
      </Show>
      <MyRuns />
      <Show when={found()?.courses.length}>
        <section class="home-card" aria-labelledby="home-preparing">
          <h2 id="home-preparing">{t('home.preparing')}</h2>
          <ul class="home-list">
            <For each={found()!.courses}>
              {(course) => (
                <li>
                  <A href={`/courses/${course.id}`}>{course.name}</A>
                  <span class="settings-note">
                    {[
                      t(course.brief ? 'home.briefDone' : 'home.briefOpen'),
                      t(course.sources ? 'home.sourcesDone' : 'home.sourcesOpen'),
                      t('home.topicsReady', { ready: course.topics_ready, all: course.topics }),
                    ].join(' · ')}
                  </span>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
    </div>
  )
}

/** One step: its number or a tick, and a link to where it is done. */
function CheckItem(props: { number: number; label: string; done: boolean; href: string; note?: string }) {
  const { t } = useI18n()
  return (
    <li>
      <A href={props.href} class="checklist-item" data-state={props.done ? 'done' : 'open'}>
        <span class="step-mark" aria-hidden="true">
          {props.done ? '✓' : props.number}
        </span>
        <span>{props.label}</span>
        <span class="visually-hidden">, {t(props.done ? 'home.stepDone' : 'home.stepOpen')}</span>
      </A>
      <Show when={props.note}>
        <span class="step-note">{props.note}</span>
      </Show>
    </li>
  )
}

function GettingStarted(props: { checklist: Checklist }) {
  const { t } = useI18n()
  const course = (tab: string) => (props.checklist.course_id === null ? '/courses' : `/courses/${props.checklist.course_id}?tab=${tab}`)
  // A topic's step leads to its tab, or before there is a topic to the course's topics.
  const topic = (tab: string) =>
    props.checklist.topic_id === null
      ? course('topics')
      : `/courses/${props.checklist.course_id}/topics/${props.checklist.topic_id}?tab=${tab}`
  const steps = (): { key: MessageKey; done: boolean; href: string; note?: string }[] => [
    { key: 'home.step.assistant', done: props.checklist.assistant, href: '/settings' },
    { key: 'home.step.course', done: props.checklist.course, href: course('brief') },
    { key: 'home.step.sources', done: props.checklist.sources, href: course('sources') },
    { key: 'home.step.conceptMap', done: props.checklist.concept_map, href: topic('map') },
    { key: 'home.step.material', done: props.checklist.material, href: topic('materials') },
    { key: 'home.step.students', done: props.checklist.students, href: '/classes' },
    {
      key: 'home.step.release',
      done: false,
      href: props.checklist.run_id === null ? course('runs') : `/runs/${props.checklist.run_id}`,
      note: props.checklist.run ? t('home.runStarted') : undefined,
    },
  ]
  // The last step is never done here: the release ends the checklist.
  const done = () => steps().filter((step) => step.done).length

  return (
    <section class="home-card" aria-labelledby="home-getting-started">
      <div class="step-heading">
        <h2 id="home-getting-started">{t('home.gettingStarted')}</h2>
        <span class="settings-note">{t('home.progress', { done: done(), all: steps().length })}</span>
      </div>
      <ol class="checklist">
        <For each={steps()}>
          {(step, index) => (
            <CheckItem number={index() + 1} label={t(step.key)} done={step.done} href={step.href} note={step.note} />
          )}
        </For>
      </ol>
    </section>
  )
}

function Attention(props: { items: AttentionItem[] }) {
  const { t, locale } = useI18n()
  const due = (at: string) => new Date(at).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })
  const release = (item: AttentionItem) => `/runs/${item.run_id}/releases/${item.release_id}`

  return (
    <section class="home-card" aria-labelledby="home-attention">
      <h2 id="home-attention">{t('home.attention')}</h2>
      <Show when={props.items.length > 0} fallback={<p class="settings-note">{t('home.nothingNeedsAttention')}</p>}>
        <ul class="home-list">
          <For each={props.items}>
            {(item) => (
              <li>
                <Switch>
                  <Match when={item.kind === 'open_answers'}>
                    <A href={release(item)}>{t('home.openAnswers', { title: item.title ?? '', count: item.count })}</A>
                  </Match>
                  <Match when={item.kind === 'drafts'}>
                    <A href={`/courses/${item.course_id}/topics/${item.topic_id}?tab=${item.tab}`}>
                      {t(item.tab === 'documents' ? 'home.draftDocuments' : 'home.draftMaterials', {
                        title: item.title ?? '',
                        count: item.count,
                      })}
                    </A>
                  </Match>
                  <Match when={item.kind === 'awaiting_consent'}>
                    <A href="/students">{t('home.awaitingConsent', { count: item.count })}</A>
                  </Match>
                  <Match when={item.kind === 'due_soon'}>
                    <A href={release(item)}>{t('home.dueSoon', { title: item.title ?? '', date: due(item.due_at!) })}</A>{' '}
                    <span class="badge" data-tone="attention">
                      {t('home.submitted', { submitted: item.submitted ?? 0, total: item.total ?? 0 })}
                    </span>
                  </Match>
                </Switch>
                <Show when={item.course_name}>
                  <span class="settings-note">{item.course_name}</span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  )
}

/** The latest release of every run the teacher teaches, with how many submitted. */
function MyRuns() {
  const { t } = useI18n()
  const api = useApi().runs
  const [runs] = createResource(() => api.taught())
  return (
    <section class="home-card" aria-labelledby="home-runs">
      <h2 id="home-runs">{t('home.myRuns')}</h2>
      <Show when={runs.error}>
        <p role="alert">{t('runsPage.loadFailed')}</p>
      </Show>
      <Show when={!runs.error && runs()}>
        {(list) => (
          <Show
            when={list().length > 0}
            fallback={
              <>
                <p class="settings-note">{t('runsPage.none')}</p>
                <p>
                  <A class="button-link" href="/courses">
                    {t('runsPage.toCourses')}
                  </A>
                </p>
              </>
            }
          >
            <ul class="home-list">
              <For each={list()}>
                {(run) => (
                  <li>
                    <A href={`/runs/${run.id}`}>{run.name}</A>
                    <Show when={run.latest_release} fallback={<span class="settings-note">{t('runsPage.nothingReleased')}</span>}>
                      {(released) => (
                        <span>
                          <A href={`/runs/${run.id}/releases/${released().id}`}>{released().title}</A>{' '}
                          <span class="settings-note">
                            {t('home.submitted', { submitted: released().submitted, total: released().total })}
                          </span>
                        </span>
                      )}
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        )}
      </Show>
    </section>
  )
}
