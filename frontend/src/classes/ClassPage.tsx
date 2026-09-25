import { A, useParams } from '@solidjs/router'
import { createEffect, createResource, createSignal, For, Show } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import '../admin/admin.css'
import { useBreadcrumbs } from '../shell/breadcrumbs'
import { PageHeader } from '../shell/PageHeader'
import { stateNames, TeachersOnly } from '../students/StudentsPage'
import { NameTaken, type SchoolClass } from './api'

type Problem = 'nameTaken' | 'failed' | null

/** One class: its name, its current members, and adding or removing students. */
export function ClassPage() {
  return (
    <TeachersOnly>
      <ClassDetail />
    </TeachersOnly>
  )
}

function ClassDetail() {
  const { t } = useI18n()
  const api = useApi()
  const params = useParams<{ classId: string }>()
  const [klass, { mutate }] = createResource(() => Number(params.classId), (id) => api.classes.get(id))
  const [students] = createResource(() => api.students.list())
  const [name, setName] = createSignal('')
  const [chosen, setChosen] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [problem, setProblem] = createSignal<Problem>(null)

  // Fill the name once per class, so a member change never overwrites a rename being typed.
  let filledFor: number | undefined
  createEffect(() => {
    const current = !klass.error && klass()
    if (current && current.id !== filledFor) {
      filledFor = current.id
      setName(current.name)
    }
  })

  const loaded = () => (klass.error ? undefined : klass())
  const addable = () => {
    const members = new Set(loaded()?.members.map((m) => m.id))
    return (students.error ? [] : (students() ?? [])).filter((s) => !members.has(s.id))
  }

  async function run(action: () => Promise<SchoolClass>) {
    setBusy(true)
    setProblem(null)
    try {
      mutate(await action())
      return true
    } catch (error) {
      setProblem(error instanceof NameTaken ? 'nameTaken' : 'failed')
      return false
    } finally {
      setBusy(false)
    }
  }

  const rename = (current: SchoolClass) => (event: SubmitEvent) => {
    event.preventDefault()
    void run(() => api.classes.rename(current.id, name().trim()))
  }

  const add = (current: SchoolClass) => async (event: SubmitEvent) => {
    event.preventDefault()
    if (chosen() === '') return
    if (await run(() => api.classes.addMember(current.id, Number(chosen())))) setChosen('')
  }

  useBreadcrumbs(() => [{ label: t('nav.people'), href: '/classes' }, { label: loaded()?.name ?? '…' }])

  return (
    <section class="admin-section">
      <Show when={klass.error}>
        <p role="alert">{t('classes.classLoadFailed')}</p>
      </Show>
      <Show when={loaded()}>
        {(current) => (
          <>
            <PageHeader title={current().name} />
            <form class="settings-form" onSubmit={rename(current())}>
              <label>
                {t('classes.name')}
                <input required maxLength={100} value={name()} onInput={(e) => setName(e.currentTarget.value)} />
              </label>
              <div class="settings-actions">
                <button type="submit" disabled={busy()}>
                  {t('classes.rename')}
                </button>
              </div>
            </form>
            <h2>{t('classes.members')}</h2>
            <Show when={current().members.length > 0} fallback={<p>{t('classes.noMembers')}</p>}>
              <div class="table-scroll">
                <table class="admin-table" aria-label={t('classes.members')}>
                  <thead>
                    <tr>
                      <th scope="col">{t('students.name')}</th>
                      <th scope="col">{t('auth.email')}</th>
                      <th scope="col">{t('teachers.state')}</th>
                      <th scope="col">{t('teachers.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={current().members}>
                      {(member) => (
                        <tr>
                          <td>
                            <A href={`/students/${member.id}`}>{member.name}</A>
                          </td>
                          <td>{member.email}</td>
                          <td>{t(stateNames[member.state])}</td>
                          <td>
                            <button
                              type="button"
                              disabled={busy()}
                              onClick={() => run(() => api.classes.removeMember(current().id, member.id))}
                            >
                              {t('classes.remove')}
                            </button>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
            <form class="settings-form" onSubmit={add(current())}>
              <label>
                {t('classes.addStudent')}
                <select required value={chosen()} onChange={(e) => setChosen(e.currentTarget.value)}>
                  <option value="">{t('classes.chooseStudent')}</option>
                  <For each={addable()}>
                    {(student) => (
                      <option value={String(student.id)}>
                        {student.name} ({student.email})
                      </option>
                    )}
                  </For>
                </select>
              </label>
              <div class="settings-actions">
                <button type="submit" disabled={busy() || addable().length === 0}>
                  {t('classes.add')}
                </button>
              </div>
            </form>
          </>
        )}
      </Show>
      <Show when={problem()}>
        {(current) => (
          <p role="alert">{t(current() === 'nameTaken' ? 'classes.nameTaken' : 'smtp.requestFailed')}</p>
        )}
      </Show>
    </section>
  )
}
