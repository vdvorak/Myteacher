import { createResource, createSignal, For, Match, Show, Switch } from 'solid-js'
import { useI18n } from '../i18n/i18n'
import { localeNames, locales, type Locale, type MessageKey } from '../i18n/messages'
import { Conflict, type AdminApi, type InvitationResult, type Teacher, type TeacherChange } from './api'

type Outcome =
  | { kind: 'sent'; email: string }
  | { kind: 'notSent'; error: string; created: boolean }
  | { kind: 'refused'; message: MessageKey }
  | { kind: 'failed' }
  | null

const conflictMessages: Record<Conflict['reason'], MessageKey> = {
  email_taken: 'teachers.emailTaken',
  last_active_admin: 'teachers.lastAdmin',
  account_inactive: 'accounts.inactiveNotInvited',
  already_accepted: 'teachers.alreadyAccepted',
}

const stateNames: Record<Teacher['state'], MessageKey> = {
  invited: 'teachers.state.invited',
  active: 'teachers.state.active',
  inactive: 'teachers.state.inactive',
}

/** The admin's view of the instance's teachers: invite, deactivate, grant or revoke admin. */
export function TeachersSection(props: { api: AdminApi }) {
  const { t, locale } = useI18n()
  const [teachers, { mutate }] = createResource(() => props.api.listTeachers())
  const [email, setEmail] = createSignal('')
  const [language, setLanguage] = createSignal<Locale>(locale())
  const [busy, setBusy] = createSignal(false)
  const [outcome, setOutcome] = createSignal<Outcome>(null)

  const replace = (changed: Teacher) =>
    mutate((list) => {
      const others = (list ?? []).filter((teacher) => teacher.id !== changed.id)
      return [...others, changed].sort((a, b) => a.email.localeCompare(b.email))
    })

  const reportInvitation = (to: string, result: InvitationResult, created: boolean) =>
    setOutcome(
      result.invitation_sent
        ? { kind: 'sent', email: to }
        : { kind: 'notSent', error: result.error ?? '', created },
    )

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setOutcome(null)
    try {
      await action()
    } catch (error) {
      setOutcome(
        error instanceof Conflict ? { kind: 'refused', message: conflictMessages[error.reason] } : { kind: 'failed' },
      )
    } finally {
      setBusy(false)
    }
  }

  const invite = (event: SubmitEvent) => {
    event.preventDefault()
    void run(async () => {
      const created = await props.api.createTeacher(email(), language())
      const { invitation_sent, error, ...teacher } = created
      replace(teacher)
      setEmail('')
      reportInvitation(teacher.email, { invitation_sent, error }, true)
    })
  }

  const change = (teacher: Teacher, update: TeacherChange) =>
    run(async () => {
      replace(await props.api.changeTeacher(teacher.id, update))
    })

  const resend = (teacher: Teacher) =>
    run(async () => {
      reportInvitation(teacher.email, await props.api.resendInvitation(teacher.id), false)
    })

  const sent = () => {
    const current = outcome()
    return current?.kind === 'sent' ? current : null
  }
  const notSent = () => {
    const current = outcome()
    return current?.kind === 'notSent' ? current : null
  }
  const refused = () => {
    const current = outcome()
    return current?.kind === 'refused' ? current : null
  }

  return (
    <section class="admin-section" aria-labelledby="teachers-heading">
      <h2 id="teachers-heading">{t('teachers.heading')}</h2>
      <Show when={teachers.error}>
        <p role="alert">{t('teachers.loadFailed')}</p>
      </Show>
      <Show when={teachers()}>
        {(list) => (
          <div class="table-scroll">
            <table class="admin-table">
              <thead>
                <tr>
                  <th scope="col">{t('auth.email')}</th>
                  <th scope="col">{t('teachers.state')}</th>
                  <th scope="col">{t('teachers.role')}</th>
                  <th scope="col">{t('teachers.actions')}</th>
                </tr>
              </thead>
              <tbody>
                <For each={list()}>
                  {(teacher) => (
                    <tr>
                      <td>{teacher.email}</td>
                      <td>{t(stateNames[teacher.state])}</td>
                      <td>{teacher.is_admin ? t('role.admin') : t('role.teacher')}</td>
                      <td class="admin-actions">
                        <Show when={teacher.state === 'invited'}>
                          <button type="button" disabled={busy()} onClick={() => resend(teacher)}>
                            {t('teachers.resend')}
                          </button>
                        </Show>
                        <button
                          type="button"
                          disabled={busy()}
                          onClick={() => change(teacher, { is_admin: !teacher.is_admin })}
                        >
                          {teacher.is_admin ? t('teachers.revokeAdmin') : t('teachers.grantAdmin')}
                        </button>
                        <button
                          type="button"
                          disabled={busy()}
                          onClick={() => change(teacher, { active: teacher.state === 'inactive' })}
                        >
                          {teacher.state === 'inactive' ? t('teachers.reactivate') : t('teachers.deactivate')}
                        </button>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        )}
      </Show>
      <form class="settings-form" onSubmit={invite}>
        <label>
          {t('teachers.newEmail')}
          <input type="email" required value={email()} onInput={(e) => setEmail(e.currentTarget.value)} />
        </label>
        <label>
          {t('teachers.newLanguage')}
          <select value={language()} onChange={(e) => setLanguage(e.currentTarget.value as Locale)}>
            <For each={locales}>{(code) => <option value={code}>{localeNames[code]}</option>}</For>
          </select>
        </label>
        <button type="submit" disabled={busy()}>
          {t('teachers.invite')}
        </button>
      </form>
      <Switch>
        <Match when={sent()}>{(result) => <p role="status">{t('teachers.invitationSent', { email: result().email })}</p>}</Match>
        <Match when={notSent()}>
          {(result) => (
            <p role="alert">
              {t(result().created ? 'teachers.invitationNotSent' : 'teachers.resendNotSent', {
                error: result().error,
              })}
            </p>
          )}
        </Match>
        <Match when={refused()}>{(result) => <p role="alert">{t(result().message)}</p>}</Match>
        <Match when={outcome()?.kind === 'failed'}>
          <p role="alert">{t('smtp.requestFailed')}</p>
        </Match>
      </Switch>
    </section>
  )
}
