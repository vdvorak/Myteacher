import { A } from '@solidjs/router'
import { createResource, createSignal, For, Show } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { useApi } from '../api/context'
import '../documents/documents.css'
import { useI18n } from '../i18n/i18n'
import type { MessageKey } from '../i18n/messages'
import { finished } from '../jobs/api'
import { JobFailureMessage, JobStatus } from '../jobs/JobStatus'
import { MaterialRefused, type MaterialRefusal, type MaterialSummary } from './api'

const refusals: Record<Exclude<MaterialRefusal, 'no_provider_key'>, MessageKey> = {
  map_not_approved: 'materials.mapNotApproved',
  nothing_to_retry: 'materials.changedMeanwhile',
  generation_running: 'materials.changedMeanwhile',
  material_changed: 'materials.changedMeanwhile',
  unknown_student: 'materials.unknownStudent',
}

type Problem = { kind: 'refused'; reason: MaterialRefusal } | { kind: 'failed' } | null

function ProblemMessage(props: { problem: Problem }) {
  const { t } = useI18n()
  return (
    <Show when={props.problem}>
      {(shown) => {
        const value = shown()
        if (value.kind === 'refused' && value.reason === 'no_provider_key') return <JobFailureMessage kind="no_key" />
        return (
          <p role="alert">
            {t(value.kind === 'refused' ? refusals[value.reason as keyof typeof refusals] : 'courses.saveFailed')}
          </p>
        )
      }}
    </Show>
  )
}

const asProblem = (error: unknown): Problem =>
  error instanceof MaterialRefused ? { kind: 'refused', reason: error.reason } : { kind: 'failed' }

/** The classroom material of a topic: exercises generated from its approved concept map. */
export function MaterialsSection(props: { courseId: number; topicId: number; canEdit: boolean; mapApproved: boolean }) {
  const { t } = useI18n()
  const apis = useApi()
  const api = apis.materials
  const [list, setList] = createStore<MaterialSummary[]>([])
  const [chosen, setChosen] = createSignal<number[]>([])
  const [busy, setBusy] = createSignal(false)
  const [problem, setProblem] = createSignal<Problem>(null)
  // The students' names, for the targets; material still shows without them.
  const [students] = createResource(async () => {
    try {
      return await apis.students.list()
    } catch {
      return []
    }
  })
  const nameOf = (id: number) => students()?.find((s) => s.id === id)?.name ?? `#${id}`

  const [loaded] = createResource(
    () => [props.courseId, props.topicId] as const,
    async ([courseId, topicId]) => {
      setList(reconcile(await api.list(courseId, topicId), { key: 'id' }))
      return true
    },
  )

  async function reload() {
    try {
      setList(reconcile(await api.list(props.courseId, props.topicId), { key: 'id' }))
    } catch {
      setProblem({ kind: 'failed' })
    }
  }

  async function generate(event: SubmitEvent) {
    event.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      await api.generate(props.courseId, props.topicId, chosen())
      setChosen([])
      await reload()
    } catch (error) {
      setProblem(asProblem(error))
    } finally {
      setBusy(false)
    }
  }

  const choose = (id: number, on: boolean) =>
    setChosen(on ? [...chosen(), id] : chosen().filter((chosenId) => chosenId !== id))

  return (
    <section class="settings-form" aria-labelledby="materials-heading">
      <h2 id="materials-heading">{t('materials.heading')}</h2>
      <Show when={loaded.error}>
        <p role="alert">{t('materials.loadFailed')}</p>
      </Show>
      <Show when={loaded()}>
        <Show when={list.length > 0} fallback={<p>{t('materials.none')}</p>}>
          <ul class="document-list">
            <For each={list}>
              {(material) => (
                <li>
                  <MaterialCard
                    courseId={props.courseId}
                    topicId={props.topicId}
                    material={material}
                    canEdit={props.canEdit}
                    nameOf={nameOf}
                    onChanged={reload}
                  />
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
      <Show when={props.canEdit}>
        <Show when={props.mapApproved} fallback={<p class="settings-note">{t('materials.approveMapFirst')}</p>}>
          <form class="document-editor" onSubmit={generate}>
            <Show when={(students() ?? []).length > 0}>
              <fieldset>
                <legend>{t('materials.forStudents')}</legend>
                <For each={students()}>
                  {(student) => (
                    <label class="settings-check">
                      <input
                        type="checkbox"
                        checked={chosen().includes(student.id)}
                        onChange={(e) => choose(student.id, e.currentTarget.checked)}
                      />
                      {student.name}
                    </label>
                  )}
                </For>
              </fieldset>
            </Show>
            <p class="settings-note">{t('materials.targetsNote')}</p>
            <div class="settings-actions">
              <button type="submit" disabled={busy()}>
                {t('materials.generate')}
              </button>
            </div>
          </form>
        </Show>
      </Show>
      <ProblemMessage problem={problem()} />
    </section>
  )
}

function MaterialCard(props: {
  courseId: number
  topicId: number
  material: MaterialSummary
  canEdit: boolean
  nameOf: (id: number) => string
  onChanged: () => Promise<void>
}) {
  const { t } = useI18n()
  const api = useApi().materials
  const [busy, setBusy] = createSignal(false)
  const [problem, setProblem] = createSignal<Problem>(null)
  const [confirming, setConfirming] = createSignal(false)
  const [kept, setKept] = createSignal(false)
  const [instruction, setInstruction] = createSignal('')
  const headingId = `material-${props.material.id}`
  // The latest version's history, for the instruction it was reworked by.
  const [detail, { refetch }] = createResource(
    () => props.material.version,
    async () => {
      try {
        return await api.get(props.courseId, props.topicId, props.material.id)
      } catch {
        return null
      }
    },
  )
  const latest = () => detail()?.versions.at(-1)

  const running = () => {
    const job = props.material.job
    return job && !finished(job) ? job : null
  }
  const failure = () => (props.material.job?.state === 'failed' ? props.material.job : null)
  const ids = () => [props.courseId, props.topicId, props.material.id] as const

  async function act(action: () => Promise<unknown>, reload = true): Promise<boolean> {
    setBusy(true)
    setProblem(null)
    try {
      await action()
      return true
    } catch (error) {
      setProblem(asProblem(error))
      return false
    } finally {
      setBusy(false)
      if (reload) await props.onChanged()
    }
  }

  async function rework(event: SubmitEvent) {
    event.preventDefault()
    const text = instruction().trim()
    if (text === '' || props.material.version === null) return
    setKept(false)
    if (await act(() => api.regenerate(...ids(), text, props.material.version!))) setInstruction('')
  }

  return (
    <article class="document-card" aria-labelledby={headingId}>
      <h3 id={headingId}>{props.material.title ?? t('materials.untitled')}</h3>
      <Show when={props.material.version}>
        {(version) => <p class="settings-note">{t('materials.version', { version: version() })}</p>}
      </Show>
      <Show when={latest()?.instruction}>
        {(text) => (
          <p class="settings-note">
            {t('materials.reworked', { previous: latest()?.previous ?? '', instruction: text() })}
          </p>
        )}
      </Show>
      <p class="settings-note">
        {props.material.target_student_ids.length > 0
          ? t('materials.for', { names: props.material.target_student_ids.map(props.nameOf).join(', ') })
          : t('materials.forClass')}
      </p>
      {/* Keyed by the job, so a new generation gets a fresh status that polls it. */}
      <Show when={running()?.id} keyed>
        {(_id) => (
          <JobStatus
            job={running()!}
            onFinished={() => {
              void props.onChanged()
              void refetch()
            }}
          />
        )}
      </Show>
      <Show when={!running() && failure()}>
        {(job) => <JobFailureMessage kind={job().error_kind ?? 'other'} rawOutput={job().raw_output} />}
      </Show>
      <div class="settings-actions">
        <Show when={props.material.version !== null}>
          <A href={`/preview/courses/${props.courseId}/topics/${props.topicId}/materials/${props.material.id}`}>
            {t('materials.preview')}
          </A>
        </Show>
        <Show when={props.canEdit && !running()}>
          <Show when={props.material.version === null && failure()}>
            <button type="button" disabled={busy()} onClick={() => void act(() => api.retry(...ids()))}>
              {t('materials.retry')}
            </button>
          </Show>
          <Show when={props.material.version !== null}>
            <button
              type="button"
              disabled={busy()}
              // Read again: keeping also forgets a failed rework.
              onClick={async () => setKept(await act(() => api.keep(...ids())))}
            >
              {t('materials.keep')}
            </button>
          </Show>
          <Show
            when={confirming()}
            fallback={
              <button type="button" disabled={busy()} onClick={() => setConfirming(true)}>
                {t('materials.discard')}
              </button>
            }
          >
            <button type="button" class="danger" disabled={busy()} onClick={() => void act(() => api.discard(...ids()))}>
              {t('materials.discardForGood')}
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              {t('access.cancel')}
            </button>
          </Show>
        </Show>
      </div>
      <Show when={kept()}>
        <p role="status">{t('materials.kept')}</p>
      </Show>
      <Show when={props.canEdit && props.material.version !== null && !running()}>
        <form class="document-editor" onSubmit={rework}>
          <label>
            {t('materials.instruction')}
            <textarea
              rows={2}
              maxLength={2000}
              value={instruction()}
              placeholder={t('materials.instructionPlaceholder')}
              onInput={(e) => setInstruction(e.currentTarget.value)}
            />
          </label>
          <div class="settings-actions">
            <button type="submit" disabled={busy()}>
              {t('materials.rework')}
            </button>
          </div>
        </form>
      </Show>
      <ProblemMessage problem={problem()} />
    </article>
  )
}
