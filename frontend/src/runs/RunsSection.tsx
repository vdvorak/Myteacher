import { A, useNavigate } from '@solidjs/router'
import { createResource, createSignal, For, Show } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import type { RunMode } from './api'

const DEFAULT_CAPACITY = 30
/** Kept in step with the backend's maximum. */
const MAX_CAPACITY = 200

/** The runs of a course its teacher started, and starting one for owners and editors. */
export function RunsSection(props: { courseId: number; canEdit: boolean }) {
  const { t } = useI18n()
  const api = useApi().runs
  const navigate = useNavigate()
  const [runs] = createResource(() => props.courseId, (id) => api.list(id))
  const [name, setName] = createSignal('')
  const [mode, setMode] = createSignal<RunMode>('enrolled')
  const [capacity, setCapacity] = createSignal(DEFAULT_CAPACITY)
  const [responsible, setResponsible] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  const [unconfirmed, setUnconfirmed] = createSignal(false)

  async function start(event: SubmitEvent) {
    event.preventDefault()
    // `required` lets a name of spaces through.
    if (name().trim() === '') return
    const link = mode() === 'link'
    setUnconfirmed(link && !responsible())
    if (unconfirmed()) return
    setBusy(true)
    setFailed(false)
    try {
      const run = await api.start(
        props.courseId,
        link
          ? {
              name: name().trim(),
              mode: 'link',
              capacity: Math.min(MAX_CAPACITY, Math.max(1, Math.round(capacity()) || DEFAULT_CAPACITY)),
              responsible: true,
            }
          : { name: name().trim(), mode: 'enrolled' },
      )
      navigate(`/runs/${run.id}`)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section class="settings-form" aria-labelledby="runs-heading">
      <h2 id="runs-heading">{t('runs.heading')}</h2>
      <p class="settings-note">{t('runs.intro')}</p>
      <Show when={runs.error}>
        <p role="alert">{t('runs.loadFailed')}</p>
      </Show>
      <Show when={!runs.error && runs()}>
        {(list) => (
          <Show when={list().length > 0} fallback={<p>{t('runs.none')}</p>}>
            <ul aria-labelledby="runs-heading">
              <For each={list()}>
                {(run) => (
                  <li>
                    <A href={`/runs/${run.id}`}>{run.name}</A>{' '}
                    <span>
                      {t(run.mode === 'link' ? 'runs.participantCount' : 'runs.rosterSize', { count: run.roster_size })}
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        )}
      </Show>
      <Show when={props.canEdit}>
        <form onSubmit={start}>
          <label>
            {t('runs.name')}
            <input required maxLength={200} value={name()} onInput={(e) => setName(e.currentTarget.value)} />
          </label>
          <fieldset class="run-mode">
            <legend>{t('runs.for')}</legend>
            <label>
              <input
                type="radio"
                name="run-mode"
                checked={mode() === 'enrolled'}
                onChange={() => setMode('enrolled')}
              />
              {t('runs.forEnrolled')}
            </label>
            <label>
              <input
                type="radio"
                name="run-mode"
                checked={mode() === 'link'}
                onChange={() => setMode('link')}
              />
              {t('runs.forLink')}
            </label>
            <Show when={mode() === 'link'}>
              <p class="settings-note">{t('runs.forLinkNote')}</p>
              <label>
                {t('runs.capacity')}
                <input
                  type="number"
                  required
                  min={1}
                  max={MAX_CAPACITY}
                  value={capacity()}
                  onInput={(e) => setCapacity(e.currentTarget.valueAsNumber)}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  required
                  checked={responsible()}
                  onChange={(e) => setResponsible(e.currentTarget.checked)}
                />
                {t('runs.responsible')}
              </label>
            </Show>
          </fieldset>
          <Show when={unconfirmed()}>
            <p role="alert">{t('runs.responsibleMissing')}</p>
          </Show>
          <div class="settings-actions">
            <button type="submit" disabled={busy()}>
              {t('runs.start')}
            </button>
          </div>
        </form>
        <Show when={failed()}>
          <p role="alert">{t('runs.startFailed')}</p>
        </Show>
      </Show>
    </section>
  )
}
