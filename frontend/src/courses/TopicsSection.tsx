import { createResource, createSignal, For, Show } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import type { MessageKey } from '../i18n/messages'
import { ApiError } from '../lesson/api'
import type { Topic } from './api'
import './courses.css'

type Problem = 'failed' | 'changedMeanwhile' | 'loadFailed' | 'nameRequired' | null

const problemMessages: Record<NonNullable<Problem>, MessageKey> = {
  failed: 'courses.saveFailed',
  changedMeanwhile: 'topics.changedMeanwhile',
  loadFailed: 'topics.loadFailed',
  nameRequired: 'topics.nameRequired',
}

/** The topics of a course in teaching order: changed by editors, read by viewers. */
export function TopicsSection(props: { courseId: number; canEdit: boolean }) {
  const { t } = useI18n()
  const api = useApi().courses
  // Reconciled by id, so a topic keeps its row (and focus) when the list is reordered.
  const [list, setList] = createStore<Topic[]>([])
  const [problem, setProblem] = createSignal<Problem>(null)
  const [busy, setBusy] = createSignal(false)
  const [drafts, setDrafts] = createSignal<Record<number, string>>({})
  const [newName, setNewName] = createSignal('')
  const [removing, setRemoving] = createSignal<number | null>(null)

  const show = (topics: Topic[]) => setList(reconcile(topics, { key: 'id' }))
  const [loaded, { refetch }] = createResource(
    () => props.courseId,
    async (id) => {
      try {
        show(await api.topics(id))
        return true
      } catch {
        setProblem('loadFailed')
        return false
      }
    },
  )

  async function run(action: () => Promise<Topic[]>): Promise<boolean> {
    setBusy(true)
    setProblem(null)
    try {
      show(await action())
      return true
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // Someone else added, removed or moved a topic meanwhile: show their list.
        setProblem('changedMeanwhile')
        await refetch()
      } else {
        setProblem('failed')
      }
      return false
    } finally {
      setBusy(false)
    }
  }

  const draftOf = (topic: Topic) => drafts()[topic.id] ?? topic.name
  const forgetDraft = (id: number) => {
    const { [id]: _, ...rest } = drafts()
    setDrafts(rest)
  }

  async function rename(event: SubmitEvent, topic: Topic) {
    event.preventDefault()
    const name = draftOf(topic).trim()
    // `required` lets a name of spaces through.
    if (name === '') return setProblem('nameRequired')
    if (await run(() => api.changeTopic(props.courseId, topic.id, { name }))) {
      forgetDraft(topic.id)
    }
  }

  function move(index: number, by: -1 | 1) {
    const ids = list.map((topic) => topic.id)
    ;[ids[index], ids[index + by]] = [ids[index + by], ids[index]]
    void run(() => api.reorderTopics(props.courseId, ids))
  }

  async function add(event: SubmitEvent) {
    event.preventDefault()
    const name = newName().trim()
    if (name === '') return setProblem('nameRequired')
    if (await run(() => api.addTopic(props.courseId, name))) setNewName('')
  }

  async function remove(topic: Topic) {
    if (await run(() => api.removeTopic(props.courseId, topic.id))) {
      setRemoving(null)
      forgetDraft(topic.id)
    }
  }

  return (
    <section class="settings-form" aria-labelledby="topics-heading">
      <h2 id="topics-heading">{t('topics.heading')}</h2>
      <Show when={loaded()}>
        <Show when={list.length > 0} fallback={<p>{t('topics.none')}</p>}>
          <Show
            when={props.canEdit}
            fallback={
              <ol class="topic-list" aria-labelledby="topics-heading">
                <For each={list}>
                  {(topic) => (
                    <li>
                      {topic.name}
                      {topic.diagnostic_wanted ? ` (${t('topics.diagnosticNote')})` : ''}
                    </li>
                  )}
                </For>
              </ol>
            }
          >
            <ol class="topic-list" aria-labelledby="topics-heading">
              <For each={list}>
                {(topic, index) => (
                  <li class="topic">
                    <form class="topic-name" onSubmit={(e) => rename(e, topic)}>
                      <input
                        required
                        maxLength={200}
                        aria-label={t('topics.nameOf', { n: index() + 1 })}
                        value={draftOf(topic)}
                        onInput={(e) => setDrafts({ ...drafts(), [topic.id]: e.currentTarget.value })}
                      />
                      <button type="submit" disabled={busy()}>
                        {t('topics.rename')}
                      </button>
                    </form>
                    <label class="settings-check">
                      <input
                        type="checkbox"
                        checked={topic.diagnostic_wanted}
                        disabled={busy()}
                        onChange={async (e) => {
                          const box = e.currentTarget
                          const change = { diagnostic_wanted: box.checked }
                          // A refused change puts the box back.
                          if (!(await run(() => api.changeTopic(props.courseId, topic.id, change)))) {
                            box.checked = topic.diagnostic_wanted
                          }
                        }}
                      />
                      {t('topics.diagnosticWanted')}
                    </label>
                    <div class="settings-actions">
                      <button type="button" disabled={busy() || index() === 0} onClick={() => move(index(), -1)}>
                        {t('topics.moveUp')}
                      </button>
                      <button
                        type="button"
                        disabled={busy() || index() === list.length - 1}
                        onClick={() => move(index(), 1)}
                      >
                        {t('topics.moveDown')}
                      </button>
                      <Show
                        when={removing() === topic.id}
                        fallback={
                          <button type="button" disabled={busy()} onClick={() => setRemoving(topic.id)}>
                            {t('topics.remove')}
                          </button>
                        }
                      >
                        <button type="button" class="danger" disabled={busy()} onClick={() => remove(topic)}>
                          {t('topics.removeForGood', { name: topic.name })}
                        </button>
                        <button type="button" onClick={() => setRemoving(null)}>
                          {t('topics.keep')}
                        </button>
                      </Show>
                    </div>
                  </li>
                )}
              </For>
            </ol>
          </Show>
        </Show>
      </Show>
      <Show when={props.canEdit}>
        <form class="topic-name" onSubmit={add}>
          <label>
            {t('topics.new')}
            <input required maxLength={200} value={newName()} onInput={(e) => setNewName(e.currentTarget.value)} />
          </label>
          <button type="submit" disabled={busy()}>
            {t('topics.add')}
          </button>
        </form>
      </Show>
      <Show when={problem()}>
        {(current) => (
          <p role="alert">
            {t(problemMessages[current()])}
          </p>
        )}
      </Show>
    </section>
  )
}
