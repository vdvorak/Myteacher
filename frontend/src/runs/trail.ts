import { createResource } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import { useBreadcrumbs, type Crumb } from '../shell/breadcrumbs'

/** Breadcrumbs inside a course run: Course runs / the run / the release / the page, each but the last a link. */
export function useRunTrail(place: () => { runId: number; releaseId?: number; page?: string }) {
  const { t } = useI18n()
  const api = useApi().runs
  const [run] = createResource(() => place().runId, (id) => api.get(id))
  const [releases] = createResource(
    () => (place().releaseId === undefined ? false : place().runId),
    (id) => api.releases(id),
  )
  useBreadcrumbs(() => {
    const { runId, releaseId, page } = place()
    const runPath = `/runs/${runId}`
    const crumbs: Crumb[] = [
      { label: t('nav.runs'), href: '/runs' },
      { label: (!run.error && run()?.name) || '…', href: runPath },
    ]
    if (releaseId !== undefined) {
      const release = releases.error ? undefined : releases()?.find((candidate) => candidate.id === releaseId)
      crumbs.push({ label: release?.title ?? '…', href: `${runPath}/releases/${releaseId}` })
    }
    if (page !== undefined) crumbs.push({ label: page })
    return crumbs
  })
}
