import { createMemoryHistory } from '@solidjs/router'
import { render, screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { fakeAuthApi, invitedTeacher } from '../auth/testing'
import { fakeJobsApi } from '../jobs/testing'
import { withI18n } from '../lesson/testing'
import { InterviewConflict, type Course, type Interview } from './api'
import { fakeCoursesApi, spanish, type ScriptedStep } from './testing'

const teacher: Account = { ...invitedTeacher, language: 'en' }

const firstRound: ScriptedStep = {
  round: [
    { question: 'How old are your students?', recommended_answer: 'Sixteen, second year of Spanish.' },
    { question: 'Which sources should I use?', recommended_answer: 'Your textbook, chapters 1 to 4.' },
  ],
}
const secondRound: ScriptedStep = {
  round: [{ question: 'Which exercise types do you like?', recommended_answer: 'Cloze.' }],
}
const brief: ScriptedStep = {
  brief: { level: 'B1', audience: 'Sixteen-year-olds' },
  sources_offered: false,
  summary: 'The brief now describes a B1 class of sixteen-year-olds.',
}

function renderCourse(
  options: { script?: ScriptedStep[]; course?: Course; interview?: Interview; hasKey?: boolean } = {},
) {
  const course = options.course ?? spanish
  const history = createMemoryHistory()
  history.set({ value: `/courses/${course.id}` })
  const jobs = fakeJobsApi()
  const courses = fakeCoursesApi({
    courses: [course],
    script: options.script,
    interviews: options.interview ? { [course.id]: options.interview } : undefined,
    jobs,
    hasKey: options.hasKey,
  })
  const apis = fakeApis({ auth: fakeAuthApi({ signedIn: teacher }), courses, jobs })
  render(withI18n(() => <App apis={apis} history={history} />, 'en'))
  return { courses, jobs, history }
}

const panel = async () => within(await screen.findByRole('region', { name: 'Teacher interview' }))
const startInterview = async () => {
  const user = userEvent.setup()
  await user.click((await panel()).getByRole('button', { name: 'Start the interview' }))
  return user
}

describe('teacher interview', () => {
  it('starts as a job and shows the first round of numbered questions with recommendations', async () => {
    const { courses } = renderCourse({ script: [firstRound] })

    await startInterview()

    const interview = await panel()
    expect(await interview.findByRole('heading', { name: 'Round 1' })).toBeInTheDocument()
    expect(courses.startInterview).toHaveBeenCalledWith(1)
    const first = interview.getByRole('group', { name: '1. How old are your students?' })
    expect(within(first).getByText('Recommended: Sixteen, second year of Spanish.')).toBeInTheDocument()
    expect(interview.getByRole('group', { name: '2. Which sources should I use?' })).toBeInTheDocument()
  })

  it('shows the job while the assistant works', async () => {
    const { jobs } = renderCourse({ script: [firstRound] })
    jobs.pollMs = 50

    await startInterview()

    expect(await (await panel()).findByRole('status')).toHaveTextContent('The assistant is working…')
    expect(await (await panel()).findByRole('heading', { name: 'Round 1' })).toBeInTheDocument()
  })

  it('sends the answers, taking a recommendation in one click, and shows the next round', async () => {
    const { courses } = renderCourse({ script: [firstRound, secondRound] })
    const user = await startInterview()
    const interview = await panel()
    const first = within(await interview.findByRole('group', { name: '1. How old are your students?' }))
    const second = within(interview.getByRole('group', { name: '2. Which sources should I use?' }))

    await user.type(first.getByRole('textbox', { name: 'Your answer' }), 'Fifteen and sixteen.')
    await user.click(second.getByRole('button', { name: 'Use the recommendation' }))
    await user.click(interview.getByRole('button', { name: 'Send answers' }))

    expect(courses.answerInterview).toHaveBeenCalledWith(1, ['Fifteen and sixteen.', 'Your textbook, chapters 1 to 4.'])
    expect(await interview.findByRole('heading', { name: 'Round 2' })).toBeInTheDocument()
    expect(interview.queryByRole('heading', { name: 'Round 1' })).not.toBeInTheDocument()
  })

  it('applies the brief at the end, says so, and warns when there are no sources', async () => {
    renderCourse({ script: [firstRound, brief] })
    const user = await startInterview()
    const interview = await panel()

    await user.click(await interview.findByRole('button', { name: 'Send answers' }))

    expect(await interview.findByText('The brief now describes a B1 class of sixteen-year-olds.')).toBeInTheDocument()
    expect(interview.getByText(/no sources.*marked as unsourced/i)).toBeInTheDocument()
    // The brief editor shows the patched brief and stays editable.
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Level' })).toHaveValue('B1'))
    expect(screen.getByRole('textbox', { name: 'Audience' })).toHaveValue('Sixteen-year-olds')
  })

  it('is ended early, leaving the brief as it is', async () => {
    const { courses } = renderCourse({ script: [firstRound, firstRound] })
    const user = await startInterview()
    const interview = await panel()

    await user.click(await interview.findByRole('button', { name: 'End the interview' }))

    expect(courses.endInterview).toHaveBeenCalledWith(1)
    expect(await interview.findByText(/interview was ended/i)).toBeInTheDocument()
    expect(courses.changeBrief).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Level' })).toHaveValue('A2')
    await user.click(interview.getByRole('button', { name: 'Start a new interview' }))
    expect(await interview.findByRole('heading', { name: 'Round 1' })).toBeInTheDocument()
  })

  it.each([
    ['authentication', 'Your provider rejected your API key.'],
    ['quota', 'Your provider key has run out of credit or hit its rate limit.'],
    ['transient', 'The provider cannot be reached right now.'],
  ] as const)('explains a %s failure in plain words and retries', async (kind, message) => {
    const { courses } = renderCourse({ script: [{ fail: kind }, firstRound] })
    const user = await startInterview()
    const interview = await panel()

    expect(await interview.findByRole('alert')).toHaveTextContent(message)
    await user.click(interview.getByRole('button', { name: 'Try again' }))

    expect(courses.retryInterview).toHaveBeenCalledWith(1)
    expect(await interview.findByRole('heading', { name: 'Round 1' })).toBeInTheDocument()
  })

  it('shows what the assistant answered when it had the wrong shape', async () => {
    renderCourse({ script: [{ fail: 'invalid_output', raw_output: '{"questions": "none"}' }] })
    await startInterview()
    const interview = await panel()

    expect(await interview.findByRole('alert')).toHaveTextContent('did not have the expected shape')
    expect(interview.getByText('{"questions": "none"}')).toBeInTheDocument()
  })

  it('reloads when another request changed the interview first', async () => {
    const { courses } = renderCourse({ script: [firstRound] })
    const user = await startInterview()
    const interview = await panel()
    await interview.findByRole('heading', { name: 'Round 1' })
    courses.endInterview.mockRejectedValueOnce(new InterviewConflict('interview_changed'))

    await user.click(interview.getByRole('button', { name: 'End the interview' }))

    expect(await interview.findByRole('alert')).toHaveTextContent('The interview changed meanwhile and was reloaded.')
    expect(courses.interview.mock.calls.length).toBeGreaterThan(1)
  })

  it('asks for a provider key first', async () => {
    renderCourse({ hasKey: false })
    await startInterview()
    const interview = await panel()

    expect(await interview.findByRole('alert')).toHaveTextContent('Add an AI provider key in Settings first.')
    expect(interview.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
  })

  it('picks up a job still running when the page is opened', async () => {
    const jobId = 900
    const open: Interview = {
      id: 7,
      state: 'active',
      rounds: [],
      sources_offered: null,
      summary: null,
      job: { id: jobId, kind: 'course_interview', state: 'running', progress: 'asking_assistant', result: null, error_kind: null, raw_output: null },
    }
    const { jobs, courses } = renderCourse({ interview: open })
    jobs.put(open.job!, () => ({ state: 'succeeded', error_kind: null, raw_output: null }))

    expect(await (await panel()).findByRole('status')).toHaveTextContent('The assistant is working…')
    await waitFor(() => expect(courses.interview.mock.calls.length).toBeGreaterThan(1))
    expect(jobs.get).toHaveBeenCalledWith(jobId)
    await waitFor(() => expect((screen.queryByRole('status'))).not.toBeInTheDocument())
  })

  it('is not offered to a teacher who may only view the course', async () => {
    renderCourse({ course: { ...spanish, can_edit: false } })

    await screen.findByRole('heading', { name: 'Španělština 2.B' })
    expect(screen.queryByRole('button', { name: 'Start the interview' })).not.toBeInTheDocument()
  })
})
