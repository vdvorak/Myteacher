import { useParams } from '@solidjs/router'
import { createResource, Match, Switch } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import { useCourseTrail } from '../courses/trail'
import { ApiError } from '../lesson/api'
import '../preview/preview.css'
import '../preview/print.css'
import { ReferenceDocumentView } from './ReferenceDocumentView'

/** A reference document on the preview page, as it prints. */
export function DocumentPreviewPage() {
  const { t } = useI18n()
  const api = useApi().documents
  const params = useParams<{ courseId: string; topicId: string; documentId: string }>()
  const [document] = createResource(
    () => [Number(params.courseId), Number(params.topicId), Number(params.documentId)] as const,
    ([courseId, topicId, documentId]) => api.get(courseId, topicId, documentId),
  )

  useCourseTrail(() => ({
    courseId: Number(params.courseId),
    topicId: Number(params.topicId),
    page: (!document.error && document()?.title) || t('documents.previewHeading'),
  }))

  return (
    <div class="preview-page">
      <div class="print-toolbar">
        <button type="button" disabled={document.error !== undefined || !document()} onClick={() => window.print()}>
          {t('print.print')}
        </button>
      </div>
      <div>
        <Switch>
          <Match when={document.error}>
            <p role="alert">
              {document.error instanceof ApiError && document.error.status === 404
                ? t('documents.notFound')
                : t('documents.loadFailed')}
            </p>
          </Match>
          <Match when={document()}>{(loaded) => <ReferenceDocumentView document={loaded()} />}</Match>
          <Match when={document.loading}>
            <p>{t('preview.loading')}</p>
          </Match>
        </Switch>
      </div>
    </div>
  )
}
