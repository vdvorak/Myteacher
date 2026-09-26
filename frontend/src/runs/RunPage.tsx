import { A, useParams, useSearchParams } from '@solidjs/router'
import { createEffect, createResource, createSignal, Match, Show, Switch } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import '../admin/admin.css'
import { useBreadcrumbs } from '../shell/breadcrumbs'
import { PageHeader } from '../shell/PageHeader'
import { StepTabs } from '../shell/StepTabs'
import { TeachersOnly } from '../students/StudentsPage'
import type { CourseRun } from './api'
import { ReleaseDialog } from './ReleaseDialog'
import { RunOverview } from './RunOverview'
import { RunLobby } from './RunLobby'
import { RunReleases } from './ReleasesSection'
import { RunStudents } from './RunStudents'
import './runs.css'

type TabId = 'overview' | 'releases' | 'students' | 'participants' | 'settings'
const tabIds: TabId[] = ['overview', 'releases', 'students', 'participants', 'settings']

/** One run, seen by its teacher: how it goes, its releases, its students and its settings. */
export function RunPage() {
  return (
    <TeachersOnly>
      <RunDetail />
    </TeachersOnly>
  )
}

function RunDetail() {
  const { t } = useI18n()
  const api = useApi().runs
  const params = useParams<{ runId: string }>()
  const [search] = useSearchParams<{ tab?: string }>()
  const runId = () => Number(params.runId)
  const [run, { mutate }] = createResource(runId, (id) => api.get(id))
  const [releases, { refetch: refetchReleases }] = createResource(runId, (id) => api.releases(id))
  const [releasing, setReleasing] = createSignal(false)
  const loaded = () => (run.error ? undefined : run())
  // A link run's roster is its participants, who join through its link instead of being enrolled.
  const peopleTab = (): TabId => (loaded()?.mode === 'link' ? 'participants' : 'students')
  const current = (): TabId => {
    const asked = search.tab === 'students' || search.tab === 'participants' ? peopleTab() : search.tab
    return tabIds.find((id) => id === asked) ?? 'overview'
  }

  useBreadcrumbs(() => [{ label: t('nav.runs'), href: '/runs' }, { label: loaded()?.name ?? '…' }])

  const tabs = () => [
    { id: 'overview', label: t('runTabs.overview') },
    { id: 'releases', label: t('runTabs.releases') },
    { id: peopleTab(), label: t(peopleTab() === 'participants' ? 'runTabs.participants' : 'runTabs.students') },
    { id: 'settings', label: t('runTabs.settings') },
  ]

  return (
    <section class="admin-section">
      <Show when={run.error}>
        <p role="alert">{t('runs.runLoadFailed')}</p>
      </Show>
      <Show when={loaded()}>
        {(shown) => (
          <>
            <PageHeader
              title={shown().name}
              meta={
                <>
                  {t('runs.course')}
                  <A href={`/courses/${shown().course.id}`}>{shown().course.name}</A>
                </>
              }
              action={
                <button type="button" onClick={() => setReleasing(true)}>
                  {t('releases.new')}
                </button>
              }
            />
            <StepTabs
              label={t('runTabs.label')}
              tabs={tabs()}
              current={current()}
              href={(id) => `/runs/${runId()}?tab=${id}`}
            />
            <Switch>
              <Match when={current() === 'overview'}>
                <Show when={!releases.error} fallback={<p role="alert">{t('releases.loadFailed')}</p>}>
                  <Show when={releases()}>
                    {(list) => <RunOverview run={shown()} releases={list()} onRelease={() => setReleasing(true)} />}
                  </Show>
                </Show>
              </Match>
              <Match when={current() === 'releases'}>
                <RunReleases
                  run={shown()}
                  releases={releases.error ? undefined : releases()}
                  failed={Boolean(releases.error)}
                />
              </Match>
              <Match when={current() === 'students'}>
                <RunStudents
                  run={shown()}
                  onChanged={(changed) => {
                    mutate(changed)
                    // Who has each release follows the roster.
                    void refetchReleases()
                  }}
                />
              </Match>
              <Match when={current() === 'participants'}>
                <RunLobby
                  run={shown()}
                  onCount={(count) => {
                    // The overview's first step follows who joined.
                    if (count !== shown().participant_count) mutate({ ...shown(), participant_count: count })
                  }}
                />
              </Match>
              <Match when={current() === 'settings'}>
                <RunSettings run={shown()} onChanged={mutate} />
              </Match>
            </Switch>
            <Show when={releasing()}>
              <ReleaseDialog
                courseId={shown().course.id}
                runId={shown().id}
                onClose={() => setReleasing(false)}
                onReleased={() => void refetchReleases()}
              />
            </Show>
          </>
        )}
      </Show>
    </section>
  )
}

/** The run's name; co-teachers and release defaults come later (#111, #112). */
function RunSettings(props: { run: CourseRun; onChanged: (run: CourseRun) => void }) {
  const { t } = useI18n()
  const api = useApi().runs
  const [name, setName] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [outcome, setOutcome] = createSignal<'saved' | 'failed' | null>(null)

  // Fill the name once per run, so a change elsewhere never overwrites a rename being typed.
  let filledFor: number | undefined
  createEffect(() => {
    if (props.run.id !== filledFor) {
      filledFor = props.run.id
      setName(props.run.name)
    }
  })

  async function rename(event: SubmitEvent) {
    event.preventDefault()
    if (name().trim() === '') return
    setBusy(true)
    setOutcome(null)
    try {
      props.onChanged(await api.rename(props.run.id, name().trim()))
      setOutcome('saved')
    } catch {
      setOutcome('failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form class="settings-form" onSubmit={rename}>
      <label>
        {t('runs.name')}
        <input required maxLength={200} value={name()} onInput={(e) => setName(e.currentTarget.value)} />
      </label>
      <div class="settings-actions">
        <button type="submit" disabled={busy()}>
          {t('runs.rename')}
        </button>
      </div>
      <Show when={outcome() === 'saved'}>
        <p role="status">{t('runs.renamed')}</p>
      </Show>
      <Show when={outcome() === 'failed'}>
        <p role="alert">{t('smtp.requestFailed')}</p>
      </Show>
    </form>
  )
}
