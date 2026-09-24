import { useI18n } from '../i18n/i18n'

const SAMPLE_LESSON = 'es-ser-estar'

export function HomePage() {
  const { t } = useI18n()
  return (
    <>
      <h1>{t('app.title')}</h1>
      <a href={`/preview/${SAMPLE_LESSON}`}>{t('preview.openFixture')}</a>
    </>
  )
}
