import { A } from '@solidjs/router'
import { createResource, createSignal, For, Index, Show } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { useApi } from '../api/context'
import { DraftBadge } from '../shell/DraftBadge'
import { useI18n } from '../i18n/i18n'
import type { MessageKey } from '../i18n/messages'
import { finished } from '../jobs/api'
import { JobFailureMessage, JobStatus } from '../jobs/JobStatus'
import {
  DocumentRefused,
  referenceKinds,
  type DocumentContent,
  type DocumentRefusal,
  type ReferenceDocument,
  type ReferenceDocumentSummary,
  type ReferenceKind,
} from './api'
import './documents.css'

export const kindNames: Record<ReferenceKind, MessageKey> = {
  vocabulary: 'documents.kind.vocabulary',
  grammar: 'documents.kind.grammar',
  glossary: 'documents.kind.glossary',
}

const refusals: Record<Exclude<DocumentRefusal, 'no_provider_key'>, MessageKey> = {
  map_not_approved: 'documents.mapNotApproved',
  nothing_to_retry: 'documents.changedMeanwhile',
  unknown_source: 'documents.unknownSource',
  document_changed: 'documents.editOutdated',
}

type Problem = { kind: 'refused'; reason: DocumentRefusal } | { kind: 'failed' } | null

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
  error instanceof DocumentRefused ? { kind: 'refused', reason: error.reason } : { kind: 'failed' }

/** The reference documents of a topic: generated from its approved concept map, previewed and printed. */
export function DocumentsSection(props: {
  courseId: number
  topicId: number
  canEdit: boolean
  mapApproved: boolean
  /** The list changed: the topic's counts follow. */
  onChanged?: () => void
}) {
  const { t } = useI18n()
  const api = useApi().documents
  const [list, setList] = createStore<ReferenceDocumentSummary[]>([])
  const [kind, setKind] = createSignal<ReferenceKind>('grammar')
  const [busy, setBusy] = createSignal(false)
  const [problem, setProblem] = createSignal<Problem>(null)

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
      await api.generate(props.courseId, props.topicId, kind())
      await reload()
    } catch (error) {
      setProblem(asProblem(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section class="settings-form" aria-labelledby="documents-heading">
      <h2 id="documents-heading">{t('documents.heading')}</h2>
      <Show when={loaded.error}>
        <p role="alert">{t('documents.loadFailed')}</p>
      </Show>
      <Show when={loaded()}>
        <Show when={list.length > 0} fallback={<p>{t('documents.none')}</p>}>
          <ul class="document-list">
            <For each={list}>
              {(document) => (
                <li>
                  <DocumentCard
                    courseId={props.courseId}
                    topicId={props.topicId}
                    document={document}
                    canEdit={props.canEdit}
                    onChanged={reload}
                  />
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
      <Show when={props.canEdit}>
        <Show when={props.mapApproved} fallback={<p class="settings-note">{t('documents.approveMapFirst')}</p>}>
          <form class="topic-name" onSubmit={generate}>
            <label>
              {t('documents.kind')}
              <select value={kind()} onChange={(e) => setKind(e.currentTarget.value as ReferenceKind)}>
                <For each={referenceKinds}>{(k) => <option value={k}>{t(kindNames[k])}</option>}</For>
              </select>
            </label>
            <button type="submit" disabled={busy()}>
              {t('documents.generate')}
            </button>
          </form>
        </Show>
      </Show>
      <ProblemMessage problem={problem()} />
    </section>
  )
}

function DocumentCard(props: {
  courseId: number
  topicId: number
  document: ReferenceDocumentSummary
  canEdit: boolean
  onChanged: () => Promise<void>
}) {
  const { t } = useI18n()
  const api = useApi().documents
  const [busy, setBusy] = createSignal(false)
  const [problem, setProblem] = createSignal<Problem>(null)
  const [confirming, setConfirming] = createSignal(false)
  const [kept, setKept] = createSignal(false)
  // The full document while its text is edited.
  const [editing, setEditing] = createSignal<ReferenceDocument | null>(null)
  const headingId = `document-${props.document.id}`

  const running = () => {
    const job = props.document.job
    return job && !finished(job) ? job : null
  }
  const failure = () => (props.document.version === null && props.document.job?.state === 'failed' ? props.document.job : null)

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

  const ids = () => [props.courseId, props.topicId, props.document.id] as const

  return (
    <article class="document-card" aria-labelledby={headingId}>
      <h3 id={headingId}>{props.document.title ?? t(kindNames[props.document.kind])}</h3>
      <Show when={props.document.version}>
        {(version) => (
          <p class="settings-note">
            <DraftBadge reviewed={props.document.reviewed} />{' '}
            <span>{t('documents.kindAndVersion', { kind: t(kindNames[props.document.kind]), version: version() })}</span>
          </p>
        )}
      </Show>
      {/* Keyed by the job, so a new generation gets a fresh status that polls it. */}
      <Show when={running()?.id} keyed>
        {(_id) => <JobStatus job={running()!} onFinished={() => void props.onChanged()} />}
      </Show>
      <Show when={!running() && failure()}>
        {(job) => <JobFailureMessage kind={job().error_kind ?? 'other'} rawOutput={job().raw_output} />}
      </Show>
      <div class="settings-actions">
        <Show when={props.document.version !== null}>
          <A href={`/preview/courses/${props.courseId}/topics/${props.topicId}/documents/${props.document.id}`}>
            {t('documents.preview')}
          </A>
        </Show>
        <Show when={props.canEdit && !running()}>
          <Show when={failure()}>
            <button type="button" disabled={busy()} onClick={() => void act(() => api.retry(...ids()))}>
              {t('documents.retry')}
            </button>
          </Show>
          <Show when={props.document.version !== null && !editing()}>
            <button
              type="button"
              disabled={busy()}
              onClick={() => void act(async () => setEditing(await api.get(...ids())), false)}
            >
              {t('documents.edit')}
            </button>
            <Show when={!props.document.reviewed}>
              <button type="button" disabled={busy()} onClick={async () => setKept(await act(() => api.keep(...ids())))}>
                {t('documents.keep')}
              </button>
            </Show>
          </Show>
          <Show
            when={confirming()}
            fallback={
              <button type="button" disabled={busy()} onClick={() => setConfirming(true)}>
                {t('documents.discard')}
              </button>
            }
          >
            <button type="button" class="danger" disabled={busy()} onClick={() => void act(() => api.discard(...ids()))}>
              {t('documents.discardForGood')}
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              {t('access.cancel')}
            </button>
          </Show>
        </Show>
      </div>
      <Show when={kept()}>
        <p role="status">{t('documents.kept')}</p>
      </Show>
      <Show when={editing()} keyed>
        {(document) => (
          <DocumentEditor
            document={document}
            busy={busy()}
            onCancel={() => setEditing(null)}
            onSave={async (content) => {
              // A refused edit keeps the editor open, so the teacher's text is not lost.
              if (await act(() => api.edit(...ids(), content, document.version!))) setEditing(null)
            }}
          />
        )}
      </Show>
      <ProblemMessage problem={problem()} />
    </article>
  )
}

/** The text of a document: its title and each passage's Markdown; the citations stay as they are. */
function DocumentEditor(props: {
  document: ReferenceDocument
  busy: boolean
  onCancel: () => void
  onSave: (content: DocumentContent) => void
}) {
  const { t } = useI18n()
  const [title, setTitle] = createSignal(props.document.title ?? '')
  const [texts, setTexts] = createSignal(props.document.passages.map((p) => p.markdown))

  return (
    <form
      class="document-editor"
      onSubmit={(event) => {
        event.preventDefault()
        props.onSave({
          title: title().trim(),
          passages: props.document.passages.map((passage, i) => ({
            markdown: texts()[i],
            citations: passage.citations.map(({ source_id, location }) => ({ source_id, location })),
          })),
        })
      }}
    >
      <label>
        {t('documents.title')}
        <input required maxLength={200} value={title()} onInput={(e) => setTitle(e.currentTarget.value)} />
      </label>
      <Index each={texts()}>
        {(text, index) => (
          <label>
            {t('documents.passage', { n: index + 1 })}
            <textarea
              required
              rows={4}
              maxLength={5000}
              value={text()}
              onInput={(e) => setTexts(texts().map((value, i) => (i === index ? e.currentTarget.value : value)))}
            />
          </label>
        )}
      </Index>
      <div class="settings-actions">
        <button type="submit" disabled={props.busy}>
          {t('documents.save')}
        </button>
        <button type="button" onClick={() => props.onCancel()}>
          {t('access.cancel')}
        </button>
      </div>
    </form>
  )
}
