import { A, useNavigate } from '@solidjs/router'
import { createResource, createSignal, For, Show } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'

/** The runs of a course its teacher started, and starting one for owners and editors. */
export function RunsSection(props: { courseId: number; canEdit: boolean }) {
  const { t } = useI18n()
  const api = useApi().runs
  const navigate = useNavigate()
  const [runs] = createResource(() => props.courseId, (id) => api.list(id))
  const [name, setName] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [failed, setFailed] = createSignal(false)

  async function start(event: SubmitEvent) {
    event.preventDefault()
    // `required` lets a name of spaces through.
    if (name().trim() === '') return
    setBusy(true)
    setFailed(false)
    try {
      const run = await api.start(props.courseId, name().trim())
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
                    <A href={`/runs/${run.id}`}>{run.name}</A> <span>{t('runs.rosterSize', { count: run.roster_size })}</span>
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
