import { createMemoryHistory } from '@solidjs/router'
import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { fakeAuthApi, invitedTeacher } from '../auth/testing'
import { withI18n } from '../lesson/testing'
import { fakeRunsApi } from '../runs/testing'
import type { Course, CourseSetup, Topic } from './api'
import { fakeCoursesApi, spanish, topicFixture } from './testing'

const teacher: Account = { ...invitedTeacher, language: 'en' }
const fresh: CourseSetup = spanish.setup

function renderCourse(
  options: { course?: Partial<Course>; setup?: Partial<CourseSetup>; topics?: Topic[]; path?: string; runs?: boolean } = {},
) {
  const course: Course = { ...spanish, ...options.course, setup: { ...fresh, ...options.setup } }
  const history = createMemoryHistory()
  history.set({ value: options.path ?? `/courses/${course.id}` })
  const courses = fakeCoursesApi({ courses: [course], topics: { [course.id]: options.topics ?? [] } })
  const runs = fakeRunsApi({
    runs: options.runs ? [{ id: 7, courseId: course.id, name: 'Běh 2.B', classIds: [], studentIds: [] }] : [],
  })
  const apis = fakeApis({ auth: fakeAuthApi({ signedIn: teacher }), courses, runs })
  render(withI18n(() => <App apis={apis} history={history} />, 'en'))
  return { courses, history, user: userEvent.setup() }
}

const steps = () => screen.findByRole('navigation', { name: 'Course steps' })
const tab = async (name: RegExp) => within(await steps()).getByRole('link', { name })
const nextStep = () => screen.findByRole('complementary', { name: 'Next step' })

const topics = {
  approved: topicFixture({ id: 11, name: 'Presente', position: 0, concept_map: 'approved', materials: 1, documents: 2 }),
  proposed: topicFixture({ id: 12, name: 'Pretérito indefinido', position: 1, concept_map: 'draft' }),
  bare: topicFixture({ id: 13, name: 'Pretérito imperfecto', position: 2 }),
}

describe('course steps', () => {
  it('numbers the steps, with runs and access after them, and opens on the step to do', async () => {
    renderCourse()

    const links = within(await steps())
      .getAllByRole('link')
      .map((link) => link.textContent)
    expect(links).toEqual(['1Brief, do this next', '2Sources, open', '3Topics, open', 'Course runs', 'Access'])
    expect(await tab(/Brief/)).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('region', { name: 'Course brief' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Sources' })).not.toBeInTheDocument()
  })

  it('keeps the chosen tab in the address', async () => {
    const { history, user } = renderCourse()

    await user.click(await tab(/Sources/))

    expect(history.get()).toBe('/courses/1?tab=sources')
    expect(await screen.findByRole('region', { name: 'Sources' })).toBeInTheDocument()
    const current = within(await steps()).getAllByRole('link').filter((link) => link.hasAttribute('aria-current'))
    expect(current.map((link) => link.textContent)).toEqual(['2Sources, open'])
    expect(screen.queryByRole('region', { name: 'Course brief' })).not.toBeInTheDocument()
  })

  it('marks the brief done once the interview finished, and moves on to sources', async () => {
    renderCourse({ setup: { interview_finished: true } })

    expect(await tab(/Brief/)).toHaveAccessibleName('Brief, done')
    expect(await tab(/Sources/)).toHaveAttribute('aria-current', 'page')
    const next = await nextStep()
    expect(next).toHaveTextContent('Add the sources the assistant should work from, or go on without them.')
  })

  it('leaves out the next step’s button on the tab it leads to', async () => {
    const { user } = renderCourse()

    const next = await nextStep()
    expect(within(next).queryByRole('link')).not.toBeInTheDocument()
    await user.click(await tab(/Topics/))
    expect(within(await nextStep()).getByRole('link', { name: 'Open the brief' })).toHaveAttribute(
      'href',
      '/courses/1?tab=brief',
    )
  })

  it('lets the teacher call the brief done by hand', async () => {
    const { courses, user } = renderCourse()

    await user.click(await screen.findByRole('button', { name: 'The brief is done' }))

    expect(courses.change).toHaveBeenCalledWith(spanish.id, { brief_confirmed: true })
    expect(await tab(/Brief/)).toHaveAccessibleName('Brief, done')
    // The page stays where the teacher is, though the next step moved on.
    expect(await tab(/Brief/)).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('region', { name: 'Course brief' })).toBeInTheDocument()
  })

  it('says the brief shapes what the assistant generates, and a test needs only a topic', async () => {
    renderCourse()

    expect(
      await screen.findByText(
        /The brief shapes everything the assistant generates.*To turn a test you already have into classroom material, a topic is enough/,
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the course topics' })).toHaveAttribute('href', '/courses/1?tab=topics')
  })

  it('goes on without sources when the teacher chooses to, and back again', async () => {
    const { courses, user } = renderCourse({ path: '/courses/1?tab=sources', setup: { brief_confirmed: true } })

    await user.click(await screen.findByRole('button', { name: 'Continue without sources' }))

    expect(courses.change).toHaveBeenCalledWith(spanish.id, { sources_skipped: true })
    expect(await tab(/Sources/)).toHaveAccessibleName('Sources, done')
    await user.click(screen.getByRole('button', { name: 'Use sources after all' }))
    expect(courses.change).toHaveBeenCalledWith(spanish.id, { sources_skipped: false })
  })

  it('counts a read source as the sources step done', async () => {
    renderCourse({ setup: { brief_confirmed: true, read_sources: 2 } })

    expect(await tab(/Sources/)).toHaveAccessibleName('Sources, done')
  })

  it('shows how many topics have material, and points to the topic whose map waits for approval', async () => {
    renderCourse({ setup: { brief_confirmed: true, sources_skipped: true }, topics: Object.values(topics) })

    expect(await tab(/Topics/)).toHaveAccessibleName('Topics, done1 of 3 ready')
    const next = await nextStep()
    expect(next).toHaveTextContent('Start a course run to release the material to your students.')
    expect(within(next).getByRole('link', { name: 'Start a course run' })).toHaveAttribute('href', '/courses/1?tab=runs')
  })

  it('asks for approving the first proposed map before there is any material', async () => {
    renderCourse({
      setup: { brief_confirmed: true, sources_skipped: true },
      topics: [topics.proposed, topics.bare],
    })

    const next = await nextStep()
    expect(next).toHaveTextContent('Approve the concept map of “Pretérito indefinido”.')
    expect(within(next).getByRole('link', { name: 'Open the topic' })).toHaveAttribute(
      'href',
      '/courses/1/topics/12?tab=map',
    )
  })

  it('asks for topics when there are none', async () => {
    renderCourse({ setup: { brief_confirmed: true, sources_skipped: true } })

    expect(await nextStep()).toHaveTextContent('Add the topics you will teach, in the order you teach them.')
  })

  it('says nothing more once a run is going', async () => {
    renderCourse({ setup: { brief_confirmed: true, sources_skipped: true }, topics: [topics.approved], runs: true })

    await steps()
    await screen.findByRole('region', { name: 'Topics' })
    expect(screen.queryByRole('complementary', { name: 'Next step' })).not.toBeInTheDocument()
  })

  it('starts a run from the page header', async () => {
    const { history, user } = renderCourse()

    await user.click(await screen.findByRole('link', { name: 'Start a course run' }))

    expect(history.get()).toBe('/courses/1?tab=runs')
    expect(await screen.findByRole('region', { name: 'Course runs' })).toBeInTheDocument()
  })

  it('shows access only to those who manage it', async () => {
    renderCourse({ course: { access: 'view', can_edit: false, can_manage_access: false, can_fork: false } })

    const links = within(await steps())
      .getAllByRole('link')
      .map((link) => link.textContent)
    expect(links).not.toContain('Access')
    expect(screen.queryByRole('button', { name: 'The brief is done' })).not.toBeInTheDocument()
    expect(screen.queryByText(/a topic is enough/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Go to the course topics' })).not.toBeInTheDocument()
  })

  it('edits the basics from More actions', async () => {
    const { courses, user } = renderCourse()

    await user.click(await screen.findByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('button', { name: 'Edit the basics' }))
    const name = screen.getByRole('textbox', { name: 'Course name' })
    await user.clear(name)
    await user.type(name, 'Španělština 3.B')
    await user.click(screen.getByRole('button', { name: 'Save course' }))

    expect(courses.change).toHaveBeenCalledWith(spanish.id, expect.objectContaining({ name: 'Španělština 3.B' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Španělština 3.B' })).toBeInTheDocument()
  })
})
