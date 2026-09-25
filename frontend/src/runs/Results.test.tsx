import { createMemoryHistory } from '@solidjs/router'
import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import { attemptOf } from '../attempts/testing'
import type { Account } from '../auth/api'
import { fakeAuthApi, invitedTeacher, student } from '../auth/testing'
import { atTheEndLesson, withI18n } from '../lesson/testing'
import { jana, petr } from '../students/testing'
import { fakeJobsApi } from '../jobs/testing'
import { AssessmentRefused, defaultSettings, type Release, type ReleaseResults, type StudentAttempts } from './api'
import { fakeRunsApi } from './testing'

const teacher: Account = { ...invitedTeacher, language: 'en' }
const release: Release = {
  id: 3,
  material_id: 4,
  title: 'Pretérito in class',
  topic: 'Pretérito indefinido',
  version: 1,
  audience: 'run',
  students: [],
  released_by_id: 2,
  released_at: '2026-09-24T08:00:00Z',
  retracted_at: null,
  retraction_reason: null,
  ...defaultSettings,
}
const results: ReleaseResults = {
  release,
  open_answers: { waiting: 1, assessed: 0, flagged: 0, unpublished: 0 },
  exercises: [
    { id: 'location', type: 'multiple_choice', prompt: '¿Dónde ___ Madrid?', right: 1, wrong: 1, open: 0, unanswered: 0 },
    { id: 'write', type: 'free_text', prompt: 'Write about yourself.', right: 0, wrong: 0, open: 1, unanswered: 1 },
  ],
  students: [
    {
      id: jana.id,
      name: jana.name,
      in_run: true,
      state: 'submitted',
      late: true,
      attempts: 2,
      cells: { location: 'wrong', write: 'open' },
    },
    { id: petr.id, name: petr.name, in_run: false, state: 'submitted', late: false, attempts: 1, cells: { location: 'right', write: 'unanswered' } },
    { id: 77, name: 'Eva Malá', in_run: true, state: 'not_started', late: false, attempts: 0, cells: {} },
  ],
}

function open(
  path: string,
  options: {
    studentResults?: Record<string, StudentAttempts>
    as?: Account
    results?: ReleaseResults
    release?: Release
  } = {},
) {
  const history = createMemoryHistory()
  history.set({ value: path })
  const jobs = fakeJobsApi()
  const runs = fakeRunsApi({
    runs: [{ id: 7, courseId: 1, name: '2.B 2026/27', classIds: [], studentIds: [] }],
    releases: { 7: [options.release ?? release] },
    results: { 3: options.results ?? results },
    studentResults: options.studentResults,
    jobs,
  })
  const apis = fakeApis({ auth: fakeAuthApi({ signedIn: options.as ?? teacher }), runs, jobs })
  render(withI18n(() => <App apis={apis} history={history} />, 'en'))
  return { runs, history, user: userEvent.setup() }
}

const row = (table: HTMLElement, name: string) => within(table).getByRole('link', { name }).closest('tr')!

describe('the results of a release', () => {
  it('opens from the run’s releases', async () => {
    const { history, user } = open('/runs/7')

    await user.click(await screen.findByRole('link', { name: 'Pretérito in class' }))

    expect(history.get()).toBe('/runs/7/releases/3')
  })

  it('shows every student × exercise, with late, not started and left marks', async () => {
    open('/runs/7/releases/3')

    const table = await screen.findByRole('table', { name: 'Results' })
    expect(within(table).getByRole('columnheader', { name: /Exercise 1/ })).toHaveAttribute('title', '¿Dónde ___ Madrid?')
    const janas = within(row(table, 'Jana Veselá'))
    expect(janas.getByText('Wrong')).toBeInTheDocument()
    expect(janas.getByText('Waiting for assessment')).toBeInTheDocument()
    expect(janas.getByText(/Late/)).toBeInTheDocument()
    expect(janas.getByText(/Attempts: 2/)).toBeInTheDocument()
    const petrs = within(row(table, 'Petr Malý'))
    expect(petrs.getByText('No longer in the run')).toBeInTheDocument()
    expect(petrs.getByText('Right')).toBeInTheDocument()
    expect(petrs.getByText('Not answered')).toBeInTheDocument()
    expect(within(row(table, 'Eva Malá')).getByText('Not started')).toBeInTheDocument()
  })

  it('sums up how many got each exercise wrong', async () => {
    open('/runs/7/releases/3')

    const summary = await screen.findByRole('table', { name: 'Exercises' })
    const first = within(summary).getByText('¿Dónde ___ Madrid?').closest('tr')!
    expect([...first.querySelectorAll('td')].map((cell) => cell.textContent)).toEqual(['¿Dónde ___ Madrid?', '1', '1', '0', '0'])
  })

  it('says when the release is not one of the run', async () => {
    open('/runs/7/releases/9')

    expect(await screen.findByRole('alert')).toHaveTextContent('No such release in this run.')
  })

  it('is for teachers only', async () => {
    open('/runs/7/releases/3', { as: { ...student, language: 'en' } })

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Results' })).not.toBeInTheDocument()
  })
})

describe('a student’s results', () => {
  const counted = attemptOf(atTheEndLesson, { id: 12, number: 2, submitted_at: '2026-09-24T09:00:00Z', late: true })
  counted.first.submitted = true
  counted.first.answers = {
    location: {
      draft: { type: 'multiple_choice', option_id: 'es' },
      tries: [
        {
          answer: { type: 'multiple_choice', option_id: 'es' },
          result: {
            status: 'assessed',
            exercise_id: 'location',
            score: 0,
            correct: false,
            items: [],
            solution: { type: 'multiple_choice', option_id: 'esta', explanation: 'Location takes *estar*.' },
          },
        },
      ],
    },
  }
  const earlier = attemptOf(atTheEndLesson, { id: 11, number: 1, submitted_at: '2026-09-24T08:30:00Z' })
  const detail: StudentAttempts = {
    student: { id: jana.id, name: jana.name, in_run: true },
    attempts: [
      { ...counted, counts: true, retracted_at: null, retraction_reason: null },
      { ...earlier, counts: false, retracted_at: null, retraction_reason: null },
    ],
  }

  it('shows every attempt, the one that counts first, with each answer, its assessment and solution', async () => {
    const { user } = open('/runs/7/releases/3', { studentResults: { [`3:${jana.id}`]: detail } })

    await user.click(await screen.findByRole('link', { name: 'Jana Veselá' }))

    const latest = await screen.findByRole('region', { name: 'Attempt 2' })
    expect(within(latest).getByText('This attempt counts.')).toBeInTheDocument()
    expect(within(latest).getByRole('radio', { name: 'es' })).toBeChecked()
    expect(within(latest).getByRole('radio', { name: 'es' })).toBeDisabled()
    expect(within(latest).getByText('Location takes', { exact: false })).toBeInTheDocument()
    expect(within(latest).queryByRole('button', { name: 'Submit answers' })).not.toBeInTheDocument()
    const first = screen.getByRole('region', { name: 'Attempt 1' })
    expect(within(first).queryByText('This attempt counts.')).not.toBeInTheDocument()
    expect(within(first).queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('assessing open answers and publishing results', () => {
  it('assesses the waiting open answers with the assistant, then publishes them', async () => {
    const { runs, user } = open('/runs/7/releases/3')
    const panel = () => within(screen.getByRole('region', { name: 'Open answers' }))

    expect(await screen.findByText(/Waiting for assessment: 1 · assessed by the assistant: 0/)).toBeInTheDocument()
    expect(panel().getByRole('button', { name: 'Publish results' })).toBeDisabled()
    await user.click(panel().getByRole('button', { name: 'Assess open answers' }))

    expect(runs.assessOpenAnswers).toHaveBeenCalledWith(7, 3)
    expect(await screen.findByText(/Waiting for assessment: 0 · assessed by the assistant: 1/)).toBeInTheDocument()
    expect(panel().getByText('Not shown to students yet: 1')).toBeInTheDocument()
    await user.click(panel().getByRole('button', { name: 'Publish results' }))

    expect(runs.publish).toHaveBeenCalledWith(7, 3)
    expect(await panel().findByRole('status')).toHaveTextContent('Published to students: 1')
    expect(panel().getByRole('button', { name: 'Publish results' })).toBeDisabled()
  })

  it('says why assessing was refused, with the way to a key', async () => {
    const { runs, user } = open('/runs/7/releases/3')
    runs.assessOpenAnswers.mockRejectedValueOnce(new AssessmentRefused('no_provider_key'))

    await user.click(await screen.findByRole('button', { name: 'Assess open answers' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Add your key in the settings to assess with the assistant.')
    expect(within(alert).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
  })

  it('offers nothing to assess when no open answer waits', async () => {
    open('/runs/7/releases/3', { results: { ...results, open_answers: { waiting: 0, assessed: 2, flagged: 0, unpublished: 0 } } })

    expect(await screen.findByRole('button', { name: 'Assess open answers' })).toBeDisabled()
  })
})

describe('the teacher’s own scores', () => {
  const written = attemptOf(atTheEndLesson, { id: 12, submitted_at: '2026-09-24T09:00:00Z' })
  written.first.submitted = true
  const review = {
    id: 40,
    score: 1,
    assistant_score: 1,
    justification: 'Says where she lives, as the rubric asks.',
    feedback: 'Well done.',
    flagged: false,
    override_score: null,
    override_reason: null,
    published: false,
  }
  written.first.answers = {
    origin: {
      draft: { type: 'multiple_choice', option_id: 'somos' },
      tries: [
        {
          answer: { type: 'multiple_choice', option_id: 'somos' },
          result: { status: 'assessed', exercise_id: 'origin', score: 1, correct: true, items: [], solution: null },
          assessment: review,
        },
      ],
    },
  }
  const detail: StudentAttempts = {
    student: { id: jana.id, name: jana.name, in_run: true },
    attempts: [{ ...written, counts: true, retracted_at: null, retraction_reason: null }],
  }

  it('shows each assessment and saves the teacher’s score with a reason', async () => {
    const { runs, user } = open(`/runs/7/releases/3/students/${jana.id}`, {
      studentResults: { [`3:${jana.id}`]: detail },
    })

    const table = await screen.findByRole('table', { name: 'Assessments of attempt 1' })
    const row = within(within(table).getByRole('rowheader', { name: '2' }).closest('tr')!)
    expect(row.getByText('100 %')).toBeInTheDocument()
    expect(row.getByText('Says where she lives, as the rubric asks.')).toBeInTheDocument()
    expect(row.getByText('For the student: Well done.')).toBeInTheDocument()
    expect(row.getByText('Not published yet')).toBeInTheDocument()
    await user.type(row.getByLabelText('Score (%)'), '50')
    await user.type(row.getByLabelText('Reason'), 'Only half of it.')
    await user.click(row.getByRole('button', { name: 'Save' }))

    expect(runs.override).toHaveBeenCalledWith(7, 3, 40, 0.5, 'Only half of it.')
    const refreshed = within(await screen.findByRole('table', { name: 'Assessments of attempt 1' }))
    expect(await refreshed.findByText('50 %')).toBeInTheDocument()
    expect(refreshed.getByText('Your reason: Only half of it.')).toBeInTheDocument()
  })

  it('offers no score of its own for an attempt still in progress', async () => {
    const inProgress = structuredClone(detail)
    inProgress.attempts[0].submitted_at = null
    open(`/runs/7/releases/3/students/${jana.id}`, { studentResults: { [`3:${jana.id}`]: inProgress } })

    const table = await screen.findByRole('table', { name: 'Assessments of attempt 1' })
    expect(within(table).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(within(table).getByText('Not submitted yet')).toBeInTheDocument()
  })

  it('asks the teacher to score what the assistant could not', async () => {
    const flagged = structuredClone(detail)
    Object.assign(flagged.attempts[0].first.answers.origin.tries[0].assessment!, {
      score: null,
      assistant_score: null,
      justification: null,
      feedback: null,
      flagged: true,
    })
    open(`/runs/7/releases/3/students/${jana.id}`, { studentResults: { [`3:${jana.id}`]: flagged } })

    expect(await screen.findByText('The assistant could not assess it; score it yourself.')).toBeInTheDocument()
  })
})

describe('retracting', () => {
  it('retracts a whole release with a reason, and marks it', async () => {
    const { runs, user } = open('/runs/7/releases/3')

    await user.type(await screen.findByLabelText('Reason for the students'), 'Released by mistake.')
    await user.click(screen.getByRole('button', { name: 'Retract the release' }))

    expect(runs.retractRelease).toHaveBeenCalledWith(7, 3, 'Released by mistake.')
    expect(await screen.findByText('Retracted: Released by mistake.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retract the release' })).not.toBeInTheDocument()
  })

  it('marks a retracted release among the run’s releases', async () => {
    open('/runs/7', { release: { ...release, retracted_at: '2026-09-25T09:00:00Z', retraction_reason: 'Oops.' } })

    const row = (await screen.findByRole('link', { name: 'Pretérito in class' })).closest('td')!
    expect(row).toHaveTextContent('Retracted')
  })

  it('retracts a student’s attempt with a reason, keeping its answers', async () => {
    const attempt = attemptOf(atTheEndLesson, { id: 12, submitted_at: '2026-09-24T09:00:00Z' })
    const { runs, user } = open(`/runs/7/releases/3/students/${jana.id}`, {
      studentResults: {
        [`3:${jana.id}`]: {
          student: { id: jana.id, name: jana.name, in_run: true },
          attempts: [{ ...attempt, counts: true, retracted_at: null, retraction_reason: null }],
        },
      },
    })

    await user.type(await screen.findByLabelText('Reason for the students'), 'A typo in exercise 2.')
    await user.click(screen.getByRole('button', { name: 'Retract the attempt' }))

    expect(runs.retractAttempt).toHaveBeenCalledWith(7, 3, jana.id, 'A typo in exercise 2.')
    const kept = await screen.findByRole('region', { name: 'Attempt 1' })
    expect(await within(kept).findByText('Retracted: A typo in exercise 2.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retract the attempt' })).not.toBeInTheDocument()
  })

  it('does not call a retraction failed when only reading the page again failed', async () => {
    const attempt = attemptOf(atTheEndLesson, { id: 12, submitted_at: '2026-09-24T09:00:00Z' })
    const { runs, user } = open(`/runs/7/releases/3/students/${jana.id}`, {
      studentResults: {
        [`3:${jana.id}`]: {
          student: { id: jana.id, name: jana.name, in_run: true },
          attempts: [{ ...attempt, counts: true, retracted_at: null, retraction_reason: null }],
        },
      },
    })
    await user.type(await screen.findByLabelText('Reason for the students'), 'A typo in exercise 2.')
    runs.studentResults.mockRejectedValueOnce(new Error('offline'))

    await user.click(screen.getByRole('button', { name: 'Retract the attempt' }))

    await vi.waitFor(() => expect(runs.retractAttempt).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('The retraction failed. Try again.')).not.toBeInTheDocument()
  })
})
