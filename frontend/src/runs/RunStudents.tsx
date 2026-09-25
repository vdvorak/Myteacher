import { A } from '@solidjs/router'
import { createResource, createSignal, For, Show } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import { Dialog } from '../shell/Dialog'
import './runs.css'
import { useConfirm } from '../shell/confirm'
import { stateNames } from '../students/StudentsPage'
import type { CourseRun } from './api'

/** Everyone in the run in one list, saying how each is enrolled; the classes as chips above. */
export function RunStudents(props: { run: CourseRun; onChanged: (run: CourseRun) => void }) {
  const { t } = useI18n()
  const api = useApi().runs
  const confirm = useConfirm()
  const [busy, setBusy] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  const [enrolling, setEnrolling] = createSignal(false)

  async function change(action: () => Promise<CourseRun>) {
    setBusy(true)
    setFailed(false)
    try {
      props.onChanged(await action())
      return true
    } catch {
      setFailed(true)
      return false
    } finally {
      setBusy(false)
    }
  }

  /** The roster, and the students enrolled directly who are not on it, with their account's state. */
  const rows = () => {
    const onRoster = new Set(props.run.roster.map((s) => s.id))
    const waiting = props.run.students
      .filter((s) => !onRoster.has(s.id))
      .map((s) => ({ id: s.id, name: s.name, email: s.email, direct: true, classes: [] as string[], state: s.state }))
    return [...props.run.roster.map((s) => ({ ...s, state: null })), ...waiting].sort((a, b) =>
      a.name.localeCompare(b.name),
    )
  }
  const via = (row: { direct: boolean; classes: string[] }) =>
    [...row.classes, ...(row.direct ? [t('runs.directly')] : [])].join(', ')

  return (
    <section aria-labelledby="run-students-heading">
      <div class="step-heading">
        <h2 id="run-students-heading">{t('runTabs.students')}</h2>
        <button type="button" onClick={() => setEnrolling(true)}>
          {t('runStudents.enrol')}
        </button>
      </div>
      <Show when={props.run.classes.length > 0}>
        <ul class="chips" aria-label={t('runs.classes')}>
          <For each={props.run.classes}>
            {(klass) => (
              <li class="chip">
                <A href={`/classes/${klass.id}`}>{klass.name}</A>
                <span class="settings-note">{klass.member_count}</span>
                <button
                  type="button"
                  class="chip-remove"
                  disabled={busy()}
                  aria-label={t('runStudents.removeClass', { name: klass.name })}
                  onClick={async () => {
                    const removing = await confirm({
                      title: t('runs.confirmRemove', { name: klass.name }),
                      body: t('runs.removeClassNote'),
                      action: t('runs.remove'),
                    })
                    if (removing) await change(() => api.unenrolClass(props.run.id, klass.id))
                  }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <p class="settings-note">{t('runs.rosterNote')}</p>
      <Show when={rows().length > 0} fallback={<p>{t('runs.noRoster')}</p>}>
        <div class="table-scroll">
          <table class="admin-table" aria-label={t('runTabs.students')}>
            <thead>
              <tr>
                <th scope="col">{t('students.name')}</th>
                <th scope="col">{t('auth.email')}</th>
                <th scope="col">{t('runs.enrolledVia')}</th>
                <th scope="col">{t('teachers.actions')}</th>
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(row) => (
                  <tr>
                    <td>
                      <A href={`/students/${row.id}`}>{row.name}</A>
                      <Show when={row.state}>
                        {(state) => (
                          <>
                            {' '}
                            <span class="badge" data-tone="attention">
                              {t(stateNames[state()])}
                            </span>
                          </>
                        )}
                      </Show>
                    </td>
                    <td>{row.email}</td>
                    <td>{via(row)}</td>
                    <td>
                      <Show when={row.direct}>
                        <button
                          type="button"
                          disabled={busy()}
                          onClick={async () => {
                            const removing = await confirm({
                              title: t('runs.confirmRemove', { name: row.name }),
                              body: t('runs.removeStudentNote'),
                              action: t('runs.remove'),
                            })
                            if (removing) await change(() => api.unenrolStudent(props.run.id, row.id))
                          }}
                        >
                          {t('runs.remove')}
                        </button>
                      </Show>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
      <Show when={failed()}>
        <p role="alert">{t('smtp.requestFailed')}</p>
      </Show>
      <Show when={enrolling()}>
        <EnrolDialog run={props.run} onChange={change} onClose={() => setEnrolling(false)} />
      </Show>
    </section>
  )
}

/** Enrolling a whole class or one student, in one dialog. */
function EnrolDialog(props: {
  run: CourseRun
  onChange: (action: () => Promise<CourseRun>) => Promise<boolean>
  onClose: () => void
}) {
  const { t } = useI18n()
  const apis = useApi()
  const [classes] = createResource(() => apis.classes.list())
  const [students] = createResource(() => apis.students.list())
  const [chosenClass, setChosenClass] = createSignal('')
  const [chosenStudent, setChosenStudent] = createSignal('')
  const [busy, setBusy] = createSignal(false)

  const addableClasses = () => {
    const enrolled = new Set(props.run.classes.map((c) => c.id))
    return (classes.error ? [] : (classes() ?? [])).filter((c) => !enrolled.has(c.id))
  }
  const addableStudents = () => {
    const enrolled = new Set(props.run.students.map((s) => s.id))
    return (students.error ? [] : (students() ?? [])).filter((s) => !enrolled.has(s.id) && s.state !== 'erased')
  }

  async function enrol(action: () => Promise<CourseRun>) {
    setBusy(true)
    const done = await props.onChange(action)
    setBusy(false)
    if (done) props.onClose()
  }

  return (
    <Dialog title={t('runStudents.enrol')} onClose={props.onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (chosenClass() !== '') void enrol(() => apis.runs.enrolClass(props.run.id, Number(chosenClass())))
        }}
      >
        <label>
          {t('runs.enrolClass')}
          <select required value={chosenClass()} onChange={(e) => setChosenClass(e.currentTarget.value)}>
            <option value="">{t('runs.chooseClass')}</option>
            <For each={addableClasses()}>{(klass) => <option value={String(klass.id)}>{klass.name}</option>}</For>
          </select>
        </label>
        <div class="settings-actions">
          <button type="submit" disabled={busy() || addableClasses().length === 0}>
            {t('runs.enrolClassButton')}
          </button>
        </div>
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (chosenStudent() !== '') void enrol(() => apis.runs.enrolStudent(props.run.id, Number(chosenStudent())))
        }}
      >
        <label>
          {t('runs.enrolStudent')}
          <select required value={chosenStudent()} onChange={(e) => setChosenStudent(e.currentTarget.value)}>
            <option value="">{t('runs.chooseStudent')}</option>
            <For each={addableStudents()}>
              {(student) => (
                <option value={String(student.id)}>
                  {student.name} ({student.email})
                </option>
              )}
            </For>
          </select>
        </label>
        <div class="settings-actions">
          <button type="submit" disabled={busy() || addableStudents().length === 0}>
            {t('runs.enrolStudentButton')}
          </button>
        </div>
      </form>
      <div class="dialog-actions">
        <button type="button" class="button-secondary" onClick={() => props.onClose()}>
          {t('access.cancel')}
        </button>
      </div>
    </Dialog>
  )
}
