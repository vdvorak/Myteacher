import { createMemoryHistory } from '@solidjs/router'
import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { fakeAuthApi, student } from '../auth/testing'
import lectura from '../../../schema/fixtures/es-lectura.public.json'
import type { LessonPublic } from '../generated/lesson'
import { atTheEndLesson, sampleLesson, withI18n } from '../lesson/testing'
import { ApiError } from '../lesson/api'
import { AttemptRefused, type ReleaseDetail } from './api'
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

/** Past the intro that comes before work not begun. */
async function begin(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Start' }))
}

describe('a student’s work', () => {
  it('starts an attempt from the intro and answers through it', async () => {
    const { attempts, user } = open('/work/1', [releaseOf()])

    expect(attempts.start).not.toHaveBeenCalled()
    await begin(user)
    await user.click(await screen.findByRole('radio', { name: 'está' }))
    await user.click(within(exercise(/Madrid/)).getByRole('button', { name: 'Confirm' }))

    expect(attempts.start).toHaveBeenCalledWith(1)
    expect(attempts.saveDraft).toHaveBeenCalledWith(100, 'first', 'location', { type: 'multiple_choice', option_id: 'esta' })
    expect(attempts.tryAnswer).toHaveBeenCalledWith(100, 'first', 'location', { type: 'multiple_choice', option_id: 'esta' })
    expect(await within(exercise(/Madrid/)).findByText('Correct')).toBeInTheDocument()
  })

  it('saves the answers one at a time, the latest last', async () => {
    const { attempts, user } = open('/work/1', [releaseOf()])
    await begin(user)
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
    await begin(user)

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

  it('shows what the teacher published of an assessment', async () => {
    const attempt = attemptOf(atTheEndLesson, { submitted_at: '2026-09-24T08:30:00Z' })
    attempt.first.submitted = true
    attempt.first.answers = {
      origin: {
        draft: { type: 'multiple_choice', option_id: 'sois' },
        tries: [
          {
            answer: { type: 'multiple_choice', option_id: 'sois' },
            result: { status: 'assessed', exercise_id: 'origin', score: 0, correct: false, items: [], solution: null },
            review: { score: 0.5, feedback: 'Close: *somos* is for us.', reason: 'Half right after all.' },
          },
        ],
      },
    }
    open('/work/1', [releaseOf({ feedback_mode: 'at_the_end', state: 'submitted', can_start: false, attempt })], atTheEndLesson)

    const review = await screen.findByRole('region', { name: 'Your teacher’s assessment' })
    expect(review).toHaveTextContent('50 %')
    expect(review).toHaveTextContent('Close: *somos* is for us.')
    expect(review).toHaveTextContent('Why: Half right after all.')
  })

  it('tells why an attempt was retracted and starts a new one', async () => {
    const { attempts, user } = open('/work/1', [releaseOf({ retraction: { reason: 'A typo in exercise 2.', whole_release: false } })])

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your teacher retracted your attempt: A typo in exercise 2. You can start again.',
    )
    await begin(user)
    expect(attempts.start).toHaveBeenCalledWith(1)
    expect(await screen.findByRole('radio', { name: 'está' })).toBeEnabled()
  })

  it('promises no new start after a retraction once the due date refuses one', async () => {
    const { attempts } = open('/work/1', [
      releaseOf({
        can_start: false,
        late_submissions: 'refuse',
        retraction: { reason: 'A typo in exercise 2.', whole_release: false },
      }),
    ])

    const alerts = await screen.findAllByRole('alert')
    expect(alerts.map((alert) => alert.textContent)).toEqual([
      'Your teacher retracted your attempt: A typo in exercise 2.',
      'The due date has passed and your teacher does not accept late work.',
    ])
    expect(attempts.start).not.toHaveBeenCalled()
  })

  it('tells why a whole release was withdrawn and starts nothing', async () => {
    const { attempts } = open('/work/1', [
      releaseOf({ can_start: false, retraction: { reason: 'Released by mistake.', whole_release: true } }),
    ])

    expect(await screen.findByRole('alert')).toHaveTextContent('Your teacher withdrew this work: Released by mistake.')
    expect(attempts.start).not.toHaveBeenCalled()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('takes the student out of an attempt retracted while they work in it', async () => {
    const attempt = attemptOf(sampleLesson)
    const { attempts, user } = open('/work/1', [releaseOf({ state: 'in_progress', attempt })])
    await screen.findByRole('radio', { name: 'está' })
    attempts.tryAnswer.mockRejectedValueOnce(new ApiError(410))
    attempts.release.mockResolvedValueOnce(
      releaseOf({ can_start: true, retraction: { reason: 'A typo in exercise 2.', whole_release: false } }),
    )

    await user.click(screen.getByRole('radio', { name: 'está' }))
    await user.click(within(exercise(/Madrid/)).getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText(/Your teacher retracted your attempt: A typo in exercise 2\./)).toBeInTheDocument()
    await begin(user)
    await vi.waitFor(() => expect(attempts.start).toHaveBeenCalledWith(1))
  })

  it('shows the attempt as submitted when the due date passed while they worked in it', async () => {
    const attempt = attemptOf(sampleLesson)
    const { attempts, user } = open('/work/1', [releaseOf({ state: 'in_progress', attempt })])
    await screen.findByRole('radio', { name: 'está' })
    attempts.tryAnswer.mockRejectedValueOnce(new AttemptRefused('past_due'))
    attempts.release.mockResolvedValueOnce(
      releaseOf({
        state: 'submitted',
        can_start: false,
        attempt: { ...attempt, submitted_at: '2026-09-25T08:00:00Z', first: { ...attempt.first, submitted: true } },
      }),
    )

    await user.click(screen.getByRole('radio', { name: 'está' }))
    await user.click(within(exercise(/Madrid/)).getByRole('button', { name: 'Confirm' }))

    // Submitted with the tries taken: nothing is left to confirm, and practice may follow.
    expect(await screen.findByRole('button', { name: 'Start the second round' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
    expect(attempts.release).toHaveBeenCalledTimes(2)
    expect(attempts.start).not.toHaveBeenCalled()
  })

  it('offers another attempt after finishing one resumed', async () => {
    const { user } = open(
      '/work/1',
      [
        releaseOf({
          feedback_mode: 'at_the_end',
          attempts: 'repeated',
          late_submissions: 'refuse',
          due_at: '2999-01-01T08:00:00Z',
          state: 'in_progress',
          can_start: false,
          attempt: attemptOf(atTheEndLesson),
        }),
      ],
      atTheEndLesson,
    )
    await user.click(await screen.findByRole('radio', { name: 'es' }))
    await user.click(screen.getByRole('radio', { name: 'somos' }))
    await user.click(screen.getByRole('button', { name: 'Submit answers' }))

    expect(await screen.findByRole('button', { name: 'Start another attempt' })).toBeInTheDocument()
  })

  it('offers no other attempt when the due date refuses one', async () => {
    const attempt = attemptOf(atTheEndLesson, { submitted_at: '2026-09-25T08:00:00Z' })
    open(
      '/work/1',
      [
        releaseOf({
          feedback_mode: 'at_the_end',
          attempts: 'repeated',
          late_submissions: 'refuse',
          due_at: '2026-09-25T08:00:00Z',
          state: 'submitted',
          can_start: false,
          attempt: { ...attempt, first: { ...attempt.first, submitted: true } },
        }),
      ],
      atTheEndLesson,
    )

    expect(await screen.findByRole('button', { name: 'Start the second round' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start another attempt' })).not.toBeInTheDocument()
  })

  it('offers no other attempt once the whole release is withdrawn', async () => {
    const { attempts, user } = open(
      '/work/1',
      [releaseOf({ feedback_mode: 'at_the_end', attempts: 'repeated' })],
      atTheEndLesson,
    )
    await begin(user)
    await user.click(await screen.findByRole('radio', { name: 'es' }))
    await user.click(screen.getByRole('radio', { name: 'somos' }))
    await user.click(screen.getByRole('button', { name: 'Submit answers' }))
    await screen.findByRole('button', { name: 'Start another attempt' })
    attempts.secondRound.mockRejectedValueOnce(new ApiError(410))
    attempts.release.mockResolvedValueOnce(
      releaseOf({
        feedback_mode: 'at_the_end',
        attempts: 'repeated',
        can_start: false,
        retraction: { reason: 'Released by mistake.', whole_release: true },
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Start the second round' }))

    expect(await screen.findByText('Your teacher withdrew this work: Released by mistake.')).toBeInTheDocument()
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

describe('the steps around the exercises', () => {
  it('says before the start how the work goes', async () => {
    open('/work/1', [
      releaseOf({
        feedback_mode: 'at_the_end',
        attempts: 'repeated',
        due_at: '2026-10-01T18:00:00Z',
        late_submissions: 'refuse',
        show_solutions: false,
      }),
    ])

    const intro = within(await screen.findByRole('region', { name: 'Before you start' }))
    expect(intro.getByText('You submit all your answers at once and see how you did after.')).toBeInTheDocument()
    expect(intro.getByText('You can do it again; the last one you submit counts.')).toBeInTheDocument()
    expect(
      intro.getByText(`Submit by ${new Date('2026-10-01T18:00:00Z').toLocaleString('en')}. Late work is not accepted.`),
    ).toBeInTheDocument()
    expect(intro.getByText('The solutions of wrong answers stay hidden.')).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('says when there is no due date', async () => {
    open('/work/1', [releaseOf()])

    expect(await screen.findByText('There is no due date.')).toBeInTheDocument()
  })

  it('shows the result only after the second round the first pass earned', async () => {
    const { user } = open('/work/1', [releaseOf({ feedback_mode: 'at_the_end' })], atTheEndLesson)
    await begin(user)

    await user.click(await screen.findByRole('radio', { name: 'es' }))
    await user.click(screen.getByRole('radio', { name: 'somos' }))
    await user.click(screen.getByRole('button', { name: 'Submit answers' }))

    expect(await screen.findByRole('button', { name: 'Start the second round' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Submitted' })).not.toBeInTheDocument()
  })

  it('resumes work begun without the intro', async () => {
    open('/work/1', [releaseOf({ state: 'in_progress', attempt: attemptOf(sampleLesson) })])

    expect(await screen.findByRole('radio', { name: 'está' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Before you start' })).not.toBeInTheDocument()
  })

  it('ends with the result, saying when written answers will be assessed, and the way back', async () => {
    // Only a written exercise: nothing comes back in a second round.
    const writing: LessonPublic = {
      ...atTheEndLesson,
      blocks: (lectura as LessonPublic).blocks.filter((block) => block.type === 'free_text'),
    }
    const attempt = attemptOf(writing, { submitted_at: '2026-09-24T08:30:00Z' })
    attempt.first.submitted = true
    const essay = { type: 'free_text' as const, text: 'Vivo en Brno.' }
    attempt.first.answers = {
      'your-neighbourhood': {
        draft: essay,
        tries: [
          {
            answer: essay,
            result: { status: 'pending', exercise_id: 'your-neighbourhood', reason: 'not_deterministically_assessable' },
          },
        ],
      },
    }
    open('/work/1', [releaseOf({ feedback_mode: 'at_the_end', state: 'submitted', can_start: false, attempt })], writing)

    const result = within(await screen.findByRole('region', { name: 'Submitted' }))
    expect(result.getByText(/Your teacher will assess your written answers/)).toBeInTheDocument()
    expect(result.getByRole('link', { name: 'Back to your work' })).toHaveAttribute('href', '/')
  })
})
