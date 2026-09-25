import { Show } from 'solid-js'
import { useSession } from '../auth/session'
import { useI18n } from '../i18n/i18n'
import { useApi } from '../api/context'
import { ErasureSection } from './ErasureSection'
import { SmtpSettingsForm } from './SmtpSettingsForm'
import { TeachersSection } from './TeachersSection'
import { useBreadcrumbs } from '../shell/breadcrumbs'
import './admin.css'

export function AdminPage() {
  const api = useApi().admin
  const { t } = useI18n()
  const session = useSession()
  useBreadcrumbs(() => [{ label: t('nav.admin') }])
  return (
    <Show when={session.account()?.roles.includes('admin')} fallback={<p role="alert">{t('admin.forbidden')}</p>}>
      <h1>{t('admin.heading')}</h1>
      <TeachersSection api={api} />
      <SmtpSettingsForm api={api} defaultRecipient={session.account()?.email ?? ''} />
      <ErasureSection api={api} />
    </Show>
  )
}
