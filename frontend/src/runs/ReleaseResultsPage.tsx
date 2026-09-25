import { A, useParams } from '@solidjs/router'
import { createResource, For, Show } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import type { MessageKey } from '../i18n/messages'
import { ApiError } from '../lesson/api'
import '../admin/admin.css'
import { TeachersOnly } from '../students/StudentsPage'
import type { ResultCell } from './api'

const cellNames: Record<ResultCell, MessageKey> = {
  right: 'results.cell.right',
  wrong: 'results.cell.wrong',
  open: 'results.cell.open',
  unanswered: 'results.cell.unanswered',
}
const cellMarks: Record<ResultCell, string> = { right: '✓', wrong: '✗', open: '…', unanswered: '–' }

/** A result mark, named for assistive technology and on hover. */
export function ResultMark(props: { cell: ResultCell }) {
  const { t } = useI18n()
  return (
    <span title={t(cellNames[props.cell])} data-state={props.cell}>
      <span aria-hidden="true">{cellMarks[props.cell]}</span>
      <span class="visually-hidden">{t(cellNames[props.cell])}</span>
    </span>
  )
}

/** The run teacher's view of a release: students × exercises from the attempts that count, and
 * how many got each exercise wrong, so the rule the class did not understand shows. */
export function ReleaseResultsPage() {
  return (
    <TeachersOnly>
      <ReleaseResults />
    </TeachersOnly>
  )
}

function ReleaseResults() {
  const { t } = useI18n()
  const api = useApi().runs
  const params = useParams<{ runId: string; releaseId: string }>()
  const ids = () => [Number(params.runId), Number(params.releaseId)] as const
  const [results] = createResource(ids, ([runId, releaseId]) => api.results(runId, releaseId))
  const [run] = createResource(() => Number(params.runId), (id) => api.get(id))
  const number = (index: number) => t('results.exercise', { number: index + 1 })

  return (
    <>
      <Show when={!run.error && run()}>
        {(loaded) => <A href={`/runs/${loaded().id}`}>{t('results.backToRun', { run: loaded().name })}</A>}
      </Show>
      <Show when={results.error}>
        <p role="alert">
          {results.error instanceof ApiError && results.error.status === 404 ? t('results.notFound') : t('results.loadFailed')}
        </p>
      </Show>
      <Show when={!results.error && results()}>
        {(loaded) => (
          <>
            <h1>{loaded().release.title}</h1>
            <p class="settings-note">{loaded().release.topic}</p>
            <h2 id="results-heading">{t('results.heading')}</h2>
            <Show when={loaded().students.length > 0} fallback={<p>{t('results.none')}</p>}>
              <div class="table-scroll">
                <table class="admin-table" aria-labelledby="results-heading">
                  <thead>
                    <tr>
                      <th scope="col">{t('results.student')}</th>
                      <th scope="col">{t('results.state')}</th>
                      <For each={loaded().exercises}>
                        {(exercise, index) => (
                          <th scope="col" title={exercise.prompt ?? undefined}>
                            {index() + 1}
                            <span class="visually-hidden">{number(index())}</span>
                          </th>
                        )}
                      </For>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={loaded().students}>
                      {(student) => (
                        <tr>
                          <th scope="row">
                            <A href={`/runs/${params.runId}/releases/${params.releaseId}/students/${student.id}`}>
                              {student.name}
                            </A>
                            <Show when={!student.in_run}>
                              {' '}
                              <span class="settings-note">{t('results.notInRun')}</span>
                            </Show>
                          </th>
                          <td>
                            {t(`work.state.${student.state}`)}
                            <Show when={student.late}> · {t('results.late')}</Show>
                            <Show when={student.attempts > 1}> · {t('results.attempts', { count: student.attempts })}</Show>
                          </td>
                          <For each={loaded().exercises}>
                            {(exercise) => (
                              <td>
                                <Show when={student.cells[exercise.id]}>{(cell) => <ResultMark cell={cell()} />}</Show>
                              </td>
                            )}
                          </For>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
            <h2 id="summary-heading">{t('results.summary')}</h2>
            <div class="table-scroll">
              <table class="admin-table" aria-labelledby="summary-heading">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">{t('results.prompt')}</th>
                    <th scope="col">{t('results.wrong')}</th>
                    <th scope="col">{t('results.right')}</th>
                    <th scope="col">{t('results.open')}</th>
                    <th scope="col">{t('results.unanswered')}</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={loaded().exercises}>
                    {(exercise, index) => (
                      <tr>
                        <th scope="row">{index() + 1}</th>
                        <td>{exercise.prompt}</td>
                        <td>{exercise.wrong}</td>
                        <td>{exercise.right}</td>
                        <td>{exercise.open}</td>
                        <td>{exercise.unanswered}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </>
        )}
      </Show>
    </>
  )
}
