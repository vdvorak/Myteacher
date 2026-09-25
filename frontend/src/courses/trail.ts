import { createResource } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import { useBreadcrumbs, type Crumb } from '../shell/breadcrumbs'

/** Breadcrumbs inside a course: Courses / the course / the topic / the page, each but the last a link. */
export function useCourseTrail(place: () => { courseId: number; topicId?: number; page?: string }) {
  const { t } = useI18n()
  const api = useApi().courses
  const [course] = createResource(() => place().courseId, (id) => api.get(id))
  const [topics] = createResource(
    () => (place().topicId === undefined ? false : place().courseId),
    (id) => api.topics(id),
  )
  useBreadcrumbs(() => {
    const { courseId, topicId, page } = place()
    const coursePath = `/courses/${courseId}`
    const crumbs: Crumb[] = [
      { label: t('nav.courses'), href: '/courses' },
      { label: (!course.error && course()?.name) || '…', href: coursePath },
    ]
    if (topicId !== undefined) {
      const topic = topics.error ? undefined : topics()?.find((candidate) => candidate.id === topicId)
      crumbs.push({ label: topic?.name ?? '…', href: `${coursePath}/topics/${topicId}` })
    }
    if (page !== undefined) crumbs.push({ label: page })
    return crumbs
  })
}
