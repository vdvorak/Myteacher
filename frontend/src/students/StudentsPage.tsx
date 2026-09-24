import { A } from '@solidjs/router'
import { createResource, For, Show, type ParentProps } from 'solid-js'
import { useApi } from '../api/context'
import { useSession } from '../auth/session'
import { useI18n } from '../i18n/i18n'
import type { MessageKey } from '../i18n/messages'
import '../admin/admin.css'
import type { Student, StudentBasics } from './api'
import { createActions, invitationOutcome, OutcomeMessage } from './outcome'
import { StudentForm } from './StudentForm'

export const stateNames: Record<Student['state'], MessageKey> = {
  invited: 'teachers.state.invited',
  active: 'teachers.state.active',
  inactive: 'teachers.state.inactive',
  awaiting_consent: 'students.state.awaitingConsent',
  erased: 'students.state.erased',
}

/** Student pages are for teachers; students do not manage accounts. */
export function TeachersOnly(props: ParentProps) {
  const { t } = useI18n()
  const session = useSession()
  return (
    <Show when={session.account()?.kind === 'teacher'} fallback={<p role="alert">{t('students.forbidden')}</p>}>
      {props.children}
    </Show>
  )
}

/** Every student on the instance, and the form to create one. */
export function StudentsPage() {
  return (
    <TeachersOnly>
      <StudentsList />
    </TeachersOnly>
  )
}

function StudentsList() {
  const { t } = useI18n()
  const api = useApi().students
  const [students, { mutate }] = createResource(() => api.list())
  const { busy, outcome, run } = createActions()

  const create = (basics: StudentBasics) =>
    run(async () => {
      const { invitation_sent, error, ...student } = await api.create(basics)
      mutate((list) => [...(list ?? []), student].sort((a, b) => a.name.localeCompare(b.name)))
      if (student.state === 'awaiting_consent') return { kind: 'done', message: 'students.createdMinor' }
      return invitationOutcome(student.email, { invitation_sent, error }, true)
    })

  return (
    <section class="admin-section" aria-labelledby="students-heading">
      <h1 id="students-heading">{t('students.heading')}</h1>
      <Show when={students.error}>
        <p role="alert">{t('students.loadFailed')}</p>
      </Show>
      <Show when={students()}>
        {(list) => (
          <Show when={list().length > 0} fallback={<p>{t('students.none')}</p>}>
            <div class="table-scroll">
              <table class="admin-table">
                <thead>
                  <tr>
                    <th scope="col">{t('students.name')}</th>
                    <th scope="col">{t('auth.email')}</th>
                    <th scope="col">{t('teachers.state')}</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={list()}>
                    {(student) => (
                      <tr>
                        <td>
                          <A href={`/students/${student.id}`}>{student.name}</A>
                        </td>
                        <td>{student.email}</td>
                        <td>{t(stateNames[student.state])}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        )}
      </Show>
      <h2>{t('students.new')}</h2>
      <StudentForm submitLabel={t('students.create')} busy={busy()} onSubmit={create} />
      <OutcomeMessage outcome={outcome()} />
    </section>
  )
}
