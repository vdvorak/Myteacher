import { A } from '@solidjs/router'
import { createResource, For, Show } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import type { StudentRelease } from './api'
import './work.css'

// Work due within this long is due soon.
const SOON_MS = 2 * 24 * 60 * 60 * 1000
// How many done pieces show before the rest are folded away.
const RECENT_DONE = 3

type Due = 'overdue' | 'soon' | 'later'

const dueOf = (release: StudentRelease, now: number): Due | null => {
  if (release.due_at === null) return null
  const at = Date.parse(release.due_at)
  return at < now ? 'overdue' : at - now <= SOON_MS ? 'soon' : 'later'
}

/** Done: submitted, or withdrawn by the teacher. */
const isDone = (release: StudentRelease) => release.state === 'submitted' || release.retraction?.whole_release === true

/** Overdue first, then by due date, then the new ones, the latest first. */
function byUrgency(a: StudentRelease, b: StudentRelease): number {
  const due = (r: StudentRelease) => (r.due_at === null ? Number.POSITIVE_INFINITY : Date.parse(r.due_at))
  return due(a) - due(b) || Date.parse(b.released_at) - Date.parse(a.released_at)
}

/** The student's work on a phone: what is to do, the most urgent first, and what is done. */
export function MyWork() {
  const { t } = useI18n()
  const api = useApi().attempts
  const [releases] = createResource(() => api.releases())
  const list = () => (releases.error ? [] : (releases() ?? []))
  const toDo = () => list().filter((r) => !isDone(r)).sort(byUrgency)
  const done = () => list().filter(isDone)

  return (
    <div class="student-home">
      <Show when={releases.error}>
        <p role="alert">{t('work.loadFailed')}</p>
      </Show>
      <Show when={releases.state === 'ready' && list().length === 0}>
        <p class="student-empty">{t('home.studentPlaceholder')}</p>
      </Show>
      <Show when={toDo().length > 0}>
        <section aria-labelledby="to-do-heading">
          <h2 id="to-do-heading">{t('work.toDo')}</h2>
          <ul class="work-cards">
            <For each={toDo()}>{(release) => <ToDoCard release={release} />}</For>
          </ul>
        </section>
      </Show>
      <Show when={done().length > 0}>
        <section aria-labelledby="done-heading">
          <h2 id="done-heading">{t('work.done')}</h2>
          <ul class="work-cards">
            <For each={done().slice(0, RECENT_DONE)}>{(release) => <DoneCard release={release} />}</For>
          </ul>
          <Show when={done().length > RECENT_DONE}>
            <details class="work-older">
              <summary>{t('work.older', { count: done().length - RECENT_DONE })}</summary>
              <ul class="work-cards">
                <For each={done().slice(RECENT_DONE)}>{(release) => <DoneCard release={release} />}</For>
              </ul>
            </details>
          </Show>
        </section>
      </Show>
    </div>
  )
}

function ToDoCard(props: { release: StudentRelease }) {
  const { t, locale } = useI18n()
  const due = () => dueOf(props.release, Date.now())
  const date = (at: string) => new Date(at).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })
  const progress = () => props.release.progress
  return (
    <li>
      <article class="work-card" data-state={due() === 'overdue' ? 'overdue' : undefined} aria-labelledby={`work-${props.release.id}`}>
        <p class="work-card-meta">
          <span>{props.release.course}</span>
          <Show when={props.release.due_at}>
            {(at) => (
              <span class="work-due" data-tone={due() === 'overdue' ? 'incorrect' : due() === 'soon' ? 'warning' : undefined}>
                {due() === 'overdue' ? t('work.overdueSince', { date: date(at()) }) : t('work.due', { date: date(at()) })}
              </span>
            )}
          </Show>
        </p>
        <h3 id={`work-${props.release.id}`}>{props.release.title}</h3>
        <Show when={props.release.retraction}>
          {(notice) => <p class="work-notice">{t('work.retracted.attemptShort', { reason: notice().reason })}</p>}
        </Show>
        <A
          href={`/work/${props.release.id}`}
          class="work-action"
          data-variant={props.release.state === 'in_progress' ? 'filled' : 'outlined'}
          aria-describedby={`work-${props.release.id}`}
        >
          {props.release.state === 'in_progress' && progress()
            ? t('work.continue', { answered: progress()!.answered, total: progress()!.total })
            : // Past a refusing due date nothing can be started; the page says why.
              t(props.release.can_start ? 'work.start' : 'work.open')}
        </A>
      </article>
    </li>
  )
}

function DoneCard(props: { release: StudentRelease }) {
  const { t } = useI18n()
  const score = () => props.release.score
  return (
    <li>
      <article class="work-card" aria-labelledby={`work-${props.release.id}`}>
        <p class="work-card-meta">
          <span>{props.release.course}</span>
          <Show when={props.release.new_assessment}>
            <span class="badge work-new">{t('work.newAssessment')}</span>
          </Show>
        </p>
        <h3 id={`work-${props.release.id}`}>{props.release.title}</h3>
        <Show when={props.release.retraction}>
          {(notice) => (
            <p class="work-notice">
              {notice().whole_release
                ? t('work.retracted.release', { reason: notice().reason })
                : t('work.retracted.attemptShort', { reason: notice().reason })}
            </p>
          )}
        </Show>
        <Show when={!props.release.retraction?.whole_release && score()}>
          {(found) => (
            <>
              <p class="work-score">
                {t('work.percent', { percent: Math.round((found().points / Math.max(found().total, 1)) * 100) })}
              </p>
              <Show when={found().pending > 0}>
                <p class="settings-note">{t('work.pendingWritten')}</p>
              </Show>
            </>
          )}
        </Show>
        <Show when={!props.release.retraction?.whole_release}>
          <A
            href={`/work/${props.release.id}`}
            class="work-action"
            data-variant="outlined"
            aria-describedby={`work-${props.release.id}`}
          >
            {t('work.open')}
          </A>
        </Show>
      </article>
    </li>
  )
}
