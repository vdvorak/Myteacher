import { Show } from 'solid-js'
import { useI18n } from './i18n/i18n'
import { PreviewPage } from './preview/PreviewPage'

const SAMPLE_LESSON = 'es-ser-estar'

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export function App(props: { location: Location }) {
  const { t } = useI18n()
  const previewMatch = () => /^\/preview\/([^/]+)\/?$/.exec(props.location.pathname)
  const seed = () => new URLSearchParams(props.location.search).get('seed') ?? 'preview'

  return (
    <Show
      when={previewMatch()}
      fallback={
        <main class="page">
          <h1>{t('app.title')}</h1>
          <a href={`/preview/${SAMPLE_LESSON}`}>{t('preview.openFixture')}</a>
        </main>
      }
    >
      {(match) => <PreviewPage lessonId={decodeSegment(match()[1])} seed={seed()} />}
    </Show>
  )
}
