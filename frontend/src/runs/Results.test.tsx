import { createMemoryHistory } from '@solidjs/router'
import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import { attemptOf } from '../attempts/testing'
import type { Account } from '../auth/api'
import { fakeAuthApi, invitedTeacher, student } from '../auth/testing'
import { atTheEndLesson, withI18n } from '../lesson/testing'
import { jana, petr } from '../students/testing'
import { defaultSettings, type Release, type ReleaseResults, type StudentAttempts } from './api'
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
  ...defaultSettings,
}
const results: ReleaseResults = {
  release,
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

function open(path: string, options: { studentResults?: Record<string, StudentAttempts>; as?: Account } = {}) {
  const history = createMemoryHistory()
  history.set({ value: path })
  const runs = fakeRunsApi({
    runs: [{ id: 7, courseId: 1, name: '2.B 2026/27', classIds: [], studentIds: [] }],
    releases: { 7: [release] },
    results: { 3: results },
    studentResults: options.studentResults,
  })
  const apis = fakeApis({ auth: fakeAuthApi({ signedIn: options.as ?? teacher }), runs })
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
      { ...counted, counts: true },
      { ...earlier, counts: false },
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
