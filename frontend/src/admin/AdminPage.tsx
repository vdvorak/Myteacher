import { Show } from 'solid-js'
import { useSession } from '../auth/session'
import { useI18n } from '../i18n/i18n'
import { useApi } from '../api/context'
import { SmtpSettingsForm } from './SmtpSettingsForm'
import { TeachersSection } from './TeachersSection'
import './admin.css'

export function AdminPage() {
  const api = useApi().admin
  const { t } = useI18n()
  const session = useSession()
  return (
    <Show when={session.account()?.roles.includes('admin')} fallback={<p role="alert">{t('admin.forbidden')}</p>}>
      <h1>{t('admin.heading')}</h1>
      <TeachersSection api={api} />
      <SmtpSettingsForm api={api} defaultRecipient={session.account()?.email ?? ''} />
    </Show>
  )
}
