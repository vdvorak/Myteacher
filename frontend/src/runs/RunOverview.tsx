import { A } from '@solidjs/router'
import { For, Show } from 'solid-js'
import { useI18n } from '../i18n/i18n'
import '../home/home.css'
import type { CourseRun, ListedRelease } from './api'

/** How the run goes: its current topic, the latest releases with how far the students got, and
 * who is behind; a new run shows the two steps that start it. */
export function RunOverview(props: { run: CourseRun; releases: ListedRelease[] | undefined; onRelease: () => void }) {
  const { t } = useI18n()
  const live = () => (props.releases ?? []).filter((r) => !r.retracted_at)
  const link = () => props.run.mode === 'link'
  // Someone to release to: enrolled students, or participants who joined a link run.
  const peopled = () => (link() ? props.run.participant_count : props.run.roster.length) > 0
  const started = () => peopled() && live().length > 0
  const latest = () => live().slice(-3).reverse()
  // Each student with the releases they did not submit by the due date.
  const behind = () => {
    const counts = new Map<number, number>()
    for (const released of live()) {
      for (const id of released.overdue_student_ids) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return props.run.roster
      .filter((s) => counts.has(s.id))
      .map((s) => ({ student: s, count: counts.get(s.id)! }))
      .sort((a, b) => b.count - a.count || a.student.name.localeCompare(b.student.name))
  }

  return (
    <Show
      when={started()}
      fallback={
        <section class="home-card" aria-labelledby="run-start">
          <h2 id="run-start">{t('runOverview.start')}</h2>
          <ol class="checklist">
            <li>
              <A
                href={`/runs/${props.run.id}?tab=${link() ? 'participants' : 'students'}`}
                class="checklist-item"
                data-state={peopled() ? 'done' : 'open'}
              >
                <span class="step-mark" aria-hidden="true">
                  {peopled() ? '✓' : 1}
                </span>
                <span>{t(link() ? 'runOverview.share' : 'runOverview.enrol')}</span>
                <span class="visually-hidden">, {t(peopled() ? 'home.stepDone' : 'home.stepOpen')}</span>
              </A>
            </li>
            <li>
              <button type="button" class="checklist-item link-button" onClick={() => props.onRelease()}>
                <span class="step-mark" aria-hidden="true">
                  2
                </span>
                <span>{t('runOverview.releaseFirst')}</span>
              </button>
            </li>
          </ol>
        </section>
      }
    >
      <div class="home">
        <p>
          {t('runOverview.currentTopic')} <strong>{live().at(-1)!.topic}</strong>
        </p>
        <section class="home-card" aria-labelledby="run-latest">
          <h2 id="run-latest">{t('runOverview.latest')}</h2>
          <ul class="home-list">
            <For each={latest()}>
              {(released) => (
                <li>
                  <A href={`/runs/${props.run.id}/releases/${released.id}`}>{released.title}</A>
                  <span class="settings-note">
                    {t('home.submitted', { submitted: released.submitted, total: released.total })}
                  </span>
                  <Show when={released.waiting > 0}>
                    <span class="badge" data-tone="attention">
                      {t('runReleases.waiting', { count: released.waiting })}
                    </span>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </section>
        <section class="home-card" aria-labelledby="run-behind">
          <h2 id="run-behind">{t('runOverview.behind')}</h2>
          <Show when={behind().length > 0} fallback={<p class="settings-note">{t('runOverview.nobodyBehind')}</p>}>
            <ul class="home-list">
              <For each={behind()}>
                {(entry) => (
                  <li>
                    <A href={`/students/${entry.student.id}`}>{entry.student.name}</A>
                    <span class="badge" data-tone="attention">
                      {t('runOverview.overdue', { count: entry.count })}
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>
      </div>
    </Show>
  )
}
