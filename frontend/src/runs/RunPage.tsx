import { A, useParams } from '@solidjs/router'
import { createEffect, createResource, createSignal, For, Show } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import '../admin/admin.css'
import { stateNames, TeachersOnly } from '../students/StudentsPage'
import type { CourseRun, RosterStudent } from './api'

/** One run, seen by its teacher: the roster, and enrolling classes and students. */
export function RunPage() {
  return (
    <TeachersOnly>
      <RunDetail />
    </TeachersOnly>
  )
}

function RunDetail() {
  const { t } = useI18n()
  const apis = useApi()
  const api = apis.runs
  const params = useParams<{ runId: string }>()
  const [run, { mutate }] = createResource(() => Number(params.runId), (id) => api.get(id))
  const [classes] = createResource(() => apis.classes.list())
  const [students] = createResource(() => apis.students.list())
  const [name, setName] = createSignal('')
  const [chosenClass, setChosenClass] = createSignal('')
  const [chosenStudent, setChosenStudent] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [failed, setFailed] = createSignal(false)

  // Fill the name once per run, so an enrolment never overwrites a rename being typed.
  let filledFor: number | undefined
  createEffect(() => {
    const current = !run.error && run()
    if (current && current.id !== filledFor) {
      filledFor = current.id
      setName(current.name)
    }
  })

  const loaded = () => (run.error ? undefined : run())
  const addableClasses = () => {
    const enrolled = new Set(loaded()?.classes.map((c) => c.id))
    return (classes.error ? [] : (classes() ?? [])).filter((c) => !enrolled.has(c.id))
  }
  const addableStudents = () => {
    const enrolled = new Set(loaded()?.students.map((s) => s.id))
    return (students.error ? [] : (students() ?? [])).filter((s) => !enrolled.has(s.id) && s.state !== 'erased')
  }

  async function change(action: () => Promise<CourseRun>) {
    setBusy(true)
    setFailed(false)
    try {
      mutate(await action())
      return true
    } catch {
      setFailed(true)
      return false
    } finally {
      setBusy(false)
    }
  }

  const rename = (current: CourseRun) => (event: SubmitEvent) => {
    event.preventDefault()
    if (name().trim() === '') return
    void change(() => api.rename(current.id, name().trim()))
  }

  const enrolClass = (current: CourseRun) => async (event: SubmitEvent) => {
    event.preventDefault()
    if (chosenClass() === '') return
    if (await change(() => api.enrolClass(current.id, Number(chosenClass())))) setChosenClass('')
  }

  const enrolStudent = (current: CourseRun) => async (event: SubmitEvent) => {
    event.preventDefault()
    if (chosenStudent() === '') return
    if (await change(() => api.enrolStudent(current.id, Number(chosenStudent())))) setChosenStudent('')
  }

  const via = (student: RosterStudent) => [...student.classes, ...(student.direct ? [t('runs.directly')] : [])].join(', ')

  return (
    <section class="admin-section">
      <Show when={run.error}>
        <p role="alert">{t('runs.runLoadFailed')}</p>
      </Show>
      <Show when={loaded()}>
        {(current) => (
          <>
            <p>
              {t('runs.course')}
              <A href={`/courses/${current().course.id}`}>{current().course.name}</A>
            </p>
            <h1>{current().name}</h1>
            <form class="settings-form" onSubmit={rename(current())}>
              <label>
                {t('runs.name')}
                <input required maxLength={200} value={name()} onInput={(e) => setName(e.currentTarget.value)} />
              </label>
              <div class="settings-actions">
                <button type="submit" disabled={busy()}>
                  {t('runs.rename')}
                </button>
              </div>
            </form>

            <h2>{t('runs.roster')}</h2>
            <p class="settings-note">{t('runs.rosterNote')}</p>
            <Show when={current().roster.length > 0} fallback={<p>{t('runs.noRoster')}</p>}>
              <div class="table-scroll">
                <table class="admin-table" aria-label={t('runs.roster')}>
                  <thead>
                    <tr>
                      <th scope="col">{t('students.name')}</th>
                      <th scope="col">{t('auth.email')}</th>
                      <th scope="col">{t('runs.enrolledVia')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={current().roster}>
                      {(student) => (
                        <tr>
                          <td>
                            <A href={`/students/${student.id}`}>{student.name}</A>
                          </td>
                          <td>{student.email}</td>
                          <td>{via(student)}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>

            <h2>{t('runs.classes')}</h2>
            <Show when={current().classes.length > 0} fallback={<p>{t('runs.noClasses')}</p>}>
              <div class="table-scroll">
                <table class="admin-table" aria-label={t('runs.classes')}>
                  <thead>
                    <tr>
                      <th scope="col">{t('classes.name')}</th>
                      <th scope="col">{t('classes.memberCount')}</th>
                      <th scope="col">{t('teachers.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={current().classes}>
                      {(klass) => (
                        <tr>
                          <td>
                            <A href={`/classes/${klass.id}`}>{klass.name}</A>
                          </td>
                          <td>{klass.member_count}</td>
                          <td>
                            <button
                              type="button"
                              disabled={busy()}
                              onClick={() => change(() => api.unenrolClass(current().id, klass.id))}
                            >
                              {t('runs.remove')}
                            </button>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
            <form class="settings-form" onSubmit={enrolClass(current())}>
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

            <h2>{t('runs.students')}</h2>
            <Show when={current().students.length > 0} fallback={<p>{t('runs.noStudents')}</p>}>
              <div class="table-scroll">
                <table class="admin-table" aria-label={t('runs.students')}>
                  <thead>
                    <tr>
                      <th scope="col">{t('students.name')}</th>
                      <th scope="col">{t('auth.email')}</th>
                      <th scope="col">{t('teachers.state')}</th>
                      <th scope="col">{t('teachers.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={current().students}>
                      {(student) => (
                        <tr>
                          <td>
                            <A href={`/students/${student.id}`}>{student.name}</A>
                          </td>
                          <td>{student.email}</td>
                          <td>{t(stateNames[student.state])}</td>
                          <td>
                            <button
                              type="button"
                              disabled={busy()}
                              onClick={() => change(() => api.unenrolStudent(current().id, student.id))}
                            >
                              {t('runs.remove')}
                            </button>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
            <form class="settings-form" onSubmit={enrolStudent(current())}>
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
          </>
        )}
      </Show>
      <Show when={failed()}>
        <p role="alert">{t('smtp.requestFailed')}</p>
      </Show>
    </section>
  )
}
