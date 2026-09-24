import { createResource, createSignal, Match, Show, Switch } from 'solid-js'
import { useI18n } from '../i18n/i18n'
import { LanguageSwitch } from '../i18n/LanguageSwitch'
import { ApiError, fetchAnswerKey, fetchLesson, lessonApi } from '../lesson/api'
import { LessonPlayer } from '../lesson/LessonPlayer'
import { AnswerKeyPage } from './AnswerKeyPage'
import './preview.css'
import './print.css'

/** Renders one lesson exactly as a student would see it, with a fixed seed for the layout. */
export function PreviewPage(props: { lessonId: string; seed: string }) {
  const { t } = useI18n()
  const [lesson] = createResource(() => props.lessonId, fetchLesson)
  const [includeKey, setIncludeKey] = createSignal(false)
  // The key is fetched only once a print asks for it; it is never part of the lesson payload.
  const [answerKey] = createResource(
    () => (includeKey() ? props.lessonId : undefined),
    fetchAnswerKey,
  )

  // Printing waits for a requested key, so a printout never silently lacks it.
  const keyPending = () => includeKey() && answerKey.loading

  return (
    <div class="page">
      <header class="page-header">
        <span class="page-caption">{t('preview.heading')}</span>
        <LanguageSwitch />
      </header>
      <div class="print-toolbar">
        <label>
          <input
            type="checkbox"
            checked={includeKey()}
            onChange={(event) => setIncludeKey(event.currentTarget.checked)}
          />{' '}
          {t('print.includeAnswerKey')}
        </label>
        <button type="button" disabled={keyPending()} onClick={() => window.print()}>
          {t('print.print')}
        </button>
        <Show when={includeKey() && answerKey.error}>
          <p role="alert">{t('print.answerKeyFailed')}</p>
        </Show>
      </div>
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
              <>
                <LessonPlayer lesson={loaded()} seed={props.seed} api={lessonApi(loaded().id)} />
                <Show when={includeKey() && answerKey.state === 'ready' && answerKey()}>
                  {(key) => <AnswerKeyPage lesson={loaded()} answerKey={key()} />}
                </Show>
              </>
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
