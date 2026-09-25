import { A } from '@solidjs/router'
import { useI18n } from '../i18n/i18n'

/** Classes and students are one section of two pages. */
export function PeopleTabs() {
  const { t } = useI18n()
  return (
    <nav class="section-tabs" aria-label={t('nav.people')}>
      <A href="/classes" end>
        {t('nav.classes')}
      </A>
      <A href="/students" end>
        {t('nav.students')}
      </A>
    </nav>
  )
}
