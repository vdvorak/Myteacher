import { A, useParams } from '@solidjs/router'
import { createResource, Show } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import '../admin/admin.css'
import type { Student, StudentBasics } from './api'
import { createActions, invitationOutcome, OutcomeMessage } from './outcome'
import { StudentForm } from './StudentForm'
import { stateNames, TeachersOnly } from './StudentsPage'

/** One student: their basics, their invitation while it is open, and deactivation. */
export function StudentPage() {
  return (
    <TeachersOnly>
      <StudentDetail />
    </TeachersOnly>
  )
}

function StudentDetail() {
  const { t } = useI18n()
  const api = useApi().students
  const params = useParams<{ studentId: string }>()
  const [student, { mutate }] = createResource(() => Number(params.studentId), (id) => api.get(id))
  const { busy, outcome, run } = createActions()

  const save = (current: Student, basics: StudentBasics) =>
    run(async () => {
      const saved = await api.change(current.id, basics)
      mutate(saved)
      // The backend voids an open invitation when the address it went to is corrected.
      const voided = current.state === 'invited' && saved.email !== current.email
      return { kind: 'done', message: voided ? 'students.savedInvitationVoided' : 'students.saved' }
    })

  const setActive = (current: Student, active: boolean) =>
    run(async () => {
      mutate(await api.change(current.id, { active }))
      return null
    })

  const resend = (current: Student) =>
    run(async () => invitationOutcome(current.email, await api.resendInvitation(current.id), false))

  const revoke = (current: Student) =>
    run(async () => {
      await api.revokeInvitation(current.id)
      return { kind: 'done', message: 'students.revoked' }
    })

  return (
    <section class="admin-section">
      <A href="/students">{t('students.all')}</A>
      <Show when={student.error}>
        <p role="alert">{t('students.studentLoadFailed')}</p>
      </Show>
      <Show when={!student.error && student()}>
        {(current) => (
          <>
            <h1>{current().name}</h1>
            <p>
              {t('teachers.state')}: <strong>{t(stateNames[current().state])}</strong>
            </p>
            <Show when={current().id} keyed>
              <StudentForm
                initial={{
                  name: current().name,
                  email: current().email,
                  language: current().language ?? 'en',
                }}
                submitLabel={t('students.save')}
                busy={busy()}
                onSubmit={(basics) => save(current(), basics)}
              />
            </Show>
            <div class="settings-actions">
              <Show when={current().state === 'invited'}>
                <button type="button" disabled={busy()} onClick={() => resend(current())}>
                  {t('teachers.resend')}
                </button>
                <button type="button" disabled={busy()} onClick={() => revoke(current())}>
                  {t('students.revoke')}
                </button>
              </Show>
              <button
                type="button"
                disabled={busy()}
                onClick={() => setActive(current(), current().state === 'inactive')}
              >
                {current().state === 'inactive' ? t('teachers.reactivate') : t('teachers.deactivate')}
              </button>
            </div>
          </>
        )}
      </Show>
      <OutcomeMessage outcome={outcome()} />
    </section>
  )
}
