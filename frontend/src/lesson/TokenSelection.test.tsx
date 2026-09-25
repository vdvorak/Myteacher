import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import accents from '../../../schema/fixtures/es-acentos.public.json'
import type { LessonPublic } from '../generated/lesson'
import { LessonPlayer } from './LessonPlayer'
import { fakeApi, withI18n } from './testing'

const immediate = accents as LessonPublic
const atTheEnd: LessonPublic = { ...immediate, feedback_mode: 'at_the_end' }

beforeEach(() => localStorage.clear())

function play(lesson: LessonPublic = immediate) {
  const api = fakeApi(lesson)
  const view = render(withI18n(() => <LessonPlayer lesson={lesson} seed="1" api={api} />))
  return { ...view, api, user: userEvent.setup() }
}

const exercise = (prompt: RegExp) => screen.getByRole('group', { name: prompt })
const stress = () => exercise(/stressed syllable/)
const verbs = () => exercise(/every verb/)
const letter = () => exercise(/English does not have/)
const tokens = (group: HTMLElement) => within(within(group).getByRole('group', { name: 'Tap to select' })).getAllByRole('button')
const token = (group: HTMLElement, text: string) => tokens(group).find((button) => button.textContent === text)!
const confirmIn = (group: HTMLElement) => within(group).getByRole('button', { name: 'Confirm' })

describe('splitting the text', () => {
  it('offers syllables, words or letters as tap targets', () => {
    play()

    expect(tokens(stress()).map((b) => b.textContent)).toEqual(['can', 'ción'])
    expect(tokens(verbs()).map((b) => b.textContent)).toEqual(['Yo', 'como', 'pan', 'y', 'bebo', 'agua.'])
    expect(tokens(letter()).map((b) => b.textContent)).toEqual(['E', 's', 'p', 'a', 'ñ', 'a'])
  })

  it('makes every token a finger-sized target', () => {
    play()

    for (const button of tokens(letter())) expect(button).toHaveClass('selection-token')
  })
})

describe('selecting', () => {
  it('toggles tokens and sends the selection in the answer shape', async () => {
    const { user, api } = play()

    await user.click(token(stress(), 'ción'))
    expect(token(stress(), 'ción')).toHaveAttribute('aria-pressed', 'true')
    await user.click(confirmIn(stress()))

    expect(api.assess).toHaveBeenCalledWith(
      'stress',
      { type: 'token_selection', item_id: 'cancion', selected: [1] },
      { reveal: false, round: 'first' },
    )
    expect(await within(stress()).findByText('Correct')).toBeInTheDocument()
    expect(tokens(stress()).every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
  })

  it('moves the selection when the limit is one', async () => {
    const { user } = play()

    await user.click(token(stress(), 'can'))
    await user.click(token(stress(), 'ción'))

    expect(token(stress(), 'can')).toHaveAttribute('aria-pressed', 'false')
    expect(token(stress(), 'ción')).toHaveAttribute('aria-pressed', 'true')
  })

  it('stops at a limit above one until a token is released', async () => {
    const limited: LessonPublic = {
      ...immediate,
      blocks: immediate.blocks.map((block) =>
        block.type === 'token_selection' && block.id === 'verbs' ? { ...block, max_selections: 2 } : block,
      ),
    }
    const { user } = play(limited)
    expect(within(verbs()).getByText('Select up to 2.')).toBeInTheDocument()

    await user.click(token(verbs(), 'como'))
    await user.click(token(verbs(), 'bebo'))

    expect(token(verbs(), 'pan')).toBeDisabled()
    await user.click(token(verbs(), 'como'))
    expect(token(verbs(), 'pan')).toBeEnabled()
  })

  it('is operable by keyboard', async () => {
    const { user } = play()
    token(verbs(), 'como').focus()

    await user.keyboard('{Enter}')
    await user.tab()
    await user.tab()
    await user.tab()
    await user.keyboard(' ')

    expect(token(verbs(), 'como')).toHaveAttribute('aria-pressed', 'true')
    expect(token(verbs(), 'bebo')).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('feedback', () => {
  it('marks the selected tokens on the retry, shows the hint, and locks with the solution', async () => {
    const { user } = play()
    await user.click(token(stress(), 'can'))
    await user.click(confirmIn(stress()))

    expect(await within(stress()).findByText('Not quite. Try once more.')).toBeInTheDocument()
    expect(token(stress(), 'can')).toHaveAttribute('data-state', 'incorrect')
    expect(token(stress(), 'ción')).not.toHaveAttribute('data-state')
    expect(within(stress()).getByRole('note', { name: 'Hint' })).toBeInTheDocument()
    expect(confirmIn(stress())).toBeDisabled()

    await user.click(token(stress(), 'ción'))
    expect(token(stress(), 'ción')).not.toHaveAttribute('data-state')
    await user.click(confirmIn(stress()))

    expect(await within(stress()).findByText('Correct')).toBeInTheDocument()
    const solution = within(stress()).getByRole('region', { name: 'Solution' })
    expect(within(solution).getByText('ción').tagName).toBe('STRONG')
  })

  it('keeps the spaces of a word solution, which is plain text rather than a row of tokens', async () => {
    const { user } = play(atTheEnd)
    await user.click(token(stress(), 'ción'))
    await user.click(token(verbs(), 'como'))
    await user.click(token(letter(), 'ñ'))
    await user.click(screen.getByRole('button', { name: 'Submit answers' }))

    const solution = await within(verbs()).findByRole('region', { name: 'Solution' })
    const text = solution.querySelector('p')!
    expect(text).toHaveTextContent('Yo como pan y bebo agua.', { normalizeWhitespace: false })
    expect(text).not.toHaveClass('selection-text')
  })

  it('shows nothing before submission and every result after it in at-the-end mode', async () => {
    const { user, api } = play(atTheEnd)
    await user.click(token(stress(), 'ción'))
    await user.click(token(verbs(), 'como'))
    await user.click(token(letter(), 'ñ'))
    expect(api.assess).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Submit answers' }))

    expect(await within(stress()).findByText('Correct')).toBeInTheDocument()
    expect(within(verbs()).getByText('Not quite')).toBeInTheDocument()
    expect(within(letter()).getByText('Correct')).toBeInTheDocument()
  })

  it('keeps a selection across a reload', async () => {
    const first = play(atTheEnd)
    await first.user.click(token(verbs(), 'bebo'))
    first.unmount()

    play(atTheEnd)

    expect(token(verbs(), 'bebo')).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('second round', () => {
  it('asks the same skill on another item', async () => {
    // Without a limit, so that the retry can be wrong too.
    const lesson: LessonPublic = {
      ...immediate,
      blocks: immediate.blocks
        .filter((block) => block.type !== 'token_selection' || block.id === 'stress')
        .map((block) => (block.type === 'token_selection' ? { ...block, max_selections: null } : block)),
    }
    const exerciseBlock = lesson.blocks.find((block) => block.type === 'token_selection')!
    const api = fakeApi(lesson)
    api.secondRound.mockImplementation(async () => ({
      exercises: [
        {
          ...exerciseBlock,
          item_id: 'arbol',
          tokens: [
            { text: 'ár', space_after: false },
            { text: 'bol', space_after: false },
          ],
        } as never,
      ],
    }))
    render(withI18n(() => <LessonPlayer lesson={lesson} seed="1" api={api} />))
    const user = userEvent.setup()
    await user.click(token(stress(), 'can'))
    await user.click(confirmIn(stress()))
    await within(stress()).findByText('Not quite. Try once more.')
    await user.click(token(stress(), 'ción'))
    await user.click(confirmIn(stress()))
    await within(stress()).findByText('Not quite')
    await user.click(await screen.findByRole('button', { name: 'Start the second round' }))

    const round = await screen.findByRole('region', { name: 'Second round' })
    const repeat = within(round).getByRole('group', { name: /stressed syllable/ })
    expect(tokens(repeat).map((b) => b.textContent)).toEqual(['ár', 'bol'])
    await user.click(token(repeat, 'ár'))
    await user.click(confirmIn(repeat))

    expect(api.assess).toHaveBeenLastCalledWith(
      'stress',
      { type: 'token_selection', item_id: 'arbol', selected: [0] },
      { reveal: false, round: 'second' },
    )
    expect(await screen.findByText('Lesson finished')).toBeInTheDocument()
  })
})
