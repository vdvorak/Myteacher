import { A } from '@solidjs/router'
import { createEffect, createResource, createSignal, For, Match, on, Show, Switch } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import type { MessageKey } from '../i18n/messages'
import { Dialog } from '../shell/Dialog'
import './runs.css'
import { defaultSettings, ReleaseRefused, type Release, type ReleaseRefusal, type ReleaseSettings } from './api'

const refusalMessages: Record<ReleaseRefusal, MessageKey> = {
  unknown_material: 'releases.unknownMaterial',
  unknown_version: 'releases.unknownMaterial',
  not_in_run: 'releases.notInRun',
  due_in_the_past: 'releases.dueInThePast',
}

export const feedbackNames: Record<ReleaseSettings['feedback_mode'], MessageKey> = {
  immediate: 'releases.immediate',
  at_the_end: 'releases.atTheEnd',
}
export const lateNames: Record<ReleaseSettings['late_submissions'], MessageKey> = {
  accept: 'releases.lateAccepted',
  refuse: 'releases.lateRefused',
}
export const attemptNames: Record<ReleaseSettings['attempts'], MessageKey> = {
  one: 'releases.oneAttempt',
  repeated: 'releases.repeatedAttempts',
}

/** Releasing a version of a classroom material to a run: the settings, then a summary to confirm.
 * Opened from a run, the material is chosen; opened from a material, the run is. */
export function ReleaseDialog(props: {
  courseId: number
  runId?: number
  materialId?: number
  onClose: () => void
  onReleased: (runId: number, release: Release) => void
}) {
  const { t, locale } = useI18n()
  const api = useApi().runs
  const [courseRuns] = createResource(
    () => (props.runId === undefined ? props.courseId : false),
    (courseId) => api.list(courseId),
  )
  const [runId, setRunId] = createSignal(props.runId === undefined ? '' : String(props.runId))
  const [run] = createResource(() => Number(runId()) || false, (id) => api.get(id))
  const [materials] = createResource(() => Number(runId()) || false, (id) => api.materials(id))
  const [materialId, setMaterialId] = createSignal(props.materialId === undefined ? '' : String(props.materialId))
  const [version, setVersion] = createSignal('')
  const [audience, setAudience] = createSignal<'run' | 'chosen'>('run')
  const [chosen, setChosen] = createSignal<number[]>([])
  const [settings, setSettings] = createSignal<ReleaseSettings>({ ...defaultSettings })
  const [due, setDue] = createSignal('')
  const [confirming, setConfirming] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [problem, setProblem] = createSignal<MessageKey | null>(null)

  const available = () => (materials.error ? [] : (materials() ?? []))
  const material = () => available().find((m) => String(m.id) === materialId())
  const roster = () => (run.error ? [] : (run()?.roster ?? []))
  // A student unenrolled meanwhile loses their checkbox, so they no longer count as chosen.
  const stillChosen = () => chosen().filter((id) => roster().some((s) => s.id === id))
  const audienceSize = () => (audience() === 'run' ? roster().length : stillChosen().length)

  // A material starts on its latest version, for the students it was made for.
  createEffect(
    on([material, run], ([current, found]) => {
      setVersion(current ? String(current.versions[0]) : '')
      const onRoster = new Set((found?.roster ?? []).map((s) => s.id))
      setChosen(current ? current.target_student_ids.filter((id) => onRoster.has(id)) : [])
    }),
  )

  const change = <K extends keyof ReleaseSettings>(key: K, value: ReleaseSettings[K]) =>
    setSettings({ ...settings(), [key]: value })
  const toggle = (id: number, on: boolean) => setChosen(on ? [...chosen(), id] : chosen().filter((other) => other !== id))
  const ready = () => material() !== undefined && (audience() === 'run' || stillChosen().length > 0)
  const dueAt = () => (due() === '' ? null : new Date(due()).toISOString())

  async function release() {
    const current = material()
    if (!current) return
    setBusy(true)
    setProblem(null)
    try {
      const released = await api.release(Number(runId()), {
        material_id: current.id,
        version: Number(version()),
        audience: audience(),
        student_ids: audience() === 'chosen' ? [...stillChosen()].sort((a, b) => a - b) : null,
        ...settings(),
        // The browser gives local time without a zone; the server gets it with one.
        due_at: dueAt(),
      })
      props.onReleased(Number(runId()), released)
      props.onClose()
    } catch (error) {
      setProblem(error instanceof ReleaseRefused ? refusalMessages[error.reason] : 'releases.failed')
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={t('releases.dialogTitle')} onClose={props.onClose}>
      <Switch>
        <Match when={!confirming()}>
          <form
            class="release-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (ready()) setConfirming(true)
            }}
          >
            <Show when={props.runId === undefined}>
              <Show
                when={(courseRuns() ?? []).length > 0}
                fallback={
                  <Show when={courseRuns.state === 'ready'}>
                    <p>{t('releases.noRunToReleaseIn')}</p>
                    <p>
                      <A class="button-link" href={`/courses/${props.courseId}?tab=runs`}>
                        {t('releases.toRuns')}
                      </A>
                    </p>
                  </Show>
                }
              >
                <label>
                  {t('releases.run')}
                  <select required value={runId()} onChange={(e) => setRunId(e.currentTarget.value)}>
                    <option value="">{t('releases.chooseRun')}</option>
                    <For each={courseRuns()}>{(r) => <option value={String(r.id)}>{r.name}</option>}</For>
                  </select>
                </label>
              </Show>
            </Show>
            <Show when={props.materialId === undefined && runId() !== ''}>
              <Show when={materials()?.length === 0}>
                <p>{t('releases.noMaterial')}</p>
                <p>
                  <A class="button-link" href={`/courses/${props.courseId}?tab=topics`}>
                    {t('emptyState.toTopics')}
                  </A>
                </p>
              </Show>
              <Show when={available().length > 0}>
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
              </Show>
            </Show>
            <Show when={material()}>
              {(current) => (
                <>
                  <Show when={props.materialId !== undefined}>
                    <p>
                      <strong>{current().title}</strong> <span class="settings-note">{current().topic}</span>
                    </p>
                  </Show>
                  <label>
                    {t('releases.version')}
                    <select value={version()} onChange={(e) => setVersion(e.currentTarget.value)}>
                      <For each={current().versions}>{(n) => <option value={String(n)}>{n}</option>}</For>
                    </select>
                  </label>
                  <fieldset>
                    <legend>{t('releases.audience')}</legend>
                    <label class="settings-check">
                      <input type="radio" name="audience" checked={audience() === 'run'} onChange={() => setAudience('run')} />
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
                      <div role="group" aria-label={t('releases.toChosen')}>
                        <For each={roster()}>
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
                      </div>
                    </Show>
                  </fieldset>
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
                      onChange={(e) => change('late_submissions', e.currentTarget.value as ReleaseSettings['late_submissions'])}
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
            <Show when={props.materialId !== undefined && runId() !== '' && materials.state === 'ready' && !material()}>
              <p role="alert">{t('releases.notReleasableHere')}</p>
            </Show>
            <div class="dialog-actions">
              <button type="button" class="button-secondary" onClick={() => props.onClose()}>
                {t('access.cancel')}
              </button>
              <button type="submit" disabled={!ready()}>
                {t('releases.review')}
              </button>
            </div>
          </form>
        </Match>
        <Match when={confirming() && material()}>
          {(current) => (
            <section aria-label={t('releases.summary')} class="release-summary">
              <p>
                <strong>{t('releases.summarySees', { count: audienceSize() })}</strong>
              </p>
              <dl class="settings-list">
                <dt>{t('releases.material')}</dt>
                <dd>{t('releases.materialVersion', { title: current().title, version: version() })}</dd>
                <dt>{t('releases.run')}</dt>
                <dd>{run()?.name}</dd>
                <dt>{t('releases.audience')}</dt>
                <dd>
                  {audience() === 'run'
                    ? t('releases.wholeRun')
                    : roster()
                        .filter((s) => stillChosen().includes(s.id))
                        .map((s) => s.name)
                        .join(', ')}
                </dd>
                <dt>{t('releases.feedback')}</dt>
                <dd>{t(feedbackNames[settings().feedback_mode])}</dd>
                <dt>{t('releases.due')}</dt>
                <dd>{dueAt() ? new Date(dueAt()!).toLocaleString(locale()) : t('releases.noDue')}</dd>
                <dt>{t('releases.late')}</dt>
                <dd>{t(lateNames[settings().late_submissions])}</dd>
                <dt>{t('releases.attempts')}</dt>
                <dd>{t(attemptNames[settings().attempts])}</dd>
                <dt>{t('releases.solutions')}</dt>
                <dd>{t(settings().show_solutions ? 'releases.solutionsShown' : 'releases.solutionsHidden')}</dd>
              </dl>
              <div class="dialog-actions">
                <button type="button" class="button-secondary" onClick={() => setConfirming(false)}>
                  {t('releases.back')}
                </button>
                <button type="button" disabled={busy()} onClick={() => void release()}>
                  {t('releases.release')}
                </button>
              </div>
            </section>
          )}
        </Match>
      </Switch>
      <Show when={problem()}>{(key) => <p role="alert">{t(key())}</p>}</Show>
    </Dialog>
  )
}
