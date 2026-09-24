import { Show } from 'solid-js'
import { useSession } from '../auth/session'
import { useI18n } from '../i18n/i18n'
import type { AdminApi } from './api'
import { SmtpSettingsForm } from './SmtpSettingsForm'
import './admin.css'

export function AdminPage(props: { api: AdminApi }) {
  const { t } = useI18n()
  const session = useSession()
  return (
    <Show when={session.account()?.roles.includes('admin')} fallback={<p role="alert">{t('admin.forbidden')}</p>}>
      <h1>{t('admin.heading')}</h1>
      <SmtpSettingsForm api={props.api} defaultRecipient={session.account()?.email ?? ''} />
    </Show>
  )
}
