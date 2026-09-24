import { createResource, Match, Switch } from 'solid-js'
import { useI18n } from '../i18n/i18n'
import { LanguageSwitch } from '../i18n/LanguageSwitch'
import { ApiError, assessAnswer, fetchLesson } from '../lesson/api'
import { LessonView } from '../lesson/LessonView'
import './preview.css'

/** Renders one lesson exactly as a student would see it, with a fixed seed for the layout. */
export function PreviewPage(props: { lessonId: string; seed: string }) {
  const { t } = useI18n()
  const [lesson] = createResource(() => props.lessonId, fetchLesson)

  return (
    <div class="page">
      <header class="page-header">
        <span class="page-caption">{t('preview.heading')}</span>
        <LanguageSwitch />
      </header>
      <main>
        <Switch>
          <Match when={lesson.error}>
            <p role="alert">
              {lesson.error instanceof ApiError && lesson.error.status === 404
                ? t('preview.notFound')
                : t('preview.loadFailed')}
            </p>
          </Match>
          <Match when={lesson()}>
            {(loaded) => (
              <LessonView
                lesson={loaded()}
                seed={props.seed}
                assess={(exerciseId, answer) => assessAnswer(loaded().id, exerciseId, answer)}
              />
            )}
          </Match>
          <Match when={lesson.loading}>
            <p>{t('preview.loading')}</p>
          </Match>
        </Switch>
      </main>
    </div>
  )
}
