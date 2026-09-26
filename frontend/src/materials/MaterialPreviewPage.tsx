import { useParams } from '@solidjs/router'
import { createResource, Match, Show, Switch } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import { useCourseTrail } from '../courses/trail'
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

  useCourseTrail(() => ({
    courseId: Number(params.courseId),
    topicId: Number(params.topicId),
    page: (!material.error && material()?.title) || t('materials.previewHeading'),
  }))

  return (
    <div class="preview-page">
      <div class="print-toolbar">
        <button type="button" disabled={material.error !== undefined || !material()?.lesson} onClick={() => window.print()}>
          {t('print.print')}
        </button>
      </div>
      <div>
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
                      {(key) => (
                        <AnswerKeyPage
                          lesson={lesson()}
                          answerKey={key()}
                          proposed={loaded().reviewed ? [] : loaded().proposed_answers}
                        />
                      )}
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
      </div>
    </div>
  )
}
