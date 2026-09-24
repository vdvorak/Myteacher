import { Match, Switch } from 'solid-js'
import { useSession } from '../auth/session'
import { useI18n } from '../i18n/i18n'

const SAMPLE_LESSON = 'es-ser-estar'

export function HomePage() {
  const { t } = useI18n()
  const session = useSession()
  return (
    <Switch>
      <Match when={session.account()?.kind === 'student' && session.account()}>
        {(student) => (
          <>
            {/* A placeholder until students receive lessons. */}
            <h1>{t('home.studentGreeting', { name: student().name ?? student().email })}</h1>
            <p>{t('home.studentPlaceholder')}</p>
          </>
        )}
      </Match>
      <Match when={session.account()?.kind === 'teacher'}>
        <h1>{t('app.title')}</h1>
        <a href={`/preview/${SAMPLE_LESSON}`}>{t('preview.openFixture')}</a>
      </Match>
    </Switch>
  )
}
