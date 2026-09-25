import { Match, Switch } from 'solid-js'
import { MyWork } from '../attempts/MyWork'
import { useSession } from '../auth/session'
import { TeacherHome } from '../home/TeacherHome'
import { useI18n } from '../i18n/i18n'
import { useBreadcrumbs } from './breadcrumbs'

export function HomePage() {
  const { t } = useI18n()
  const session = useSession()
  useBreadcrumbs(() => (session.account()?.kind === 'teacher' ? [{ label: t('nav.home') }] : []))
  return (
    <Switch>
      <Match when={session.account()?.kind === 'student' && session.account()}>
        {(student) => (
          <>
            <h1>{t('home.studentGreeting', { name: student().name ?? student().email })}</h1>
            <MyWork />
          </>
        )}
      </Match>
      <Match when={session.account()?.kind === 'teacher'}>
        <TeacherHome />
      </Match>
    </Switch>
  )
}
