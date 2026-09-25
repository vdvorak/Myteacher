import { A, useParams, useSearchParams } from '@solidjs/router'
import { createResource, For, Match, Show, Switch } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import type { MessageKey } from '../i18n/messages'
import { ApiError } from '../lesson/api'
import '../admin/admin.css'
import { PageHeader } from '../shell/PageHeader'
import { StepTabs } from '../shell/StepTabs'
import { TeachersOnly } from '../students/StudentsPage'
import type { ReleaseResults, ResultCell } from './api'
import { OpenAnswersTab } from './OpenAnswersTab'
import { attemptNames, feedbackNames, lateNames } from './ReleaseDialog'
import { RetractionForm } from './RetractionForm'
import { useRunTrail } from './trail'
import './runs.css'

const cellNames: Record<ResultCell, MessageKey> = {
  right: 'results.cell.right',
  wrong: 'results.cell.wrong',
  open: 'results.cell.open',
  unanswered: 'results.cell.unanswered',
}
const cellMarks: Record<ResultCell, string> = { right: '✓', wrong: '✗', open: '…', unanswered: '–' }

/** A result mark: a symbol and a colour, named for assistive technology and on hover. */
export function ResultMark(props: { cell: ResultCell }) {
  const { t } = useI18n()
  return (
    <span class="result-mark" title={t(cellNames[props.cell])} data-state={props.cell}>
      <span aria-hidden="true">{cellMarks[props.cell]}</span>
      <span class="visually-hidden">{t(cellNames[props.cell])}</span>
    </span>
  )
}

type TabId = 'results' | 'open' | 'settings'
const tabIds: TabId[] = ['results', 'open', 'settings']

/** The run teacher's view of a release: its results, its open answers and its settings. */
export function ReleaseResultsPage() {
  return (
    <TeachersOnly>
      <ReleaseDetail />
    </TeachersOnly>
  )
}

function ReleaseDetail() {
  const { t } = useI18n()
  const api = useApi().runs
  const params = useParams<{ runId: string; releaseId: string }>()
  const [search] = useSearchParams<{ tab?: string }>()
  const ids = () => [Number(params.runId), Number(params.releaseId)] as const
  const [results, { refetch }] = createResource(ids, ([runId, releaseId]) => api.results(runId, releaseId))
  useRunTrail(() => ({ runId: Number(params.runId), releaseId: Number(params.releaseId) }))
  const current = (): TabId => tabIds.find((id) => id === search.tab) ?? 'results'

  const tabs = (loaded: ReleaseResults) => [
    { id: 'results', label: t('releaseTabs.results') },
    {
      id: 'open',
      label:
        loaded.open_answers.waiting > 0
          ? t('releaseTabs.openWaiting', { count: loaded.open_answers.waiting })
          : t('releaseTabs.open'),
    },
    { id: 'settings', label: t('releaseTabs.settings') },
  ]

  return (
    <>
      <Show when={results.error}>
        <p role="alert">
          {results.error instanceof ApiError && results.error.status === 404 ? t('results.notFound') : t('results.loadFailed')}
        </p>
      </Show>
      <Show when={!results.error && results()}>
        {(loaded) => (
          <>
            <PageHeader title={loaded().release.title} meta={loaded().release.topic} />
            <Show when={loaded().release.retraction_reason}>
              {(reason) => <p role="status">{t('retraction.retracted', { reason: reason() })}</p>}
            </Show>
            <StepTabs
              label={t('releaseTabs.label')}
              tabs={tabs(loaded())}
              current={current()}
              href={(id) => `/runs/${params.runId}/releases/${params.releaseId}?tab=${id}`}
            />
            <Switch>
              <Match when={current() === 'results'}>
                <ResultsMatrix results={loaded()} runId={ids()[0]} releaseId={ids()[1]} />
              </Match>
              <Match when={current() === 'open'}>
                <OpenAnswersTab
                  runId={ids()[0]}
                  releaseId={ids()[1]}
                  counts={loaded().open_answers}
                  onChanged={() => void refetch()}
                />
              </Match>
              <Match when={current() === 'settings'}>
                <ReleaseSettingsTab results={loaded()} runId={ids()[0]} onRetracted={() => void refetch()} />
              </Match>
            </Switch>
          </>
        )}
      </Show>
    </>
  )
}

/** Students × exercises: the matrix scrolls on its own, the names and the prompts stay in view. */
function ResultsMatrix(props: { results: ReleaseResults; runId: number; releaseId: number }) {
  const { t } = useI18n()
  const studentHref = (studentId: number, exerciseId?: string) =>
    `/runs/${props.runId}/releases/${props.releaseId}/students/${studentId}${exerciseId ? `#exercise-${exerciseId}` : ''}`

  return (
    <section aria-labelledby="results-heading">
      <h2 id="results-heading" class="visually-hidden">
        {t('results.heading')}
      </h2>
      <Show when={props.results.students.length > 0} fallback={<p>{t('results.none')}</p>}>
        <div class="results-matrix" tabIndex={0} aria-label={t('results.heading')} role="region">
          <table aria-labelledby="results-heading">
            <thead>
              <tr>
                <th scope="col">{t('results.student')}</th>
                <For each={props.results.exercises}>
                  {(exercise, index) => (
                    <th scope="col" class="results-prompt" title={exercise.prompt ?? undefined}>
                      <span class="results-number">{index() + 1}</span>
                      <span class="results-prompt-text">
                        {exercise.prompt ?? t('results.exercise', { number: index() + 1 })}
                      </span>
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={props.results.students}>
                {(student) => (
                  <tr>
                    <th scope="row">
                      <A href={studentHref(student.id)}>{student.name}</A>
                      <span class="results-state">
                        {t(`work.state.${student.state}`)}
                        <Show when={student.late}> · {t('results.late')}</Show>
                        <Show when={student.attempts > 1}> · {t('results.attempts', { count: student.attempts })}</Show>
                        <Show when={!student.in_run}> · {t('results.notInRun')}</Show>
                      </span>
                    </th>
                    <For each={props.results.exercises}>
                      {(exercise) => (
                        <td>
                          <Show when={student.cells[exercise.id]}>
                            {(cell) => (
                              <A
                                href={studentHref(student.id, exercise.id)}
                                aria-label={t('results.cellLink', {
                                  student: student.name,
                                  exercise: exercise.prompt ?? exercise.id,
                                  state: t(cellNames[cell()]),
                                })}
                              >
                                <ResultMark cell={cell()} />
                              </A>
                            )}
                          </Show>
                        </td>
                      )}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{t('results.wrong')}</th>
                <For each={props.results.exercises}>{(exercise) => <td>{exercise.wrong}</td>}</For>
              </tr>
            </tfoot>
          </table>
        </div>
      </Show>
    </section>
  )
}

/** The release's settings, the material it released, and retracting it, set apart at the bottom. */
function ReleaseSettingsTab(props: { results: ReleaseResults; runId: number; onRetracted: () => void }) {
  const { t, locale } = useI18n()
  const apis = useApi()
  const [run] = createResource(() => props.runId, (id) => apis.runs.get(id))
  const released = () => props.results.release

  return (
    <section aria-labelledby="release-settings-heading" class="settings-form">
      <h2 id="release-settings-heading">{t('releaseTabs.settings')}</h2>
      <dl class="settings-list">
        <dt>{t('releases.material')}</dt>
        <dd>
          <Show when={!run.error && run()} fallback={t('releases.materialVersion', { title: released().title, version: released().version })}>
            {(found) => (
              <A
                href={`/preview/courses/${found().course.id}/topics/${released().topic_id}/materials/${released().material_id}`}
              >
                {t('releases.materialVersion', { title: released().title, version: released().version })}
              </A>
            )}
          </Show>
        </dd>
        <dt>{t('releases.audience')}</dt>
        <dd>{released().audience === 'run' ? t('releases.wholeRun') : released().students.map((s) => s.name).join(', ')}</dd>
        <dt>{t('runReleases.released')}</dt>
        <dd>{new Date(released().released_at).toLocaleString(locale())}</dd>
        <dt>{t('releases.feedback')}</dt>
        <dd>{t(feedbackNames[released().feedback_mode])}</dd>
        <dt>{t('releases.due')}</dt>
        <dd>{released().due_at ? new Date(released().due_at!).toLocaleString(locale()) : t('releases.noDue')}</dd>
        <dt>{t('releases.late')}</dt>
        <dd>{t(lateNames[released().late_submissions])}</dd>
        <dt>{t('releases.attempts')}</dt>
        <dd>{t(attemptNames[released().attempts])}</dd>
        <dt>{t('releases.solutions')}</dt>
        <dd>{t(released().show_solutions ? 'releases.solutionsShown' : 'releases.solutionsHidden')}</dd>
      </dl>
      <Show when={!released().retracted_at}>
        <div class="danger-zone">
          <h3>{t('retraction.retractRelease')}</h3>
          <RetractionForm
            intro="retraction.releaseIntro"
            question="retraction.confirmRelease"
            action="retraction.retractRelease"
            onRetract={async (reason) => {
              await apis.runs.retractRelease(props.runId, released().id, reason)
              // Not awaited: reading the page again failing does not make the retraction fail.
              props.onRetracted()
            }}
          />
        </div>
      </Show>
    </section>
  )
}
