import { createResource, createSignal, For, Match, Show, Switch } from 'solid-js'
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
  url: 'sources.kind.url',
}

const refusals: Record<SourceRefusal, MessageKey> = {
  unsupported_type: 'sources.unsupportedType',
  too_large: 'sources.tooLarge',
  empty_file: 'sources.emptyFile',
  no_provider_key: 'sources.noKey',
  extraction_running: 'sources.running',
  snapshot_taken: 'sources.snapshotExists',
}

type Problem = SourceRefusal | 'failed' | 'badUrl' | null

const problemMessage = (problem: Exclude<Problem, null>): MessageKey =>
  problem === 'failed' ? 'courses.saveFailed' : problem === 'badUrl' ? 'sources.badUrl' : refusals[problem]

// What the backend takes as a web page's address.
const webAddress = /^https?:\/\/[^\s/?#]+/i

/** The files a course is grounded in, with the text read from each. */
/** What the teacher adds: a file, a web page or pasted text. */
type AddedKind = 'file' | 'page' | 'text'
const addedKinds: AddedKind[] = ['file', 'page', 'text']
const addedKindLabels: Record<AddedKind, MessageKey> = {
  file: 'sources.kindFile',
  page: 'sources.kindPage',
  text: 'sources.kindText',
}

export function SourcesSection(props: { courseId: number; canEdit: boolean; onChanged?: () => void }) {
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
  const [adding, setAdding] = createSignal(false)
  const [addKind, setAddKind] = createSignal<AddedKind>('file')

  async function reload() {
    try {
      setSources(reconcile(await api.list(props.courseId), { key: 'id' }))
      props.onChanged?.()
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
        <Show
          when={adding()}
          fallback={
            <div class="settings-actions">
              <button type="button" onClick={() => setAdding(true)}>
                {t('sources.addSource')}
              </button>
            </div>
          }
        >
          {/* One place to add a source, of the kind the teacher picks. */}
          <div class="settings-form panel">
            <fieldset class="source-kinds">
              <legend>{t('sources.kind')}</legend>
              <For each={addedKinds}>
                {(kind) => (
                  <label class="settings-check">
                    <input
                      type="radio"
                      name="source-kind"
                      checked={kind === addKind()}
                      onChange={() => setAddKind(kind)}
                    />
                    {t(addedKindLabels[kind])}
                  </label>
                )}
              </For>
            </fieldset>
            <Switch>
              <Match when={addKind() === 'file'}>
                <UploadForm upload={(file, ocr) => start(() => api.upload(props.courseId, file, ocr))} />
              </Match>
              <Match when={addKind() === 'page'}>
                <PageForm
                  add={(url, name) => {
                    if (!webAddress.test(url)) {
                      setProblem('badUrl')
                      return Promise.resolve(false)
                    }
                    return start(() => api.addPage(props.courseId, url, name))
                  }}
                />
              </Match>
              <Match when={addKind() === 'text'}>
                <TextForm add={(name, text) => start(() => api.addText(props.courseId, name, text))} />
              </Match>
            </Switch>
            <div class="settings-actions">
              <button type="button" class="button-secondary" onClick={() => setAdding(false)}>
                {t('sources.closeAdding')}
              </button>
            </div>
          </div>
        </Show>
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
  const { t, locale } = useI18n()
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
  const isPage = () => props.source.kind === 'url'

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
      {/* A web page has a size only once its snapshot is taken. */}
      <Show when={!isPage() || props.source.size > 0}>
        <p class="settings-note">
          {t('sources.description', { kind: t(kindNames[props.source.kind]), size: size(props.source.size, t) })}
        </p>
      </Show>
      {/* Keyed by the job, so a new extraction gets a fresh status that polls it. */}
      <Show when={running()?.id} keyed>
        {(_id) => (
          <JobStatus
            job={running()!}
            working={isPage() ? 'jobs.fetchingPage' : 'jobs.extracting'}
            onFinished={() => void props.onChanged()}
          />
        )}
      </Show>
      <Show when={!running() && failure()}>
        {(kind) => (
          // A page with no text in its HTML builds it in the browser, which no fetch runs.
          <Show when={isPage() && kind() === 'no_text'} fallback={<JobFailureMessage kind={kind()} />}>
            <p role="alert">{t('sources.pageNoText')}</p>
          </Show>
        )}
      </Show>
      <Show when={!running() && isPage() && props.source.fetched_at}>
        {(at) => (
          <p>
            {t('sources.snapshotTaken', {
              date: new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at())),
              count: String(props.source.characters ?? 0),
            })}
          </p>
        )}
      </Show>
      <Show when={!running() && !isPage() && props.source.characters !== null}>
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
        <Show
          when={isPage() && props.source.url}
          fallback={
            <a href={api.fileUrl(props.courseId, props.source.id)} target="_blank" rel="noopener">
              {t('sources.original')}
            </a>
          }
        >
          {(url) => (
            <a href={url()} target="_blank" rel="noopener noreferrer">
              {t('sources.openPage')}
            </a>
          )}
        </Show>
        {/* A page whose snapshot could not be taken; once taken, it is never fetched again. */}
        <Show when={props.canEdit && !running() && isPage() && props.source.characters === null}>
          <button type="button" disabled={busy()} onClick={() => void props.onExtract(false)}>
            {t('sources.fetchAgain')}
          </button>
        </Show>
        {/* A scan or an image not read by the assistant yet, or whose reading failed. */}
        <Show
          when={
            props.canEdit &&
            !running() &&
            props.source.kind !== 'text' &&
            !isPage() &&
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

function PageForm(props: { add: (url: string, name: string | null) => Promise<boolean> }) {
  const { t } = useI18n()
  const [url, setUrl] = createSignal('')
  const [name, setName] = createSignal('')
  const [busy, setBusy] = createSignal(false)

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    setBusy(true)
    if (await props.add(url().trim(), name().trim() || null)) {
      setUrl('')
      setName('')
    }
    setBusy(false)
  }

  return (
    <form class="settings-form" onSubmit={submit}>
      <h3>{t('sources.addPage')}</h3>
      <p class="settings-note">{t('sources.pageIntro')}</p>
      <label>
        {t('sources.pageUrl')}
        {/* Checked here rather than as type="url", so a bad address gets the app's own message. */}
        <input inputMode="url" maxLength={2000} value={url()} onInput={(e) => setUrl(e.currentTarget.value)} />
      </label>
      <label>
        {t('sources.pageName')}
        <input maxLength={200} value={name()} onInput={(e) => setName(e.currentTarget.value)} />
      </label>
      <div class="settings-actions">
        <button type="submit" disabled={busy() || url().trim() === ''}>
          {t('sources.takeSnapshot')}
        </button>
      </div>
    </form>
  )
}

function TextForm(props: { add: (name: string, text: string) => Promise<boolean> }) {
  const { t } = useI18n()
  const [name, setName] = createSignal('')
  const [text, setText] = createSignal('')
  const [busy, setBusy] = createSignal(false)

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    setBusy(true)
    if (await props.add(name().trim(), text())) {
      setName('')
      setText('')
    }
    setBusy(false)
  }

  return (
    <form class="settings-form" onSubmit={submit}>
      <h3>{t('sources.addText')}</h3>
      <p class="settings-note">{t('sources.textIntro')}</p>
      <label>
        {t('sources.textName')}
        <input maxLength={200} value={name()} onInput={(e) => setName(e.currentTarget.value)} />
      </label>
      <label>
        {t('sources.pastedText')}
        <textarea rows={8} value={text()} onInput={(e) => setText(e.currentTarget.value)} />
      </label>
      <div class="settings-actions">
        <button type="submit" disabled={busy() || name().trim() === '' || text().trim() === ''}>
          {t('sources.addTheText')}
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
