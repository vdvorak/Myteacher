import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import laCasa from '../../../schema/fixtures/es-la-casa.public.json'
import type { LessonPublic } from '../generated/lesson'
import { LessonPlayer, type LessonApi } from './LessonPlayer'
import { newProgress, type LessonProgress } from './progress'
import { atTheEndLesson, fakeApi, sampleLesson, withI18n } from './testing'

const casa = laCasa as LessonPublic

beforeEach(() => localStorage.clear())

function play(lesson: LessonPublic, api: LessonApi, initial: LessonProgress) {
  const onProgress = vi.fn()
  render(withI18n(() => <LessonPlayer lesson={lesson} seed="1" api={api} initial={initial} onProgress={onProgress} />))
  return { user: userEvent.setup(), onProgress }
}

const exercise = (prompt: RegExp) => screen.getByRole('group', { name: prompt })

describe('progress kept on the server', () => {
  it('resumes from it and keeps nothing in the browser', async () => {
    const initial = newProgress(sampleLesson, '1')
    initial.first.answers = {
      location: {
        draft: { type: 'multiple_choice', option_id: 'es' },
        tries: [
          {
            answer: { type: 'multiple_choice', option_id: 'es' },
            result: { status: 'assessed', exercise_id: 'location', score: 0, correct: false, items: [], solution: null },
          },
        ],
      },
      origin: { draft: { type: 'multiple_choice', option_id: 'sois' }, tries: [] },
    }
    const { user } = play(sampleLesson, fakeApi(), initial)

    expect(within(exercise(/Madrid/)).getByRole('radio', { name: 'es' })).toBeDisabled()
    expect(within(exercise(/Madrid/)).getByText(/Not quite/)).toBeInTheDocument()
    expect(within(exercise(/Brno/)).getByRole('radio', { name: 'sois' })).toBeChecked()
    await user.click(within(exercise(/Brno/)).getByRole('radio', { name: 'somos' }))
    expect(localStorage.length).toBe(0)
  })

  it('saves every answer as it is given', async () => {
    const api = { ...fakeApi(), saveDraft: vi.fn() }
    const { user } = play(sampleLesson, api, newProgress(sampleLesson, '1'))

    await user.click(within(exercise(/Madrid/)).getByRole('radio', { name: 'está' }))

    expect(api.saveDraft).toHaveBeenCalledWith('first', 'location', { type: 'multiple_choice', option_id: 'esta' })
  })

  it('submits a round at the end all at once and shows what came back', async () => {
    const api = {
      ...fakeApi(atTheEndLesson),
      submitRound: vi.fn(async () => ({
        location: {
          answer: { type: 'multiple_choice' as const, option_id: 'esta' },
          result: { status: 'assessed' as const, exercise_id: 'location', score: 1, correct: true, items: [], solution: null },
        },
        // What the server assessed, a draft saved before, even where the browser holds another.
        origin: {
          answer: { type: 'multiple_choice' as const, option_id: 'estamos' },
          result: { status: 'assessed' as const, exercise_id: 'origin', score: 0, correct: false, items: [], solution: null },
        },
      })),
    }
    const { user, onProgress } = play(atTheEndLesson, api, newProgress(atTheEndLesson, '1'))

    await user.click(within(exercise(/Madrid/)).getByRole('radio', { name: 'está' }))
    await user.click(within(exercise(/Brno/)).getByRole('radio', { name: 'sois' }))
    await user.click(screen.getByRole('button', { name: 'Submit answers' }))

    expect(api.submitRound).toHaveBeenCalledWith('first', {
      location: { type: 'multiple_choice', option_id: 'esta' },
      origin: { type: 'multiple_choice', option_id: 'sois' },
    })
    expect(api.assess).not.toHaveBeenCalled()
    expect(await within(exercise(/Brno/)).findByText('Not quite')).toBeInTheDocument()
    expect(within(exercise(/Brno/)).getByRole('radio', { name: 'estamos' }).closest('label')).toHaveAttribute('data-state', 'incorrect')
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ first: expect.objectContaining({ submitted: true }) }))
  })

  it('lays items out as the server drew them', () => {
    const initial = newProgress(casa, '1')
    initial.first.layouts = { rooms: ['r4', 'r3', 'r2', 'r1'], 'where-bathroom': ['t2', 't4', 't1', 't3'] }
    play(casa, fakeApi(casa), initial)

    const rights = within(exercise(/Match each room/)).getByRole('group', { name: 'With these' })
    expect(within(rights).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'the living room',
      'the kitchen',
      'the bedroom',
      'the bathroom',
    ])
    const pool = within(exercise(/where the bathroom is/)).getByRole('group', { name: 'Words to place' })
    expect(within(pool).getAllByRole('button', { name: /^(?!Undo)/ }).map((button) => button.textContent)).toEqual([
      'el',
      '¿Dónde',
      'baño?',
      'está',
    ])
  })
})
