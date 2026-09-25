import { createMemoryHistory } from '@solidjs/router'
import { render, screen, within } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { admin, fakeAuthApi } from '../auth/testing'
import { withI18n } from '../lesson/testing'
import type { Release } from '../runs/api'
import { fakeRunsApi } from '../runs/testing'
import { jana, petr } from '../students/testing'
import type { Home } from './api'
import { attention, fakeHomeApi, nothingDone } from './testing'

const teacher: Account = { ...admin, roles: ['teacher'] }

function renderHome(options: { home?: Partial<Home>; account?: Account; runs?: Parameters<typeof fakeRunsApi>[0] } = {}) {
  const history = createMemoryHistory()
  history.set({ value: '/' })
  const apis = fakeApis({
    auth: fakeAuthApi({ signedIn: options.account ?? teacher }),
    home: fakeHomeApi(options.home),
    runs: fakeRunsApi(options.runs),
  })
  render(withI18n(() => <App apis={apis} history={history} />))
}

const hrefOf = (region: HTMLElement, name: string | RegExp) => within(region).getByRole('link', { name }).getAttribute('href')

describe('the getting-started checklist', () => {
  it('leads a new teacher through every step, from the assistant on', async () => {
    renderHome()

    const checklist = await screen.findByRole('region', { name: 'Getting started' })
    expect(within(checklist).getByText('0 of 7 done')).toBeInTheDocument()
    expect(hrefOf(checklist, /Connect the assistant/)).toBe('/settings')
    expect(hrefOf(checklist, /Create a course/)).toBe('/courses')
    expect(hrefOf(checklist, /Add sources/)).toBe('/courses')
    expect(hrefOf(checklist, /Create a class/)).toBe('/classes')
  })

  it('shows what is done and leads into the course, topic and run being set up', async () => {
    renderHome({
      home: {
        checklist: {
          ...nothingDone,
          assistant: true,
          course: true,
          sources: true,
          run: true,
          course_id: 5,
          topic_id: 9,
          run_id: 7,
        },
      },
    })

    const checklist = await screen.findByRole('region', { name: 'Getting started' })
    expect(within(checklist).getByText('3 of 7 done')).toBeInTheDocument()
    const assistant = within(checklist).getByRole('link', { name: /Connect the assistant/ })
    expect(assistant).toHaveAccessibleName('Connect the assistant, done')
    expect(hrefOf(checklist, /Create a course/)).toBe('/courses/5?tab=brief')
    expect(hrefOf(checklist, /Add sources/)).toBe('/courses/5?tab=sources')
    expect(hrefOf(checklist, /concept map/)).toBe('/courses/5/topics/9?tab=map')
    expect(within(checklist).getByRole('link', { name: /concept map/ })).toHaveAccessibleName(
      'Add topics and approve a concept map, not done yet',
    )
    expect(hrefOf(checklist, /classroom material/)).toBe('/courses/5/topics/9?tab=materials')
    expect(hrefOf(checklist, /release material/)).toBe('/runs/7')
    expect(within(checklist).getByText('The run is started: release material into it.')).toBeInTheDocument()
  })

  it('leads to the course topics before there is a topic, and to its runs before there is a run', async () => {
    renderHome({ home: { checklist: { ...nothingDone, course_id: 5 } } })

    const checklist = await screen.findByRole('region', { name: 'Getting started' })
    expect(hrefOf(checklist, /concept map/)).toBe('/courses/5?tab=topics')
    expect(hrefOf(checklist, /classroom material/)).toBe('/courses/5?tab=topics')
    expect(hrefOf(checklist, /release material/)).toBe('/courses/5?tab=runs')
  })

  it('is gone after the first release', async () => {
    renderHome({ home: { checklist: null } })

    expect(await screen.findByRole('region', { name: 'Needs attention' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Getting started' })).not.toBeInTheDocument()
  })
})

describe('what needs attention', () => {
  it('links each item to where it is dealt with', async () => {
    renderHome({
      home: {
        checklist: null,
        attention: [
          attention({ kind: 'open_answers', count: 3, course_id: 5, course_name: 'Španělština 2.B', run_id: 7, release_id: 3, title: 'Pretérito' }),
          attention({ kind: 'drafts', count: 2, course_id: 5, course_name: 'Španělština 2.B', topic_id: 9, title: 'Presente', tab: 'materials' }),
          attention({ kind: 'drafts', count: 1, course_id: 5, course_name: 'Španělština 2.B', topic_id: 9, title: 'Presente', tab: 'documents' }),
          attention({ kind: 'awaiting_consent', count: 1 }),
          attention({
            kind: 'due_soon',
            count: 1,
            course_id: 5,
            course_name: 'Španělština 2.B',
            run_id: 7,
            release_id: 4,
            title: 'Ser y estar',
            due_at: '2026-09-27T08:00:00Z',
            submitted: 1,
            total: 2,
          }),
        ],
      },
    })

    const region = await screen.findByRole('region', { name: 'Needs attention' })
    expect(hrefOf(region, 'Open answers to assess in Pretérito: 3')).toBe('/runs/7/releases/3')
    expect(hrefOf(region, 'Classroom material to review in Presente: 2')).toBe('/courses/5/topics/9?tab=materials')
    expect(hrefOf(region, 'Reference documents to review in Presente: 1')).toBe('/courses/5/topics/9?tab=documents')
    expect(hrefOf(region, 'Students awaiting guardian consent: 1')).toBe('/students')
    expect(hrefOf(region, /Ser y estar is due/)).toBe('/runs/7/releases/4')
    expect(within(region).getByText(/1 of 2 submitted/)).toBeInTheDocument()
  })

  it('says when nothing needs attention', async () => {
    renderHome({ home: { checklist: null } })

    const region = await screen.findByRole('region', { name: 'Needs attention' })
    expect(within(region).getByText('Nothing needs your attention now.')).toBeInTheDocument()
  })
})

describe('my course runs and the courses being prepared', () => {
  it('shows the latest release of each run with how many submitted', async () => {
    renderHome({
      runs: {
        runs: [{ id: 7, courseId: 1, name: 'Španělština 2.B 2026/27', classIds: [1], studentIds: [petr.id] }],
        releases: { 7: [{ id: 3, title: 'Pretérito', released_at: '2026-09-24T08:00:00Z', audience: 'run', retracted_at: null } as Release] },
        students: [jana, petr],
      },
    })

    const region = await screen.findByRole('region', { name: 'My course runs' })
    expect(hrefOf(region, 'Španělština 2.B 2026/27')).toBe('/runs/7')
    expect(hrefOf(region, 'Pretérito')).toBe('/runs/7/releases/3')
    expect(await within(region).findByText(/0 of 2 submitted/)).toBeInTheDocument()
  })

  it('leads to the courses when the teacher teaches no run', async () => {
    renderHome()

    const region = await screen.findByRole('region', { name: 'My course runs' })
    expect(await within(region).findByRole('link', { name: 'Go to courses' })).toHaveAttribute('href', '/courses')
  })

  it('lists the courses being prepared with how far each got', async () => {
    renderHome({
      home: { courses: [{ id: 5, name: 'Algebra', brief: true, sources: false, topics: 3, topics_ready: 1 }] },
    })

    const region = await screen.findByRole('region', { name: 'Courses in preparation' })
    expect(hrefOf(region, 'Algebra')).toBe('/courses/5')
    expect(within(region).getByText('Brief done · Sources not yet · Topics ready: 1 of 3')).toBeInTheDocument()
  })
})

describe('the home when it cannot be read or holds little', () => {
  it('says when the overview could not be loaded', async () => {
    const history = createMemoryHistory()
    history.set({ value: '/' })
    const home = fakeHomeApi()
    home.get.mockRejectedValueOnce(new Error('offline'))
    render(withI18n(() => <App apis={fakeApis({ auth: fakeAuthApi({ signedIn: teacher }), home })} history={history} />))

    expect(await screen.findByText('The overview could not be loaded.')).toBeInTheDocument()
  })

  it('leaves out the courses in preparation when none is', async () => {
    renderHome()

    expect(await screen.findByRole('region', { name: 'Needs attention' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Courses in preparation' })).not.toBeInTheDocument()
  })
})

describe('the instance card', () => {
  it('shows an admin what the instance lacks, with the way to fix it', async () => {
    renderHome({ account: admin, home: { instance: { smtp: false, teacher_invited: false } } })

    const card = await screen.findByRole('region', { name: 'Instance' })
    expect(hrefOf(card, /Set up email/)).toBe('/admin')
    expect(within(card).getByRole('link', { name: /Set up email/ })).toHaveAccessibleName('Set up email (SMTP), not done yet')
    expect(hrefOf(card, /Invite a teacher/)).toBe('/admin')
  })

  it('is not shown once the instance has what it needs', async () => {
    renderHome({ account: admin })

    expect(await screen.findByRole('region', { name: 'Needs attention' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Instance' })).not.toBeInTheDocument()
  })
})
