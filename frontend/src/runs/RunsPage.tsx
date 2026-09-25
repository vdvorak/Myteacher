import { A } from '@solidjs/router'
import { useI18n } from '../i18n/i18n'
import '../admin/admin.css'
import { useBreadcrumbs } from '../shell/breadcrumbs'
import { PageHeader } from '../shell/PageHeader'
import { TeachersOnly } from '../students/StudentsPage'

/** Every run the teacher teaches; a placeholder until the list across courses exists (#100). */
export function RunsPage() {
  const { t } = useI18n()
  useBreadcrumbs(() => [{ label: t('nav.runs') }])
  return (
    <TeachersOnly>
      <section class="admin-section">
        <PageHeader title={t('nav.runs')} />
        <p>{t('runsPage.placeholder')}</p>
        <p>
          <A href="/courses">{t('runsPage.toCourses')}</A>
        </p>
      </section>
    </TeachersOnly>
  )
}
