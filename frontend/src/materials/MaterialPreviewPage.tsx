import { useParams } from '@solidjs/router'
import { createResource, Match, Show, Switch } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import { LanguageSwitch } from '../i18n/LanguageSwitch'
import { ApiError } from '../lesson/api'
import { LessonPlayer } from '../lesson/LessonPlayer'
import { AnswerKeyPage } from '../preview/AnswerKeyPage'
import '../preview/preview.css'
import '../preview/print.css'

/** Classroom material as it is projected and printed: the exercises, then the answer key on a page of its own. */
export function MaterialPreviewPage() {
  const { t } = useI18n()
  const api = useApi().materials
  const params = useParams<{ courseId: string; topicId: string; materialId: string }>()
  const ids = () => [Number(params.courseId), Number(params.topicId), Number(params.materialId)] as const
  const [material] = createResource(ids, ([courseId, topicId, materialId]) => api.get(courseId, topicId, materialId))

  return (
    <div class="page">
      <header class="page-header">
        <span class="page-caption">{t('materials.previewHeading')}</span>
        <LanguageSwitch />
      </header>
      <div class="print-toolbar">
        <button type="button" disabled={!material()?.lesson} onClick={() => window.print()}>
          {t('print.print')}
        </button>
      </div>
      <main>
        <Switch>
          <Match when={material.error}>
            <p role="alert">
              {material.error instanceof ApiError && material.error.status === 404
                ? t('materials.notFound')
                : t('materials.loadFailed')}
            </p>
          </Match>
          <Match when={material()}>
            {(loaded) => (
              <Show when={loaded().lesson} fallback={<p role="alert">{t('materials.notFound')}</p>}>
                {(lesson) => (
                  <>
                    <LessonPlayer lesson={lesson()} seed="1" api={api.lessonApi(...ids())} />
                    <Show when={loaded().answer_key}>
                      {(key) => <AnswerKeyPage lesson={lesson()} answerKey={key()} />}
                    </Show>
                  </>
                )}
              </Show>
            )}
          </Match>
          <Match when={material.loading}>
            <p>{t('preview.loading')}</p>
          </Match>
        </Switch>
      </main>
    </div>
  )
}
