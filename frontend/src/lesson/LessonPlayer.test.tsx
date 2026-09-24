import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { LessonPublic } from '../generated/lesson'
import { LessonPlayer } from './LessonPlayer'
import {
  allTypesLesson,
  atTheEndLesson,
  fakeApi,
  sampleLesson,
  unrenderedExercises,
  withI18n,
} from './testing'

beforeEach(() => localStorage.clear())

function play(lesson: LessonPublic = sampleLesson, seed = '1', api = fakeApi(lesson)) {
  const view = render(withI18n(() => <LessonPlayer lesson={lesson} seed={seed} api={api} />))
  return { ...view, api, user: userEvent.setup() }
}

const exercise = (prompt: RegExp) => screen.getByRole('group', { name: prompt })
const layout = (group: HTMLElement) =>
  within(group)
    .getAllByRole('radio')
    .map((radio) => radio.getAttribute('value'))

async function answer(user: ReturnType<typeof userEvent.setup>, prompt: RegExp, option: string) {
  await user.click(within(exercise(prompt)).getByRole('radio', { name: option }))
}

async function confirm(user: ReturnType<typeof userEvent.setup>, prompt: RegExp) {
  await user.click(within(exercise(prompt)).getByRole('button', { name: 'Confirm' }))
}

describe('rendering a multiple-choice exercise', () => {
  it('shows every option exactly once', () => {
    play()
    expect([...layout(exercise(/Madrid/))].sort()).toEqual(['es', 'esta', 'estan', 'son'])
  })

  it('lays options out the same way for the same seed and differently for another', () => {
    const first = play(sampleLesson, 'seed-a')
    const firstLayout = layout(exercise(/Madrid/))
    first.unmount()
    const again = play(sampleLesson, 'seed-a')
    expect(layout(exercise(/Madrid/))).toEqual(firstLayout)
    again.unmount()
    play(sampleLesson, 'seed-b')
    expect(layout(exercise(/Madrid/))).not.toEqual(firstLayout)
  })

  it('renders block Markdown in the prompt', () => {
    const lesson: LessonPublic = {
      ...sampleLesson,
      blocks: [{ ...sampleLesson.blocks[1], prompt: 'Elige:\n\n- uno\n- dos' } as never],
    }
    play(lesson)
    expect(within(exercise(/Elige/)).getAllByRole('listitem')).toHaveLength(2)
  })

  it('is operable by keyboard alone and sends the answer in the schema shape', async () => {
    const { user, api } = play()

    await user.tab()
    await user.keyboard(' ')
    await user.tab()
    await user.keyboard('{Enter}')

    expect(api.assess).toHaveBeenCalledTimes(1)
    const [exerciseId, sent] = api.assess.mock.calls[0]
    expect(exerciseId).toBe('location')
    expect(sent).toEqual({ type: 'multiple_choice', option_id: layout(exercise(/Madrid/))[0] })
  })
})

describe('immediate feedback', () => {
  it('cannot be confirmed before an option is picked', () => {
    play()
    expect(within(exercise(/Madrid/)).getByRole('button', { name: 'Confirm' })).toBeDisabled()
  })

  it('locks a correct answer and shows the solution with its explanation', async () => {
    const { user } = play()

    await answer(user, /Madrid/, 'está')
    await confirm(user, /Madrid/)

    const group = exercise(/Madrid/)
    expect(await within(group).findByText('Correct')).toBeInTheDocument()
    expect(within(group).getByRole('region', { name: 'Solution' })).toHaveTextContent('location')
    expect(within(group).queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
    expect(within(group).getAllByRole('radio').every((radio) => (radio as HTMLInputElement).disabled)).toBe(true)
  })

  it('gives one retry with the hint after a wrong answer, without revealing the solution', async () => {
    const { user, api } = play()

    await answer(user, /Madrid/, 'es')
    await confirm(user, /Madrid/)

    const group = exercise(/Madrid/)
    expect(await within(group).findByText('Not quite. Try once more.')).toBeInTheDocument()
    expect(within(group).getByRole('note', { name: 'Hint' })).toHaveTextContent('where')
    expect(within(group).queryByRole('region', { name: 'Solution' })).not.toBeInTheDocument()
    expect(within(group).getByRole('radio', { name: 'es' })).toBeDisabled()
    expect(api.assess.mock.calls[0][2]).toEqual({ reveal: false })
  })

  it('locks after the retry and reveals the solution even when the retry is wrong', async () => {
    const { user, api } = play()

    await answer(user, /Madrid/, 'es')
    await confirm(user, /Madrid/)
    await answer(user, /Madrid/, 'son')
    await confirm(user, /Madrid/)

    const group = exercise(/Madrid/)
    expect(await within(group).findByText('Not quite')).toBeInTheDocument()
    expect(within(group).getByRole('region', { name: 'Solution' })).toHaveTextContent('está')
    expect(within(group).queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
    expect(within(group).getAllByRole('radio').every((radio) => (radio as HTMLInputElement).disabled)).toBe(true)
    expect(api.assess).toHaveBeenCalledTimes(2)
    expect(api.assess.mock.calls[1][2]).toEqual({ reveal: true })
  })
})

describe('feedback at the end', () => {
  it('shows no correctness before submission and lets answers change', async () => {
    const { user, api } = play(atTheEndLesson)

    await answer(user, /Madrid/, 'es')
    await answer(user, /Madrid/, 'son')
    await answer(user, /Nosotros/, 'estamos')

    expect(api.assess).not.toHaveBeenCalled()
    expect(screen.queryByText(/Correct|Not quite/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
    expect(within(exercise(/Madrid/)).getByRole('radio', { name: 'son' })).toBeChecked()
  })

  it('can be submitted only once every exercise is answered', async () => {
    const { user } = play(atTheEndLesson)
    const submit = screen.getByRole('button', { name: 'Submit answers' })
    expect(submit).toBeDisabled()
    expect(screen.getByText('2 unanswered')).toBeInTheDocument()

    await answer(user, /Madrid/, 'es')
    await answer(user, /Nosotros/, 'somos')

    expect(submit).toBeEnabled()
  })

  it('shows every result after submission and locks the answers', async () => {
    const { user, api } = play(atTheEndLesson)

    await answer(user, /Madrid/, 'es')
    await answer(user, /Nosotros/, 'somos')
    await user.click(screen.getByRole('button', { name: 'Submit answers' }))

    expect(await within(exercise(/Madrid/)).findByText('Not quite')).toBeInTheDocument()
    expect(within(exercise(/Nosotros/)).getByText('Correct')).toBeInTheDocument()
    expect(within(exercise(/Madrid/)).getByRole('region', { name: 'Solution' })).toHaveTextContent('está')
    expect(screen.getAllByRole('radio').every((radio) => (radio as HTMLInputElement).disabled)).toBe(true)
    expect(api.assess.mock.calls.map((call) => call[2])).toEqual([{ reveal: true }, { reveal: true }])
  })
})

describe('second round', () => {
  async function failLocationPassOrigin(user: ReturnType<typeof userEvent.setup>) {
    await answer(user, /Madrid/, 'es')
    await confirm(user, /Madrid/)
    await answer(user, /Madrid/, 'son')
    await confirm(user, /Madrid/)
    await answer(user, /Nosotros/, 'somos')
    await confirm(user, /Nosotros/)
  }

  it('repeats only the failed exercises, re-shuffled, after the first pass', async () => {
    const { user, api } = play(sampleLesson, 'seed-a')
    const firstLayout = layout(exercise(/Madrid/))
    await failLocationPassOrigin(user)

    await user.click(await screen.findByRole('button', { name: 'Start the second round' }))

    expect(api.secondRound).toHaveBeenCalledWith(['location'], 'seed-a')
    const round = await screen.findByRole('region', { name: 'Second round' })
    const repeats = within(round).getAllByRole('group')
    expect(repeats).toHaveLength(1)
    expect(repeats[0]).toHaveAccessibleName(/Madrid/)
    expect(layout(repeats[0])).not.toEqual(firstLayout)
    expect(screen.queryByText('Lesson finished')).not.toBeInTheDocument()
  })

  it('finishes the lesson after the second round without a third', async () => {
    const { user, api } = play()
    await failLocationPassOrigin(user)
    await user.click(await screen.findByRole('button', { name: 'Start the second round' }))
    const round = await screen.findByRole('region', { name: 'Second round' })

    await user.click(within(round).getByRole('radio', { name: 'es' }))
    await user.click(within(round).getByRole('button', { name: 'Confirm' }))
    await user.click(within(round).getByRole('radio', { name: 'son' }))
    await user.click(within(round).getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText('Lesson finished')).toBeInTheDocument()
    expect(api.secondRound).toHaveBeenCalledTimes(1)
  })

  it('has no second round when nothing failed', async () => {
    const { user, api } = play()

    await answer(user, /Madrid/, 'está')
    await confirm(user, /Madrid/)
    await answer(user, /Nosotros/, 'somos')
    await confirm(user, /Nosotros/)

    expect(await screen.findByText('Lesson finished')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start the second round' })).not.toBeInTheDocument()
    expect(api.secondRound).not.toHaveBeenCalled()
  })
})

describe('resuming after a reload', () => {
  it('restores assessed and pending answers of the same lesson', async () => {
    const first = play()
    await answer(first.user, /Madrid/, 'está')
    await confirm(first.user, /Madrid/)
    await answer(first.user, /Nosotros/, 'estamos')
    await screen.findByText('Correct')
    first.unmount()

    play()

    expect(within(exercise(/Madrid/)).getByText('Correct')).toBeInTheDocument()
    expect(within(exercise(/Madrid/)).getByRole('radio', { name: 'está' })).toBeChecked()
    expect(within(exercise(/Nosotros/)).getByRole('radio', { name: 'estamos' })).toBeChecked()
  })

  it('restores unsubmitted answers in at-the-end mode', async () => {
    const first = play(atTheEndLesson)
    await answer(first.user, /Madrid/, 'son')
    first.unmount()

    play(atTheEndLesson)

    expect(within(exercise(/Madrid/)).getByRole('radio', { name: 'son' })).toBeChecked()
  })

  it('restores a second round in progress', async () => {
    const first = play()
    await answer(first.user, /Madrid/, 'es')
    await confirm(first.user, /Madrid/)
    await answer(first.user, /Madrid/, 'son')
    await confirm(first.user, /Madrid/)
    await answer(first.user, /Nosotros/, 'somos')
    await confirm(first.user, /Nosotros/)
    await first.user.click(await screen.findByRole('button', { name: 'Start the second round' }))
    await screen.findByRole('region', { name: 'Second round' })
    first.unmount()

    const second = play()

    expect(screen.getByRole('region', { name: 'Second round' })).toBeInTheDocument()
    expect(second.api.secondRound).not.toHaveBeenCalled()
  })

  it('clears saved answers when the lesson is finished', async () => {
    const first = play()
    await answer(first.user, /Madrid/, 'está')
    await confirm(first.user, /Madrid/)
    await answer(first.user, /Nosotros/, 'somos')
    await confirm(first.user, /Nosotros/)
    await screen.findByText('Lesson finished')
    expect(localStorage.length).toBe(0)
    first.unmount()

    play()

    expect(screen.queryByText('Correct')).not.toBeInTheDocument()
    expect(screen.getAllByRole('radio').some((radio) => (radio as HTMLInputElement).checked)).toBe(false)
  })

  it('does not restore answers saved for another lesson', async () => {
    const first = play()
    await answer(first.user, /Madrid/, 'es')
    first.unmount()

    play(atTheEndLesson)

    expect(within(exercise(/Madrid/)).getByRole('radio', { name: 'es' })).not.toBeChecked()
  })

  it('starts afresh when the lesson changed since the answers were saved', async () => {
    const first = play(atTheEndLesson)
    await answer(first.user, /Madrid/, 'son')
    first.unmount()
    const edited: LessonPublic = { ...atTheEndLesson, blocks: atTheEndLesson.blocks.slice(0, 2) }

    const { user } = play(edited)

    expect(within(exercise(/Madrid/)).getByRole('radio', { name: 'son' })).not.toBeChecked()
    await answer(user, /Madrid/, 'es')
    expect(screen.getByRole('button', { name: 'Submit answers' })).toBeEnabled()
  })
})

describe('exercise types without a renderer in this phase', () => {
  const placeholders = () => screen.getAllByRole('note', { name: /not supported yet/ })

  it('shows a placeholder naming the type for every one of them', () => {
    play(allTypesLesson)

    expect(placeholders()).toHaveLength(unrenderedExercises.length)
    for (const name of ['Span highlighting', 'Table fill', 'Numeric answer', 'Listening', 'Custom exercise']) {
      expect(screen.getAllByRole('note', { name: `${name}: not supported yet` })).not.toHaveLength(0)
    }
  })

  it('shows the exercise prompt where there is one', () => {
    play(allTypesLesson)

    const [highlight] = placeholders()
    expect(highlight).toHaveTextContent('Highlight every form of estar.')
    expect(screen.getAllByRole('note', { name: 'Custom exercise: not supported yet' })).toHaveLength(2)
  })

  it('names the type in Czech too', () => {
    render(
      withI18n(() => <LessonPlayer lesson={allTypesLesson} seed="1" api={fakeApi()} />, 'cs'),
    )

    expect(screen.getByRole('note', { name: 'Číselná odpověď: zatím nepodporováno' })).toBeInTheDocument()
  })

  it('does not hold up finishing the lesson', async () => {
    const { user } = play(allTypesLesson)

    await answer(user, /Madrid/, 'está')
    await confirm(user, /Madrid/)

    expect(await screen.findByText('Lesson finished')).toBeInTheDocument()
  })
})
