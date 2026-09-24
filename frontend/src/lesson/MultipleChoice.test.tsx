import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AssessmentResult, MultipleChoiceAnswer } from '../generated/lesson'
import { MultipleChoice } from './MultipleChoice'
import { locationExercise, withI18n } from './testing'

const correctResult: AssessmentResult = {
  exercise_id: 'location',
  score: 1,
  correct: true,
  solution: { type: 'multiple_choice', option_id: 'esta', explanation: 'Location takes **estar**.' },
}

function renderExercise(seed: string, assess = vi.fn(async () => correctResult)) {
  const view = render(
    withI18n(() => <MultipleChoice exercise={locationExercise} seed={seed} assess={assess} />),
  )
  const order = () => screen.getAllByRole('radio').map((radio) => radio.getAttribute('value'))
  return { ...view, order, assess }
}

describe('MultipleChoice', () => {
  it('shows every option exactly once', () => {
    const { order } = renderExercise('1')
    expect([...order()].sort()).toEqual(['es', 'esta', 'estan', 'son'])
  })

  it('lays options out the same way for the same seed', () => {
    const first = renderExercise('seed-a')
    const firstOrder = first.order()
    first.unmount()
    expect(renderExercise('seed-a').order()).toEqual(firstOrder)
  })

  it('lays options out differently for different seeds', () => {
    const first = renderExercise('seed-a')
    const firstOrder = first.order()
    first.unmount()
    expect(renderExercise('seed-b').order()).not.toEqual(firstOrder)
  })

  it('cannot be confirmed before an option is picked', () => {
    renderExercise('1')
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
  })

  it('sends the picked option in the answer shape and shows a correct result', async () => {
    const user = userEvent.setup()
    const { assess } = renderExercise('1')

    await user.click(screen.getByRole('radio', { name: 'está' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(assess).toHaveBeenCalledWith({ type: 'multiple_choice', option_id: 'esta' } satisfies MultipleChoiceAnswer)
    expect(await screen.findByText('Correct')).toBeInTheDocument()
    expect(screen.getByText('estar')).toBeInTheDocument()
  })

  it('shows an incorrect result with the solution from the backend', async () => {
    const user = userEvent.setup()
    renderExercise('1', vi.fn(async () => ({ ...correctResult, score: 0, correct: false })))

    await user.click(screen.getByRole('radio', { name: 'es' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText('Not quite')).toBeInTheDocument()
    const solution = screen.getByRole('region', { name: 'Solution' })
    expect(solution).toHaveTextContent('está')
    expect(screen.getAllByRole('radio').every((radio) => (radio as HTMLInputElement).disabled)).toBe(true)
  })

  it('is operable by keyboard alone', async () => {
    const user = userEvent.setup()
    const { assess } = renderExercise('1')

    await user.tab()
    await user.keyboard(' ')
    await user.tab()
    await user.keyboard('{Enter}')

    expect(assess).toHaveBeenCalledTimes(1)
  })

  it('lets the student retry when the check fails', async () => {
    const user = userEvent.setup()
    renderExercise('1', vi.fn(async () => Promise.reject(new Error('offline'))))

    await user.click(screen.getByRole('radio', { name: 'está' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be checked')
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled()
  })
})

describe('MultipleChoice prompt', () => {
  it('renders block Markdown in the prompt and names the group by it', () => {
    render(
      withI18n(() => (
        <MultipleChoice
          exercise={{ ...locationExercise, prompt: 'Elige:\n\n- uno\n- dos' }}
          seed="1"
          assess={vi.fn()}
        />
      )),
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('group')).toHaveAccessibleName(/Elige/)
  })
})
