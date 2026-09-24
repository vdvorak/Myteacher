import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import irregularVerbs from '../../../schema/fixtures/en-irregular-verbs.public.json'
import vocabulary from '../../../schema/fixtures/es-vocabulario.public.json'
import type { LessonPublic } from '../generated/lesson'
import { LessonPlayer } from './LessonPlayer'
import { fakeApi, withI18n } from './testing'

const immediate = vocabulary as LessonPublic
const atTheEnd = irregularVerbs as LessonPublic

beforeEach(() => localStorage.clear())

function play(lesson: LessonPublic, seed = '1') {
  const api = fakeApi(lesson)
  const view = render(withI18n(() => <LessonPlayer lesson={lesson} seed={seed} api={api} />))
  return { ...view, api, user: userEvent.setup() }
}

const exercise = (prompt: RegExp) => screen.getByRole('group', { name: prompt })
const confirmIn = (group: HTMLElement) => within(group).getByRole('button', { name: 'Confirm' })

describe('short answer', () => {
  const song = () => exercise(/word for \*?song/)

  it('is a text input suited to the mobile keyboard', () => {
    play(immediate)

    const input = within(song()).getByRole('textbox', { name: 'Your answer' })
    expect(input).toHaveAttribute('autocapitalize', 'none')
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(input).toHaveAttribute('spellcheck', 'false')
    expect(confirmIn(song())).toBeDisabled()
  })

  it('sends the typed text, gives one retry with the hint, then locks with the solution', async () => {
    const { user, api } = play(immediate)
    const input = within(song()).getByRole('textbox', { name: 'Your answer' })

    await user.type(input, 'cancion{Enter}')

    expect(api.assess).toHaveBeenCalledWith('song', { type: 'short_answer', text: 'cancion' }, { reveal: false })
    expect(await within(song()).findByText('Not quite. Try once more.')).toBeInTheDocument()
    expect(within(song()).getByRole('note', { name: 'Hint' })).toBeInTheDocument()

    await user.clear(input)
    await user.type(input, 'canción')
    await user.click(confirmIn(song()))

    expect(await within(song()).findByText('Correct')).toBeInTheDocument()
    expect(within(song()).getByRole('region', { name: 'Solution' })).toHaveTextContent('canción')
    expect(input).toBeDisabled()
  })

  it('does not spend the retry on the answer already tried', async () => {
    const { user, api } = play(immediate)
    const input = within(song()).getByRole('textbox', { name: 'Your answer' })
    await user.type(input, 'cancion{Enter}')
    await within(song()).findByText('Not quite. Try once more.')

    await user.type(input, '{Enter}')

    expect(confirmIn(song())).toBeDisabled()
    expect(api.assess).toHaveBeenCalledTimes(1)
    await user.type(input, 'e')
    expect(confirmIn(song())).toBeEnabled()
  })

  it('shows the hint up front when the exercise asks for it', () => {
    const lesson: LessonPublic = {
      ...immediate,
      blocks: immediate.blocks.map((block) =>
        block.type === 'short_answer' && block.id === 'song' ? { ...block, show_hint: true } : block,
      ),
    }
    play(lesson)

    expect(within(song()).getByRole('note', { name: 'Hint' })).toBeInTheDocument()
  })

  it('counts a blank answer as unanswered in at-the-end mode', async () => {
    const { user } = play(atTheEnd)
    const input = within(exercise(/short form/)).getByRole('textbox')

    await user.type(input, '   ')

    expect(screen.getByText('2 unanswered')).toBeInTheDocument()
  })
})

describe('cloze without a word bank', () => {
  const yesterday = () => exercise(/past simple/)

  it('has one text input per gap and sends them all in the answer shape', async () => {
    const { user, api } = play(atTheEnd)
    const gaps = within(yesterday()).getAllByRole('textbox')
    expect(gaps.map((gap) => gap.getAttribute('aria-label'))).toEqual(['Gap 1', 'Gap 2'])

    await user.type(gaps[0], 'went')
    await user.type(gaps[1], 'seed')
    await user.type(within(exercise(/short form/)).getByRole('textbox'), "don't")
    await user.click(screen.getByRole('button', { name: 'Submit answers' }))

    expect(api.assess).toHaveBeenCalledWith(
      'yesterday',
      { type: 'cloze', gaps: { v1: 'went', v3: 'seed' } },
      { reveal: true },
    )
    expect(await within(yesterday()).findByText('Not quite')).toBeInTheDocument()
    expect(gaps[0]).toHaveAttribute('data-state', 'correct')
    expect(gaps[1]).toHaveAttribute('data-state', 'incorrect')
    expect(within(yesterday()).getByRole('region', { name: 'Solution' })).toHaveTextContent(
      'Yesterday I went (go) to the market, bought (buy) some apples and saw (see) an old friend.',
    )
  })

  it('is unanswered until every gap is filled', async () => {
    const { user } = play(atTheEnd)
    const gaps = within(yesterday()).getAllByRole('textbox')

    await user.type(gaps[0], 'went')

    expect(screen.getByText('2 unanswered')).toBeInTheDocument()
    await user.type(gaps[1], 'saw')
    expect(screen.getByText('1 unanswered')).toBeInTheDocument()
  })

  it('keeps typed gaps across a reload', async () => {
    const first = play(atTheEnd)
    await first.user.type(within(yesterday()).getAllByRole('textbox')[1], 'saw')
    first.unmount()

    play(atTheEnd)

    expect(within(yesterday()).getAllByRole('textbox')[1]).toHaveValue('saw')
  })
})

describe('cloze with a word bank', () => {
  const tomorrow = () => exercise(/words from the bank/)
  const bank = () => within(tomorrow()).getByRole('group', { name: 'Word bank' })
  const gap = (n: number) => within(tomorrow()).getByRole('button', { name: new RegExp(`^Gap ${n}:`) })
  const word = (text: string) => within(bank()).getByRole('button', { name: text })

  it('places a tapped word into the tapped gap and takes it out of the bank', async () => {
    const { user } = play(immediate)

    await user.click(word('vamos'))
    expect(word('vamos')).toHaveAttribute('aria-pressed', 'true')
    await user.click(gap(1))

    expect(gap(1)).toHaveAccessibleName('Gap 1: vamos')
    expect(within(bank()).queryByRole('button', { name: 'vamos' })).not.toBeInTheDocument()
  })

  it('takes a placed word back to the bank when its gap is tapped again', async () => {
    const { user } = play(immediate)
    await user.click(word('vamos'))
    await user.click(gap(1))

    await user.click(gap(1))

    expect(gap(1)).toHaveAccessibleName('Gap 1: empty')
    expect(word('vamos')).toBeInTheDocument()
  })

  it('swaps the word of an occupied gap, returning the old one to the bank', async () => {
    const { user } = play(immediate)
    await user.click(word('voy'))
    await user.click(gap(1))

    await user.click(word('vamos'))
    await user.click(gap(1))

    expect(gap(1)).toHaveAccessibleName('Gap 1: vamos')
    expect(word('voy')).toBeInTheDocument()
  })

  it('does nothing when an empty gap is tapped without a word picked', async () => {
    const { user } = play(immediate)

    await user.click(gap(2))

    expect(gap(2)).toHaveAccessibleName('Gap 2: empty')
  })

  it('shows every bank word, in an order set by the seed', () => {
    const first = play(immediate, 'seed-a')
    const words = () => within(bank()).getAllByRole('button').map((button) => button.textContent)
    const firstOrder = words()
    expect([...firstOrder].sort()).toEqual(['hermana', 'hermano', 'vamos', 'voy'])
    first.unmount()

    play(immediate, 'seed-a')
    expect(words()).toEqual(firstOrder)
  })

  it('cannot be confirmed again with the words already tried', async () => {
    const { user } = play(immediate)
    await user.click(word('voy'))
    await user.click(gap(1))
    await user.click(word('hermano'))
    await user.click(gap(2))
    await user.click(confirmIn(tomorrow()))
    await within(tomorrow()).findByText('Not quite. Try once more.')

    expect(confirmIn(tomorrow())).toBeDisabled()
  })

  it('marks wrong gaps on the retry and locks after the second try', async () => {
    const { user, api } = play(immediate)
    await user.click(word('voy'))
    await user.click(gap(1))
    await user.click(word('hermano'))
    await user.click(gap(2))
    await user.click(confirmIn(tomorrow()))

    expect(api.assess).toHaveBeenLastCalledWith(
      'tomorrow',
      { type: 'cloze', gaps: { w2: 'voy', w4: 'hermano' } },
      { reveal: false },
    )
    expect(await within(tomorrow()).findByText('Not quite. Try once more.')).toBeInTheDocument()
    expect(gap(1)).toHaveAttribute('data-state', 'incorrect')
    expect(gap(2)).toHaveAttribute('data-state', 'correct')

    await user.click(gap(1))
    await user.click(word('vamos'))
    await user.click(gap(1))
    await user.click(confirmIn(tomorrow()))

    expect(await within(tomorrow()).findByText('Correct')).toBeInTheDocument()
    expect(gap(1)).toBeDisabled()
    expect(within(bank()).getAllByRole('button').every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
  })
})

describe('second round of typed answers', () => {
  it('re-asks a failed short answer with the hint shown before the first try', async () => {
    const lesson: LessonPublic = {
      ...immediate,
      blocks: immediate.blocks.filter((block) => block.type !== 'cloze' && (block.type !== 'short_answer' || block.id === 'song')),
    }
    const { user, api } = play(lesson)
    const input = within(exercise(/song/)).getByRole('textbox')
    await user.type(input, 'x{Enter}')
    await within(exercise(/song/)).findByText('Not quite. Try once more.')
    await user.type(input, 'y{Enter}')

    await user.click(await screen.findByRole('button', { name: 'Start the second round' }))

    expect(api.secondRound).toHaveBeenCalledWith(['song'], '1')
    const round = await screen.findByRole('region', { name: 'Second round' })
    const repeat = within(round).getByRole('group', { name: /song/ })
    expect(within(repeat).getByRole('note', { name: 'Hint' })).toBeInTheDocument()
    expect(within(repeat).queryByRole('status')).not.toBeInTheDocument()
  })
})
