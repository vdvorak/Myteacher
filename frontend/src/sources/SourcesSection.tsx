import { createResource, createSignal, For, Show } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import type { MessageKey } from '../i18n/messages'
import { finished } from '../jobs/api'
import { JobFailureMessage, JobStatus } from '../jobs/JobStatus'
import { SourceRefused, type Source, type SourceKind, type SourceRefusal, type SourceStarted } from './api'
import './sources.css'

const kindNames: Record<SourceKind, MessageKey> = {
  pdf: 'sources.kind.pdf',
  text: 'sources.kind.text',
  image: 'sources.kind.image',
}

const refusals: Record<SourceRefusal, MessageKey> = {
  unsupported_type: 'sources.unsupportedType',
  too_large: 'sources.tooLarge',
  empty_file: 'sources.emptyFile',
  no_provider_key: 'sources.noKey',
  extraction_running: 'sources.running',
}

type Problem = SourceRefusal | 'failed' | null

const problemMessage = (problem: Exclude<Problem, null>): MessageKey =>
  problem === 'failed' ? 'courses.saveFailed' : refusals[problem]

/** The files a course is grounded in, with the text read from each. */
export function SourcesSection(props: { courseId: number; canEdit: boolean }) {
  const { t } = useI18n()
  const api = useApi().sources
  const [sources, setSources] = createStore<Source[]>([])
  const [loaded] = createResource(
    () => props.courseId,
    async (id) => {
      const list = await api.list(id)
      setSources(reconcile(list, { key: 'id' }))
      return true
    },
  )
  const [problem, setProblem] = createSignal<Problem>(null)

  async function reload() {
    try {
      setSources(reconcile(await api.list(props.courseId), { key: 'id' }))
    } catch {
      setProblem('failed')
    }
  }

  /** Starts an upload or an extraction; the list then shows its job. */
  async function start(action: () => Promise<SourceStarted>): Promise<boolean> {
    setProblem(null)
    try {
      await action()
      await reload()
      return true
    } catch (error) {
      setProblem(error instanceof SourceRefused ? error.reason : 'failed')
      return false
    }
  }

  return (
    <section class="settings-form sources" aria-labelledby="sources-heading">
      <h2 id="sources-heading">{t('sources.heading')}</h2>
      <p class="settings-note">{t('sources.intro')}</p>
      <Show when={loaded.error}>
        <p role="alert">{t('sources.loadFailed')}</p>
      </Show>
      <Show when={loaded()}>
        <Show when={sources.length > 0} fallback={<p>{t('sources.none')}</p>}>
          <ul class="source-list">
            <For each={sources}>
              {(source) => (
                <li>
                  <SourceItem
                    courseId={props.courseId}
                    source={source}
                    canEdit={props.canEdit}
                    onChanged={reload}
                    onExtract={(ocr) => start(() => api.extract(props.courseId, source.id, ocr))}
                  />
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
      <Show when={props.canEdit}>
        <UploadForm upload={(file, ocr) => start(() => api.upload(props.courseId, file, ocr))} />
      </Show>
      <Show when={problem()}>{(current) => <p role="alert">{t(problemMessage(current()))}</p>}</Show>
    </section>
  )
}

function SourceItem(props: {
  courseId: number
  source: Source
  canEdit: boolean
  onChanged: () => Promise<void>
  onExtract: (ocr: boolean) => Promise<boolean>
}) {
  const { t } = useI18n()
  const api = useApi().sources
  const [text, setText] = createSignal<string | null | undefined>(undefined)
  const [confirming, setConfirming] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  const headingId = `source-${props.source.id}`

  const running = () => {
    const job = props.source.job
    return job && !finished(job) ? job : null
  }
  const failure = () => {
    const job = props.source.job
    return job?.state === 'failed' ? job.error_kind : null
  }

  /** Runs a change, then reloads the list; says whether the change was saved. */
  async function act(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true)
    setFailed(false)
    try {
      await action()
      return true
    } catch {
      setFailed(true)
      return false
    } finally {
      setBusy(false)
      await props.onChanged()
    }
  }

  async function toggleText() {
    if (text() !== undefined) return setText(undefined)
    setBusy(true)
    setFailed(false)
    try {
      setText((await api.get(props.courseId, props.source.id)).text)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article class="source" aria-labelledby={headingId}>
      <h3 id={headingId}>{props.source.name}</h3>
      <p class="settings-note">
        {t('sources.description', { kind: t(kindNames[props.source.kind]), size: size(props.source.size, t) })}
      </p>
      {/* Keyed by the job, so a new extraction gets a fresh status that polls it. */}
      <Show when={running()?.id} keyed>
        {(_id) => <JobStatus job={running()!} working="jobs.extracting" onFinished={() => void props.onChanged()} />}
      </Show>
      <Show when={!running() && failure()}>{(kind) => <JobFailureMessage kind={kind()} />}</Show>
      <Show when={!running() && props.source.characters !== null}>
        <p>
          {t(props.source.extracted_with === 'ocr' ? 'sources.readByOcr' : 'sources.readFromFile', {
            count: String(props.source.characters),
          })}
        </p>
      </Show>
      <div class="settings-actions">
        <Show when={props.source.characters !== null}>
          <button type="button" disabled={busy()} onClick={() => void toggleText()}>
            {t(text() === undefined ? 'sources.showText' : 'sources.hideText')}
          </button>
        </Show>
        <a href={api.fileUrl(props.courseId, props.source.id)} target="_blank" rel="noopener">
          {t('sources.original')}
        </a>
        {/* A scan or an image not read by the assistant yet, or whose reading failed. */}
        <Show
          when={
            props.canEdit &&
            !running() &&
            props.source.kind !== 'text' &&
            (props.source.extracted_with !== 'ocr' || failure())
          }
        >
          <button type="button" disabled={busy()} onClick={() => void props.onExtract(true)}>
            {t('sources.readWithOcr')}
          </button>
        </Show>
      </div>
      <Show when={text() !== undefined}>
        <pre class="source-text" aria-label={t('sources.textOf', { name: props.source.name })}>
          {text() ?? ''}
        </pre>
      </Show>
      <label class="settings-check">
        <input
          type="checkbox"
          checked={props.source.visible_to_students}
          disabled={!props.canEdit || busy()}
          onChange={async (e) => {
            const box = e.currentTarget
            const visible = box.checked
            // A refused change goes back to what is saved.
            if (!(await act(() => api.change(props.courseId, props.source.id, { visible_to_students: visible })))) {
              box.checked = props.source.visible_to_students
            }
          }}
        />
        {t('sources.visible')}
      </label>
      <Show when={props.canEdit}>
        <Show
          when={confirming()}
          fallback={
            <div class="settings-actions">
              <button type="button" disabled={busy()} onClick={() => setConfirming(true)}>
                {t('sources.remove')}
              </button>
            </div>
          }
        >
          <p>{t('sources.removeConfirm')}</p>
          <div class="settings-actions">
            <button
              type="button"
              class="danger"
              disabled={busy()}
              onClick={() => void act(() => api.remove(props.courseId, props.source.id))}
            >
              {t('sources.removeForGood')}
            </button>
            <button type="button" disabled={busy()} onClick={() => setConfirming(false)}>
              {t('access.cancel')}
            </button>
          </div>
        </Show>
      </Show>
      <Show when={failed()}>
        <p role="alert">{t('courses.saveFailed')}</p>
      </Show>
    </article>
  )
}

function UploadForm(props: { upload: (file: File, ocr: boolean) => Promise<boolean> }) {
  const { t } = useI18n()
  const [file, setFile] = createSignal<File | null>(null)
  const [ocr, setOcr] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  let input!: HTMLInputElement

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    const chosen = file()
    if (!chosen) return
    setBusy(true)
    if (await props.upload(chosen, ocr())) {
      setFile(null)
      input.value = ''
    }
    setBusy(false)
  }

  return (
    <form class="settings-form" onSubmit={submit}>
      <h3>{t('sources.add')}</h3>
      <label>
        {t('sources.file')}
        <input
          ref={input}
          type="file"
          accept=".pdf,.txt,.md,.png,.jpg,.jpeg,.webp,application/pdf,text/plain,text/markdown,image/png,image/jpeg,image/webp"
          onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)}
        />
      </label>
      <label class="settings-check">
        <input type="checkbox" checked={ocr()} onChange={(e) => setOcr(e.currentTarget.checked)} />
        {t('sources.ocr')}
      </label>
      <div class="settings-actions">
        <button type="submit" disabled={busy() || file() === null}>
          {t('sources.upload')}
        </button>
      </div>
    </form>
  )
}

function size(bytes: number, t: (key: MessageKey, params?: Record<string, string>) => string) {
  if (bytes < 1024) return t('sources.bytes', { n: String(bytes) })
  if (bytes < 1024 * 1024) return t('sources.kilobytes', { n: String(Math.round(bytes / 1024)) })
  return t('sources.megabytes', { n: (bytes / (1024 * 1024)).toFixed(1) })
}
