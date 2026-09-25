import { createEffect, createResource, createSignal, For, Show, untrack } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import type { MessageKey } from '../i18n/messages'
import { defaultSettings, ReleaseRefused, type CourseRun, type Release, type ReleaseRefusal, type ReleaseSettings } from './api'

const refusalMessages: Record<ReleaseRefusal, MessageKey> = {
  unknown_material: 'releases.unknownMaterial',
  unknown_version: 'releases.unknownMaterial',
  not_in_run: 'releases.notInRun',
  due_in_the_past: 'releases.dueInThePast',
}

const feedbackNames: Record<ReleaseSettings['feedback_mode'], MessageKey> = {
  immediate: 'releases.immediate',
  at_the_end: 'releases.atTheEnd',
}
const lateNames: Record<ReleaseSettings['late_submissions'], MessageKey> = {
  accept: 'releases.lateAccepted',
  refuse: 'releases.lateRefused',
}
const attemptNames: Record<ReleaseSettings['attempts'], MessageKey> = {
  one: 'releases.oneAttempt',
  repeated: 'releases.repeatedAttempts',
}

/** The releases of a run, and releasing a version of the course's classroom material to it. */
export function ReleasesSection(props: { run: CourseRun }) {
  const { t, locale } = useI18n()
  const api = useApi().runs
  const [materials] = createResource(() => props.run.id, (id) => api.materials(id))
  const [releases, { mutate }] = createResource(() => props.run.id, (id) => api.releases(id))
  const [materialId, setMaterialId] = createSignal('')
  const [version, setVersion] = createSignal('')
  const [audience, setAudience] = createSignal<'run' | 'chosen'>('run')
  const [chosen, setChosen] = createSignal<number[]>([])
  const [settings, setSettings] = createSignal<ReleaseSettings>({ ...defaultSettings })
  const [due, setDue] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [problem, setProblem] = createSignal<MessageKey | null>(null)

  const available = () => (materials.error ? [] : (materials() ?? []))
  const material = () => available().find((m) => String(m.id) === materialId())
  const onRoster = () => new Set(props.run.roster.map((s) => s.id))
  // A student unenrolled meanwhile loses their checkbox, so they no longer count as chosen.
  const stillChosen = () => chosen().filter((id) => onRoster().has(id))

  // A newly chosen material starts on its latest version, for the students it was made for.
  createEffect(() => {
    const current = material()
    setVersion(current ? String(current.versions[0]) : '')
    // Only a new material resets the choice, not a change of the roster.
    setChosen(current ? untrack(() => current.target_student_ids.filter((id) => onRoster().has(id))) : [])
  })

  const change = <K extends keyof ReleaseSettings>(key: K, value: ReleaseSettings[K]) =>
    setSettings({ ...settings(), [key]: value })
  const toggle = (id: number, on: boolean) =>
    setChosen(on ? [...chosen(), id] : chosen().filter((other) => other !== id))

  async function release(event: SubmitEvent) {
    event.preventDefault()
    const current = material()
    if (!current) return
    setBusy(true)
    setProblem(null)
    try {
      const released = await api.release(props.run.id, {
        material_id: current.id,
        version: Number(version()),
        audience: audience(),
        student_ids: audience() === 'chosen' ? [...stillChosen()].sort((a, b) => a - b) : null,
        ...settings(),
        // The browser gives local time without a zone; the server gets it with one.
        due_at: due() === '' ? null : new Date(due()).toISOString(),
      })
      mutate((list) => [...(list ?? []), released])
      setMaterialId('')
      setAudience('run')
      setSettings({ ...defaultSettings })
      setDue('')
    } catch (error) {
      setProblem(error instanceof ReleaseRefused ? refusalMessages[error.reason] : 'releases.failed')
    } finally {
      setBusy(false)
    }
  }

  const audienceOf = (released: Release) =>
    released.audience === 'run' ? t('releases.wholeRun') : released.students.map((s) => s.name).join(', ')

  return (
    <section class="settings-form" aria-labelledby="releases-heading">
      <h2 id="releases-heading">{t('releases.heading')}</h2>
      <Show when={releases.error}>
        <p role="alert">{t('releases.loadFailed')}</p>
      </Show>
      <Show when={!releases.error && releases()}>
        {(list) => (
          <Show when={list().length > 0} fallback={<p>{t('releases.none')}</p>}>
            <div class="table-scroll">
              <table class="admin-table" aria-label={t('releases.heading')}>
                <thead>
                  <tr>
                    <th scope="col">{t('releases.material')}</th>
                    <th scope="col">{t('releases.topic')}</th>
                    <th scope="col">{t('releases.version')}</th>
                    <th scope="col">{t('releases.audience')}</th>
                    <th scope="col">{t('releases.feedback')}</th>
                    <th scope="col">{t('releases.due')}</th>
                    <th scope="col">{t('releases.late')}</th>
                    <th scope="col">{t('releases.attempts')}</th>
                    <th scope="col">{t('releases.solutions')}</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={list()}>
                    {(released) => (
                      <tr>
                        <td>{released.title}</td>
                        <td>{released.topic}</td>
                        <td>{released.version}</td>
                        <td>{audienceOf(released)}</td>
                        <td>{t(feedbackNames[released.feedback_mode])}</td>
                        <td>{released.due_at ? new Date(released.due_at).toLocaleString(locale()) : t('releases.noDue')}</td>
                        <td>{t(lateNames[released.late_submissions])}</td>
                        <td>{t(attemptNames[released.attempts])}</td>
                        <td>{t(released.show_solutions ? 'releases.solutionsShown' : 'releases.solutionsHidden')}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        )}
      </Show>

      <h3>{t('releases.new')}</h3>
      <Show when={materials()?.length === 0}>
        <p>{t('releases.noMaterial')}</p>
      </Show>
      <Show when={available().length > 0}>
        <form onSubmit={release}>
          <label>
            {t('releases.material')}
            <select required value={materialId()} onChange={(e) => setMaterialId(e.currentTarget.value)}>
              <option value="">{t('releases.chooseMaterial')}</option>
              <For each={available()}>
                {(m) => (
                  <option value={String(m.id)}>
                    {m.title} ({m.topic})
                  </option>
                )}
              </For>
            </select>
          </label>
          <Show when={material()}>
            {(current) => (
              <>
                <label>
                  {t('releases.version')}
                  <select value={version()} onChange={(e) => setVersion(e.currentTarget.value)}>
                    <For each={current().versions}>{(n) => <option value={String(n)}>{n}</option>}</For>
                  </select>
                </label>
                <label class="settings-check">
                  <input
                    type="radio"
                    name="audience"
                    checked={audience() === 'run'}
                    onChange={() => setAudience('run')}
                  />
                  {t('releases.toWholeRun')}
                </label>
                <label class="settings-check">
                  <input
                    type="radio"
                    name="audience"
                    checked={audience() === 'chosen'}
                    onChange={() => setAudience('chosen')}
                  />
                  {t('releases.toChosen')}
                </label>
                <Show when={audience() === 'chosen'}>
                  <fieldset aria-label={t('releases.toChosen')}>
                    <For each={props.run.roster}>
                      {(student) => (
                        <label class="settings-check">
                          <input
                            type="checkbox"
                            checked={chosen().includes(student.id)}
                            onChange={(e) => toggle(student.id, e.currentTarget.checked)}
                          />
                          {student.name}
                        </label>
                      )}
                    </For>
                  </fieldset>
                </Show>
                <label>
                  {t('releases.feedback')}
                  <select
                    value={settings().feedback_mode}
                    onChange={(e) => change('feedback_mode', e.currentTarget.value as ReleaseSettings['feedback_mode'])}
                  >
                    <option value="immediate">{t('releases.immediate')}</option>
                    <option value="at_the_end">{t('releases.atTheEnd')}</option>
                  </select>
                </label>
                <label>
                  {t('releases.due')}
                  <input type="datetime-local" value={due()} onInput={(e) => setDue(e.currentTarget.value)} />
                </label>
                <label>
                  {t('releases.late')}
                  <select
                    value={settings().late_submissions}
                    onChange={(e) =>
                      change('late_submissions', e.currentTarget.value as ReleaseSettings['late_submissions'])
                    }
                  >
                    <option value="accept">{t('releases.lateAccepted')}</option>
                    <option value="refuse">{t('releases.lateRefused')}</option>
                  </select>
                </label>
                <label>
                  {t('releases.attempts')}
                  <select
                    value={settings().attempts}
                    onChange={(e) => change('attempts', e.currentTarget.value as ReleaseSettings['attempts'])}
                  >
                    <option value="one">{t('releases.oneAttempt')}</option>
                    <option value="repeated">{t('releases.repeatedAttempts')}</option>
                  </select>
                </label>
                <label class="settings-check">
                  <input
                    type="checkbox"
                    checked={settings().show_solutions}
                    onChange={(e) => change('show_solutions', e.currentTarget.checked)}
                  />
                  {t('releases.showSolutions')}
                </label>
              </>
            )}
          </Show>
          <div class="settings-actions">
            <button type="submit" disabled={busy() || !material() || (audience() === 'chosen' && stillChosen().length === 0)}>
              {t('releases.release')}
            </button>
          </div>
        </form>
      </Show>
      <Show when={problem()}>{(key) => <p role="alert">{t(key())}</p>}</Show>
    </section>
  )
}
