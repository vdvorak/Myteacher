import { createMemoryHistory } from '@solidjs/router'
import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { fakeAuthApi, student } from '../auth/testing'
import { atTheEndLesson, sampleLesson, withI18n } from '../lesson/testing'
import type { ReleaseDetail } from './api'
import { attemptOf, fakeAttemptsApi, releaseOf } from './testing'

const jana: Account = { ...student, language: 'en' }

beforeEach(() => localStorage.clear())

function open(path: string, releases: ReleaseDetail[], lesson = sampleLesson) {
  const history = createMemoryHistory()
  history.set({ value: path })
  const attempts = fakeAttemptsApi({ releases, lesson })
  const apis = fakeApis({ auth: fakeAuthApi({ signedIn: jana }), attempts })
  render(withI18n(() => <App apis={apis} history={history} />, 'en'))
  return { attempts, history, user: userEvent.setup() }
}

const exercise = (prompt: RegExp) => screen.getByRole('group', { name: prompt })

describe('a student’s work', () => {
  it('lists what is released to them, with where they stand and the due date', async () => {
    open('/', [
      releaseOf({ id: 1, title: 'Ser, or estar?', due_at: '2026-10-01T18:00:00Z' }),
      releaseOf({ id: 2, title: 'Pretérito', state: 'submitted', late: true, due_at: '2026-09-20T18:00:00Z' }),
    ])

    const list = within(await screen.findByRole('list', { name: 'Your work' }))
    const first = list.getByRole('link', { name: 'Ser, or estar?' }).closest('li')!
    expect(first).toHaveTextContent('Ser y estar · Španělština 2.B')
    expect(first).toHaveTextContent('Not started')
    expect(first).toHaveTextContent(`Due ${new Date('2026-10-01T18:00:00Z').toLocaleString('en')}`)
    expect(list.getByRole('link', { name: 'Ser, or estar?' })).toHaveAttribute('href', '/work/1')
    const second = list.getByRole('link', { name: 'Pretérito' }).closest('li')!
    expect(second).toHaveTextContent('Submitted')
    expect(second).toHaveTextContent('Submitted late')
    expect(second).not.toHaveTextContent('Due')
  })

  it('says when nothing is released yet', async () => {
    open('/', [])

    expect(await screen.findByText(/Your lessons will appear here/)).toBeInTheDocument()
  })

  it('starts an attempt on opening and answers through it', async () => {
    const { attempts, user } = open('/work/1', [releaseOf()])

    await user.click(await screen.findByRole('radio', { name: 'está' }))
    await user.click(within(exercise(/Madrid/)).getByRole('button', { name: 'Confirm' }))

    expect(attempts.start).toHaveBeenCalledWith(1)
    expect(attempts.saveDraft).toHaveBeenCalledWith(100, 'first', 'location', { type: 'multiple_choice', option_id: 'esta' })
    expect(attempts.tryAnswer).toHaveBeenCalledWith(100, 'first', 'location', { type: 'multiple_choice', option_id: 'esta' })
    expect(await within(exercise(/Madrid/)).findByText('Correct')).toBeInTheDocument()
  })

  it('saves the answers one at a time, the latest last', async () => {
    const { attempts, user } = open('/work/1', [releaseOf()])
    const saved: (() => void)[] = []
    attempts.saveDraft.mockImplementation(() => new Promise<void>((resolve) => saved.push(resolve)))

    await user.click(await screen.findByRole('radio', { name: 'es' }))
    await user.click(screen.getAllByRole('radio', { name: 'son' })[0])
    await user.click(screen.getAllByRole('radio', { name: 'están' })[0])
    expect(attempts.saveDraft).toHaveBeenCalledTimes(1)
    saved[0]()

    await vi.waitFor(() => expect(attempts.saveDraft).toHaveBeenCalledTimes(2))
    expect(attempts.saveDraft).toHaveBeenLastCalledWith(100, 'first', 'location', {
      type: 'multiple_choice',
      option_id: 'estan',
    })
  })

  it('resumes an attempt where it was left, on any device', async () => {
    const attempt = attemptOf(sampleLesson)
    attempt.first.answers = { origin: { draft: { type: 'multiple_choice', option_id: 'sois' }, tries: [] } }
    const { attempts } = open('/work/1', [releaseOf({ state: 'in_progress', attempt })])

    expect(await screen.findByRole('radio', { name: 'sois' })).toBeChecked()
    expect(attempts.start).not.toHaveBeenCalled()
  })

  it('sends a round at the end as one submission, then offers another attempt where allowed', async () => {
    const { attempts, user } = open(
      '/work/1',
      [releaseOf({ feedback_mode: 'at_the_end', attempts: 'repeated' })],
      atTheEndLesson,
    )

    await user.click(await screen.findByRole('radio', { name: 'está' }))
    await user.click(screen.getByRole('radio', { name: 'somos' }))
    expect(screen.queryByRole('button', { name: 'Start another attempt' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Submit answers' }))

    expect(attempts.submitRound).toHaveBeenCalledWith(100, 'first', {
      location: { type: 'multiple_choice', option_id: 'esta' },
      origin: { type: 'multiple_choice', option_id: 'somos' },
    })
    await user.click(await screen.findByRole('button', { name: 'Start another attempt' }))
    expect(await screen.findByText('Attempt 2')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'está' })).not.toBeChecked()
  })

  it('offers no other attempt when the release takes one', async () => {
    const attempt = attemptOf(atTheEndLesson, { submitted_at: '2026-09-24T08:30:00Z' })
    attempt.first.submitted = true
    open('/work/1', [releaseOf({ feedback_mode: 'at_the_end', state: 'submitted', can_start: false, attempt })], atTheEndLesson)

    expect(await screen.findByRole('radio', { name: 'está' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Start another attempt' })).not.toBeInTheDocument()
  })

  it('says when the due date has passed and late work is refused', async () => {
    const { attempts } = open('/work/1', [releaseOf({ can_start: false, late_submissions: 'refuse' })])

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The due date has passed and your teacher does not accept late work.',
    )
    expect(attempts.start).not.toHaveBeenCalled()
  })

  it('says when the work is not theirs', async () => {
    open('/work/9', [])

    expect(await screen.findByRole('alert')).toHaveTextContent('This work is not for you, or it is no longer available.')
  })
})
