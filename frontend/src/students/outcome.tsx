import { createSignal, Match, Switch } from 'solid-js'
import { Conflict, type InvitationResult } from '../admin/api'
import { useI18n } from '../i18n/i18n'
import type { MessageKey } from '../i18n/messages'

/** What the last action on a student came to, told to the teacher as a status or an alert. */
export type Outcome =
  | { kind: 'done'; message: MessageKey; params?: Record<string, string> }
  | { kind: 'problem'; message: MessageKey; params?: Record<string, string> }
  | null

const conflictMessages: Record<Conflict['reason'], MessageKey> = {
  email_taken: 'teachers.emailTaken',
  last_active_admin: 'teachers.lastAdmin',
  account_inactive: 'accounts.inactiveNotInvited',
  already_accepted: 'students.alreadyAccepted',
}

export function invitationOutcome(email: string, result: InvitationResult, created: boolean): Outcome {
  if (result.invitation_sent) return { kind: 'done', message: 'teachers.invitationSent', params: { email } }
  const message = created ? 'teachers.invitationNotSent' : 'teachers.resendNotSent'
  return { kind: 'problem', message, params: { error: result.error ?? '' } }
}

/** Runs one action at a time, keeping the busy flag and the outcome; resolves whether it succeeded. */
export function createActions() {
  const [busy, setBusy] = createSignal(false)
  const [outcome, setOutcome] = createSignal<Outcome>(null)

  async function run(action: () => Promise<Outcome>): Promise<boolean> {
    setBusy(true)
    setOutcome(null)
    try {
      setOutcome(await action())
      return true
    } catch (error) {
      setOutcome({
        kind: 'problem',
        message: error instanceof Conflict ? conflictMessages[error.reason] : 'smtp.requestFailed',
      })
      return false
    } finally {
      setBusy(false)
    }
  }

  return { busy, outcome, run }
}

export function OutcomeMessage(props: { outcome: Outcome }) {
  const { t } = useI18n()
  return (
    <Switch>
      <Match when={props.outcome?.kind === 'done' && props.outcome}>
        {(done) => <p role="status">{t(done().message, done().params)}</p>}
      </Match>
      <Match when={props.outcome?.kind === 'problem' && props.outcome}>
        {(problem) => <p role="alert">{t(problem().message, problem().params)}</p>}
      </Match>
    </Switch>
  )
}
