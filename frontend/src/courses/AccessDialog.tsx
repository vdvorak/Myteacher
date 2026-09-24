import { createResource, createSignal, createUniqueId, For, Show } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import type { MessageKey } from '../i18n/messages'
import { AccessConflict, courseRights, type AccessEntry, type AccessRefusal, type CourseRight } from './api'

export const accessNames: Record<CourseRight | 'owner', MessageKey> = {
  view: 'access.view',
  fork: 'access.fork',
  edit: 'access.edit',
  owner: 'access.owner',
}

const refusals: Record<AccessRefusal, MessageKey> = {
  not_a_teacher: 'access.notATeacher',
  is_owner: 'access.isOwner',
  access_changed: 'access.changed',
}

type Problem = AccessRefusal | 'failed'

/** The owner's dialog for sharing a course: the access list, and the ownership transfer. */
export function AccessDialog(props: {
  courseId: number
  onClose: () => void
  /** The actor gave the course away, keeping the right named or none. */
  onTransferred: (kept: CourseRight | null) => void
}) {
  const { t } = useI18n()
  const api = useApi().courses
  const headingId = createUniqueId()
  const [list, { mutate, refetch }] = createResource(() => api.access(props.courseId))
  const [problem, setProblem] = createSignal<Problem | null>(null)
  const [busy, setBusy] = createSignal(false)

  /** Runs one change of the list; a refused one reloads the list, so no control shows a guess. */
  async function change(step: () => Promise<AccessEntry[]>): Promise<boolean> {
    setProblem(null)
    setBusy(true)
    try {
      mutate(await step())
      return true
    } catch (error) {
      setProblem(error instanceof AccessConflict ? error.reason : 'failed')
      if (error instanceof AccessConflict && error.reason === 'access_changed') await refetch()
      // Fresh rows put a refused choice back in its control.
      else mutate((current) => current?.map((entry) => ({ ...entry })))
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="erasure-dialog access-dialog" role="dialog" aria-labelledby={headingId}>
      <h2 id={headingId}>{t('access.heading')}</h2>
      <p class="settings-note">{t('access.intro')}</p>
      <Show when={list.error}>
        <p role="alert">{t('access.loadFailed')}</p>
      </Show>
      <Show when={!list.error && list()}>
        {(entries) => (
          <Show when={entries().length > 0} fallback={<p>{t('access.nobody')}</p>}>
            <div class="table-scroll">
              <table class="admin-table">
                <thead>
                  <tr>
                    <th scope="col">{t('access.email')}</th>
                    <th scope="col">{t('access.right')}</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  <For each={entries()}>
                    {(entry) => (
                      <tr>
                        <td>{entry.email}</td>
                        <td>
                          <select
                            aria-label={t('access.rightOf', {
                              email: entry.email,
                            })}
                            value={entry.right}
                            disabled={busy()}
                            onChange={(e) => {
                              const right = e.currentTarget.value as CourseRight
                              void change(() => api.changeAccess(props.courseId, entry.teacher_id, right))
                            }}
                          >
                            <RightOptions />
                          </select>
                        </td>
                        <td>
                          <button
                            type="button"
                            disabled={busy()}
                            aria-label={t('access.removeOf', {
                              email: entry.email,
                            })}
                            onClick={() => void change(() => api.removeAccess(props.courseId, entry.teacher_id))}
                          >
                            {t('access.remove')}
                          </button>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        )}
      </Show>
      <GrantForm busy={busy()} grant={(email, right) => change(() => api.grantAccess(props.courseId, email, right))} />
      <Show when={problem()}>
        {(current) => (
          <p role="alert">{t(current() === 'failed' ? 'courses.saveFailed' : refusals[current() as AccessRefusal])}</p>
        )}
      </Show>
      <TransferForm courseId={props.courseId} onTransferred={props.onTransferred} />
      <div class="settings-actions">
        <button type="button" onClick={() => props.onClose()}>
          {t('access.close')}
        </button>
      </div>
    </div>
  )
}

function RightOptions() {
  const { t } = useI18n()
  return <For each={courseRights}>{(right) => <option value={right}>{t(accessNames[right])}</option>}</For>
}

function GrantForm(props: { busy: boolean; grant: (email: string, right: CourseRight) => Promise<boolean> }) {
  const { t } = useI18n()
  const [email, setEmail] = createSignal('')
  const [right, setRight] = createSignal<CourseRight>('view')

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    if (await props.grant(email().trim(), right())) setEmail('')
  }

  return (
    <form class="settings-form" onSubmit={submit}>
      <h3>{t('access.grantHeading')}</h3>
      <label>
        {t('access.teacherEmail')}
        <input
          type="text"
          inputMode="email"
          required
          maxLength={320}
          value={email()}
          onInput={(e) => setEmail(e.currentTarget.value)}
        />
      </label>
      <label>
        {t('access.right')}
        <select value={right()} onChange={(e) => setRight(e.currentTarget.value as CourseRight)}>
          <RightOptions />
        </select>
      </label>
      <div class="settings-actions">
        <button type="submit" disabled={props.busy}>
          {t('access.grant')}
        </button>
      </div>
    </form>
  )
}

/** Giving the course away, confirmed in a second step because the owner may lose all access. */
function TransferForm(props: { courseId: number; onTransferred: (kept: CourseRight | null) => void }) {
  const { t } = useI18n()
  const api = useApi().courses
  const [email, setEmail] = createSignal('')
  const [kept, setKept] = createSignal<CourseRight | null>(null)
  const [confirming, setConfirming] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [problem, setProblem] = createSignal<Problem | null>(null)

  function ask(event: SubmitEvent) {
    event.preventDefault()
    setProblem(null)
    if (email().trim() !== '') setConfirming(true)
  }

  async function transfer() {
    setBusy(true)
    try {
      await api.transferOwnership(props.courseId, email().trim(), kept())
      props.onTransferred(kept())
    } catch (error) {
      setProblem(error instanceof AccessConflict ? error.reason : 'failed')
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form class="settings-form" onSubmit={ask}>
      <h3>{t('access.transferHeading')}</h3>
      <label>
        {t('access.newOwnerEmail')}
        <input
          type="text"
          inputMode="email"
          required
          maxLength={320}
          disabled={confirming()}
          value={email()}
          onInput={(e) => setEmail(e.currentTarget.value)}
        />
      </label>
      <label>
        {t('access.youKeep')}
        <select
          disabled={confirming()}
          value={kept() ?? ''}
          onChange={(e) => setKept((e.currentTarget.value || null) as CourseRight | null)}
        >
          <option value="">{t('access.keepNothing')}</option>
          <RightOptions />
        </select>
      </label>
      <Show
        when={confirming()}
        fallback={
          <div class="settings-actions">
            <button type="submit">{t('access.transfer')}</button>
          </div>
        }
      >
        <p>
          {kept() === null
            ? t('access.confirmNothing', { email: email().trim() })
            : t('access.confirmKeeping', {
                email: email().trim(),
                right: t(accessNames[kept()!]),
              })}
        </p>
        <div class="settings-actions">
          <button type="button" class="danger" disabled={busy()} onClick={() => void transfer()}>
            {t('access.confirmTransfer')}
          </button>
          <button type="button" disabled={busy()} onClick={() => setConfirming(false)}>
            {t('access.cancel')}
          </button>
        </div>
      </Show>
      <Show when={problem()}>
        {(current) => (
          <p role="alert">{t(current() === 'failed' ? 'courses.saveFailed' : refusals[current() as AccessRefusal])}</p>
        )}
      </Show>
    </form>
  )
}
