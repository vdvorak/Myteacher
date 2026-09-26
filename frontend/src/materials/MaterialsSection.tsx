import { A } from '@solidjs/router'
import { createResource, createSignal, createUniqueId, For, Show } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { useApi } from '../api/context'
import { DraftBadge } from '../shell/DraftBadge'
import '../documents/documents.css'
import { useI18n } from '../i18n/i18n'
import type { MessageKey } from '../i18n/messages'
import { finished } from '../jobs/api'
import { JobFailureMessage, JobStatus } from '../jobs/JobStatus'
import { ReleaseDialog } from '../runs/ReleaseDialog'
import type { Source } from '../sources/api'
import { MaterialRefused, type MaterialRefusal, type MaterialSummary } from './api'

const refusals: Record<Exclude<MaterialRefusal, 'no_provider_key'>, MessageKey> = {
  map_not_approved: 'materials.mapNotApproved',
  nothing_to_retry: 'materials.changedMeanwhile',
  generation_running: 'materials.changedMeanwhile',
  material_changed: 'materials.changedMeanwhile',
  unknown_student: 'materials.unknownStudent',
  unknown_source: 'materials.unknownSource',
  source_not_read: 'materials.sourceNotRead',
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

/** The classroom material of a topic: exercises generated from its approved concept map, or transcribed
 * from one of the course's sources. */
export function MaterialsSection(props: {
  courseId: number
  topicId: number
  canEdit: boolean
  mapApproved: boolean
  /** The list changed: the topic's counts follow. */
  onChanged?: () => void
}) {
  const { t } = useI18n()
  const apis = useApi()
  const api = apis.materials
  const [list, setList] = createStore<MaterialSummary[]>([])
  const [chosen, setChosen] = createSignal<number[]>([])
  const [instruction, setInstruction] = createSignal('')
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
  // The course's sources, to transcribe from and to name what material came from.
  const [sources] = createResource(
    () => props.courseId,
    async (courseId) => {
      try {
        return await apis.sources.list(courseId)
      } catch {
        return []
      }
    },
  )
  const sourceName = (id: number) => sources()?.find((s) => s.id === id)?.name ?? `#${id}`
  const readSources = () => (sources() ?? []).filter((s) => s.characters !== null)

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
      props.onChanged?.()
    } catch {
      setProblem({ kind: 'failed' })
    }
  }

  async function generate(event: SubmitEvent) {
    event.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      await api.generate(props.courseId, props.topicId, chosen(), instruction().trim() || null)
      setChosen([])
      setInstruction('')
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
                    sourceName={sourceName}
                    onChanged={reload}
                  />
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
      <Show when={props.canEdit && sources()}>
        <TranscriptionForm
          courseId={props.courseId}
          topicId={props.topicId}
          sources={readSources()}
          onStarted={reload}
          onProblem={setProblem}
        />
      </Show>
      <Show when={props.canEdit}>
        <Show
          when={props.mapApproved}
          fallback={
            <>
              <p class="settings-note">{t('materials.approveMapFirst')}</p>
              <p>
                <a class="button-link" href={`/courses/${props.courseId}/topics/${props.topicId}?tab=map`}>
                  {t('emptyState.toMap')}
                </a>
              </p>
            </>
          }
        >
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
            <label>
              {t('materials.firstInstruction')}
              <textarea
                rows={2}
                maxLength={2000}
                value={instruction()}
                placeholder={t('materials.firstInstructionPlaceholder')}
                onInput={(e) => setInstruction(e.currentTarget.value)}
              />
            </label>
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

/** Material transcribed faithfully from a source the teacher uploaded, such as a scanned test. */
function TranscriptionForm(props: {
  courseId: number
  topicId: number
  /** The course's sources with text read from them. */
  sources: Source[]
  onStarted: () => Promise<void>
  onProblem: (problem: Problem) => void
}) {
  const { t } = useI18n()
  const api = useApi().materials
  const headingId = createUniqueId()
  const [sourceId, setSourceId] = createSignal<number | null>(null)
  const [keyId, setKeyId] = createSignal<number | null>(null)
  const [busy, setBusy] = createSignal(false)
  const chosen = () => sourceId() ?? props.sources[0]?.id ?? null

  async function transcribe(event: SubmitEvent) {
    event.preventDefault()
    const source = chosen()
    if (source === null) return
    setBusy(true)
    props.onProblem(null)
    try {
      await api.transcribe(props.courseId, props.topicId, source, keyId(), [])
      setKeyId(null)
      await props.onStarted()
    } catch (error) {
      props.onProblem(asProblem(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form class="document-editor" aria-labelledby={headingId} onSubmit={transcribe}>
      <h3 id={headingId}>{t('materials.fromSource')}</h3>
      <p class="settings-note">{t('materials.fromSourceNote')}</p>
      <Show
        when={props.sources.length > 0}
        fallback={
          <>
            <p class="settings-note">{t('materials.noReadSource')}</p>
            <p>
              <A class="button-link" href={`/courses/${props.courseId}?tab=sources`}>
                {t('materials.toSources')}
              </A>
            </p>
          </>
        }
      >
        <label>
          {t('materials.sourceToTranscribe')}
          <select value={chosen() ?? ''} onChange={(e) => setSourceId(Number(e.currentTarget.value))}>
            <For each={props.sources}>{(source) => <option value={source.id}>{source.name}</option>}</For>
          </select>
        </label>
        <label>
          {t('materials.keySource')}
          <select
            value={keyId() ?? ''}
            onChange={(e) => setKeyId(e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
          >
            <option value="">{t('materials.noKeySource')}</option>
            <For each={props.sources.filter((s) => s.id !== chosen())}>
              {(source) => <option value={source.id}>{source.name}</option>}
            </For>
          </select>
        </label>
        <div class="settings-actions">
          <button type="submit" disabled={busy()}>
            {t('materials.transcribe')}
          </button>
        </div>
      </Show>
    </form>
  )
}

function MaterialCard(props: {
  courseId: number
  topicId: number
  material: MaterialSummary
  canEdit: boolean
  nameOf: (id: number) => string
  sourceName: (id: number) => string
  onChanged: () => Promise<void>
}) {
  const { t } = useI18n()
  const apis = useApi()
  const api = apis.materials
  const [busy, setBusy] = createSignal(false)
  const [problem, setProblem] = createSignal<Problem>(null)
  const [confirming, setConfirming] = createSignal(false)
  const [kept, setKept] = createSignal(false)
  const [instruction, setInstruction] = createSignal('')
  const [releasing, setReleasing] = createSignal(false)
  const headingId = `material-${props.material.id}`
  // The runs it is released in; the material still shows without them.
  const [releasedIn, { refetch: refetchReleases }] = createResource(
    () => props.material.version !== null,
    async () => {
      try {
        return await apis.runs.materialReleases(props.courseId, props.topicId, props.material.id)
      } catch {
        return []
      }
    },
  )
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
  const paperOnly = () => detail()?.lesson?.blocks.filter((block) => block.type === 'paper_only').length ?? 0

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
        {(version) => (
          <p class="settings-note">
            <DraftBadge reviewed={props.material.reviewed} /> <span>{t('materials.version', { version: version() })}</span>
          </p>
        )}
      </Show>
      <Show when={props.material.source_id}>
        {(id) => <p class="settings-note">{t('materials.transcribedFrom', { name: props.sourceName(id()) })}</p>}
      </Show>
      <Show when={!props.material.reviewed && (detail()?.proposed_answers.length ?? 0) > 0}>
        <p class="settings-note">{t('materials.answersProposed', { count: detail()!.proposed_answers.length })}</p>
      </Show>
      <Show when={paperOnly() > 0}>
        <p class="settings-note">{t('materials.paperOnly', { count: paperOnly() })}</p>
      </Show>
      <Show when={latest()?.instruction}>
        {(text) => (
          <p class="settings-note">
            {latest()?.previous
              ? t('materials.reworked', { previous: latest()!.previous!, instruction: text() })
              : t('materials.askedFor', { instruction: text() })}
          </p>
        )}
      </Show>
      <Show when={(releasedIn() ?? []).length > 0}>
        <p class="settings-note">
          {t('materials.releasedIn')}{' '}
          <For each={releasedIn()}>
            {(released, index) => (
              <>
                {index() > 0 ? ', ' : ''}
                <A href={`/runs/${released.run_id}/releases/${released.release_id}`}>
                  {t('materials.releasedRun', { run: released.run_name, version: released.version })}
                </A>
              </>
            )}
          </For>
        </p>
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
          <button type="button" onClick={() => setReleasing(true)}>
            {t('materials.releaseInRun')}
          </button>
        </Show>
        <Show when={props.canEdit && !running()}>
          <Show when={props.material.version === null && failure()}>
            <button type="button" disabled={busy()} onClick={() => void act(() => api.retry(...ids()))}>
              {t('materials.retry')}
            </button>
          </Show>
          {/* Marking reviewed also forgets a failed rework of a version already reviewed. */}
          <Show when={props.material.version !== null && (!props.material.reviewed || failure())}>
            <button type="button" disabled={busy()} onClick={async () => setKept(await act(() => api.keep(...ids())))}>
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
      <Show when={releasing()}>
        <ReleaseDialog
          courseId={props.courseId}
          materialId={props.material.id}
          onClose={() => setReleasing(false)}
          onReleased={() => void refetchReleases()}
        />
      </Show>
    </article>
  )
}
