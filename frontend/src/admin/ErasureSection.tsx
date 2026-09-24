import { createResource, createSignal, createUniqueId, For, Show } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import type { Student } from '../students/api'
import type { AdminApi } from './api'

type Outcome =
  | { kind: 'erased' | 'alreadyErased'; name: string }
  | { kind: 'mismatch' }
  | { kind: 'failed' }
  | null

/**
 * Erasure of a student for a legal request (ADR 0007). It is deliberate: the admin picks the
 * student, reads what happens, and types the student's name before the button works.
 */
export function ErasureSection(props: { api: AdminApi }) {
  const { t } = useI18n()
  const students = useApi().students
  const [list, { mutate }] = createResource(() => students.list())
  const [chosen, setChosen] = createSignal('')
  const [open, setOpen] = createSignal<Student | null>(null)
  const [typed, setTyped] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [outcome, setOutcome] = createSignal<Outcome>(null)
  const headingId = createUniqueId()
  const dialogId = createUniqueId()

  const loaded = () => (list.error ? [] : (list() ?? []))
  const matches = () => {
    const student = open()
    return student !== null && typed().trim() === student.name.trim()
  }

  function start(event: SubmitEvent) {
    event.preventDefault()
    const student = loaded().find((s) => String(s.id) === chosen())
    if (!student) return
    setTyped('')
    setOutcome(null)
    setOpen(student)
  }

  async function erase(event: SubmitEvent) {
    event.preventDefault()
    const student = open()
    if (!student || !matches()) return
    setBusy(true)
    setOutcome(null)
    try {
      const result = await props.api.eraseStudent(student.id, typed())
      if (result === 'mismatch') {
        setOutcome({ kind: 'mismatch' })
        return
      }
      mutate((current) => (current ?? []).filter((s) => s.id !== student.id))
      setChosen('')
      setOpen(null)
      // Erased by someone else meanwhile: the outcome the admin wanted, told as such.
      setOutcome({ kind: result === 'already_erased' ? 'alreadyErased' : 'erased', name: student.name })
    } catch {
      setOutcome({ kind: 'failed' })
    } finally {
      setBusy(false)
    }
  }

  const erased = () => {
    const current = outcome()
    return current?.kind === 'erased' || current?.kind === 'alreadyErased' ? current : null
  }

  return (
    <section class="admin-section" aria-labelledby={headingId}>
      <h2 id={headingId}>{t('erasure.heading')}</h2>
      <p class="settings-note">{t('erasure.intro')}</p>
      <Show when={list.error}>
        <p role="alert">{t('students.loadFailed')}</p>
      </Show>
      <form class="settings-form" onSubmit={start}>
        <label>
          {t('erasure.student')}
          <select required value={chosen()} onChange={(e) => setChosen(e.currentTarget.value)}>
            <option value="">{t('classes.chooseStudent')}</option>
            <For each={loaded()}>
              {(student) => (
                <option value={String(student.id)}>
                  {student.name} ({student.email})
                </option>
              )}
            </For>
          </select>
        </label>
        <div class="settings-actions">
          <button type="submit" disabled={busy() || open() !== null}>
            {t('erasure.start')}
          </button>
        </div>
      </form>
      <Show when={open()}>
        {(student) => (
          <div class="erasure-dialog" role="dialog" aria-labelledby={dialogId}>
            <h3 id={dialogId}>{t('erasure.dialogHeading', { name: student().name })}</h3>
            <p>{t('erasure.what')}</p>
            <p>{t('erasure.instead')}</p>
            <form class="settings-form" onSubmit={erase}>
              <label>
                {t('erasure.confirm', { name: student().name })}
                <input autocomplete="off" value={typed()} onInput={(e) => setTyped(e.currentTarget.value)} />
              </label>
              <div class="settings-actions">
                <button type="submit" class="danger" disabled={busy() || !matches()}>
                  {t('erasure.erase')}
                </button>
                <button type="button" disabled={busy()} onClick={() => setOpen(null)}>
                  {t('erasure.cancel')}
                </button>
              </div>
            </form>
            <Show when={outcome()?.kind === 'mismatch'}>
              <p role="alert">{t('erasure.mismatch')}</p>
            </Show>
            <Show when={outcome()?.kind === 'failed'}>
              <p role="alert">{t('smtp.requestFailed')}</p>
            </Show>
          </div>
        )}
      </Show>
      <Show when={erased()}>
        {(done) => (
          <p role="status">
            {t(done().kind === 'erased' ? 'erasure.done' : 'erasure.alreadyDone', { name: done().name })}
          </p>
        )}
      </Show>
    </section>
  )
}
