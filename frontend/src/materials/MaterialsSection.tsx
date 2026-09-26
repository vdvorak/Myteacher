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
import { SourceRefused, sourceFileTypes, type Source, type SourceRefusal } from '../sources/api'
import { sourceRefusals } from '../sources/SourcesSection'
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

type Problem =
  | { kind: 'refused'; reason: MaterialRefusal }
  /** A file uploaded to be transcribed was refused. */
  | { kind: 'source'; reason: SourceRefusal }
  | { kind: 'failed' }
  | null

function ProblemMessage(props: { problem: Problem }) {
  const { t } = useI18n()
  const message = (problem: Exclude<Problem, null>): MessageKey =>
    problem.kind === 'refused'
      ? refusals[problem.reason as keyof typeof refusals]
      : problem.kind === 'source'
        ? sourceRefusals[problem.reason]
        : 'courses.saveFailed'
  return (
    <Show when={props.problem}>
      {(shown) => {
        const value = shown()
        if (value.kind !== 'failed' && value.reason === 'no_provider_key') return <JobFailureMessage kind="no_key" />
        return <p role="alert">{t(message(value))}</p>
      }}
    </Show>
  )
}

const asProblem = (error: unknown): Problem =>
  error instanceof MaterialRefused
    ? { kind: 'refused', reason: error.reason }
    : error instanceof SourceRefused
      ? { kind: 'source', reason: error.reason }
      : { kind: 'failed' }

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
  const [sources, { refetch: refetchSources }] = createResource(
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
      // A transcription reads its sources first: the form offers them as they are now.
      void refetchSources()
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
          sources={sources() ?? []}
          onSourceAdded={() => void refetchSources()}
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

/** A source, or a new file to upload as one. */
type SourceChoice = number | 'upload'

const choiceOf = (value: string): SourceChoice | null =>
  value === '' ? null : value === 'upload' ? 'upload' : Number(value)

/** Material transcribed faithfully from a source the teacher uploaded, such as a scanned test, or from a file
 * uploaded here, which is read first. */
function TranscriptionForm(props: {
  courseId: number
  topicId: number
  /** The course's sources. */
  sources: Source[]
  /** A file uploaded here was added to the sources. */
  onSourceAdded: () => void
  onStarted: () => Promise<void>
  onProblem: (problem: Problem) => void
}) {
  const { t } = useI18n()
  const apis = useApi()
  const headingId = createUniqueId()
  const [sourceChoice, setSourceChoice] = createSignal<SourceChoice | null>(null)
  const [keyChoice, setKeyChoice] = createSignal<SourceChoice | null>(null)
  const [testFile, setTestFile] = createSignal<File | null>(null)
  const [keyFile, setKeyFile] = createSignal<File | null>(null)
  const [busy, setBusy] = createSignal(false)
  // Read sources, and those whose transcription will read them first; not one being read now.
  const offered = () =>
    props.sources.filter((s) => s.characters !== null || (s.job?.state !== 'queued' && s.job?.state !== 'running'))
  const testChoice = (): SourceChoice => sourceChoice() ?? offered()[0]?.id ?? 'upload'
  const missingFile = () => (testChoice() === 'upload' && !testFile()) || (keyChoice() === 'upload' && !keyFile())

  /** The chosen source, uploading the file first when a new one was chosen. */
  async function sourceOf(choice: SourceChoice, file: File | null, choose: (id: number) => void): Promise<number> {
    if (choice !== 'upload') return choice
    const { source } = await apis.sources.store(props.courseId, file!)
    // Chosen from now on, so trying again does not upload it twice.
    choose(source.id)
    props.onSourceAdded()
    return source.id
  }

  async function transcribe(event: SubmitEvent) {
    event.preventDefault()
    setBusy(true)
    props.onProblem(null)
    try {
      const source = await sourceOf(testChoice(), testFile(), setSourceChoice)
      const key = keyChoice() === null ? null : await sourceOf(keyChoice()!, keyFile(), setKeyChoice)
      await apis.materials.transcribe(props.courseId, props.topicId, source, key, [])
      setSourceChoice(null)
      setKeyChoice(null)
      setTestFile(null)
      setKeyFile(null)
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
      <SourceField
        label={t('materials.sourceToTranscribe')}
        fileLabel={t('materials.testFile')}
        sources={offered()}
        choice={testChoice()}
        onChoice={setSourceChoice}
        onFile={setTestFile}
      />
      <SourceField
        label={t('materials.keySource')}
        fileLabel={t('materials.keyFile')}
        none={t('materials.noKeySource')}
        sources={offered().filter((s) => s.id !== testChoice())}
        choice={keyChoice()}
        onChoice={setKeyChoice}
        onFile={setKeyFile}
      />
      <Show when={testChoice() === 'upload' || keyChoice() === 'upload'}>
        <p class="settings-note">{t('materials.uploadNote')}</p>
      </Show>
      <div class="settings-actions">
        <button type="submit" disabled={busy() || missingFile()}>
          {t('materials.transcribe')}
        </button>
      </div>
    </form>
  )
}

/** A choice of source, or of a new file to upload as one, with the file input it then needs. */
function SourceField(props: {
  label: string
  fileLabel: string
  /** What choosing no source is called, when that may be chosen. */
  none?: string
  sources: Source[]
  choice: SourceChoice | null
  onChoice: (choice: SourceChoice | null) => void
  onFile: (file: File | null) => void
}) {
  const { t } = useI18n()
  const name = (source: Source) =>
    source.characters === null ? t('materials.notReadYet', { name: source.name }) : source.name
  return (
    <>
      <label>
        {props.label}
        <select
          value={props.choice === null ? '' : String(props.choice)}
          onChange={(e) => {
            // A file chosen before is no longer shown, so it is not uploaded either.
            props.onFile(null)
            props.onChoice(choiceOf(e.currentTarget.value))
          }}
        >
          <Show when={props.none}>{(none) => <option value="">{none()}</option>}</Show>
          <For each={props.sources}>{(source) => <option value={source.id}>{name(source)}</option>}</For>
          <option value="upload">{t('materials.uploadNew')}</option>
        </select>
      </label>
      <Show when={props.choice === 'upload'}>
        <label>
          {props.fileLabel}
          <input
            type="file"
            accept={sourceFileTypes}
            onChange={(e) => props.onFile(e.currentTarget.files?.[0] ?? null)}
          />
        </label>
      </Show>
    </>
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
