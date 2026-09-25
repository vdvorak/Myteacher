import { A, useParams } from '@solidjs/router'
import { createResource, For, Show } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import '../admin/admin.css'
import type { Student, StudentBasics } from './api'
import { createActions, invitationOutcome, OutcomeMessage } from './outcome'
import { ConsentSection } from './ConsentSection'
import { StudentForm } from './StudentForm'
import { useBreadcrumbs } from '../shell/breadcrumbs'
import { useConfirm } from '../shell/confirm'
import { PageHeader } from '../shell/PageHeader'
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
  const confirm = useConfirm()

  const isInactive = (current: Student) => current.state === 'inactive' || current.state === 'awaiting_consent'
  const activationLabel = (current: Student) => {
    if (current.state === 'awaiting_consent') return t('students.activate')
    return current.state === 'inactive' ? t('teachers.reactivate') : t('teachers.deactivate')
  }

  const save = (current: Student, basics: StudentBasics) =>
    run(async () => {
      const saved = await api.change(current.id, basics)
      mutate(saved)
      // The backend voids an open invitation when the address it went to is corrected.
      const voided = current.state === 'invited' && saved.email !== current.email
      if (saved.state === 'awaiting_consent' && current.state !== 'awaiting_consent') {
        return { kind: 'done', message: 'students.savedMinorDeactivated' }
      }
      return { kind: 'done', message: voided ? 'students.savedInvitationVoided' : 'students.saved' }
    })

  const setActive = (current: Student, active: boolean) =>
    run(async () => {
      mutate(await api.change(current.id, { active }))
      return null
    })

  const recordConsent = (current: Student, note: string | null) =>
    run(async () => {
      const recorded = await api.recordConsent(current.id, note)
      mutate(recorded)
      const canActivate = recorded.state === 'inactive'
      return { kind: 'done', message: canActivate ? 'students.consentRecordedActivate' : 'students.consentRecorded' }
    })

  const resend = (current: Student) =>
    run(async () => invitationOutcome(current.email, await api.resendInvitation(current.id), false))

  const revoke = (current: Student) =>
    run(async () => {
      await api.revokeInvitation(current.id)
      return { kind: 'done', message: 'students.revoked' }
    })

  useBreadcrumbs(() => [
    { label: t('nav.people'), href: '/students' },
    { label: (!student.error && student()?.name) || '…' },
  ])

  return (
    <section class="admin-section">
      <Show when={student.error}>
        <p role="alert">{t('students.studentLoadFailed')}</p>
      </Show>
      <Show when={!student.error && student()}>
        {(current) => (
          <>
            <PageHeader title={current().name} />
            <p>
              {t('teachers.state')}: <strong>{t(stateNames[current().state])}</strong>
            </p>
            <Show when={current().id} keyed>
              <StudentForm
                initial={{
                  name: current().name,
                  email: current().email,
                  language: current().language ?? 'en',
                  minor: current().minor,
                }}
                submitLabel={t('students.save')}
                busy={busy()}
                onSubmit={(basics) => save(current(), basics)}
              />
            </Show>
            <section class="admin-section" aria-labelledby="student-classes-heading">
              <h2 id="student-classes-heading">{t('classes.heading')}</h2>
              <Show when={current().classes.length > 0} fallback={<p>{t('students.noClasses')}</p>}>
                <ul>
                  <For each={current().classes}>
                    {(klass) => (
                      <li>
                        <A href={`/classes/${klass.id}`}>{klass.name}</A>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </section>
            <Show when={current().minor}>
              <ConsentSection
                student={current()}
                busy={busy()}
                onRecord={(note) => recordConsent(current(), note)}
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
                onClick={async () => {
                  const active = isInactive(current())
                  const confirmed =
                    active ||
                    (await confirm({
                      title: t('teachers.confirmDeactivate', { name: current().name }),
                      body: t('teachers.deactivateNote'),
                      action: t('teachers.deactivate'),
                    }))
                  if (confirmed) await setActive(current(), active)
                }}
              >
                {activationLabel(current())}
              </button>
            </div>
          </>
        )}
      </Show>
      <OutcomeMessage outcome={outcome()} />
    </section>
  )
}
