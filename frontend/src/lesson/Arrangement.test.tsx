import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import wordOrder from '../../../schema/fixtures/en-word-order.public.json'
import laCasa from '../../../schema/fixtures/es-la-casa.public.json'
import type { LessonPublic } from '../generated/lesson'
import { LessonPlayer } from './LessonPlayer'
import { fakeApi, withI18n } from './testing'

const immediate = laCasa as LessonPublic
const atTheEnd = wordOrder as LessonPublic

beforeEach(() => localStorage.clear())

function play(lesson: LessonPublic, seed = '1') {
  const api = fakeApi(lesson)
  const view = render(withI18n(() => <LessonPlayer lesson={lesson} seed={seed} api={api} />))
  return { ...view, api, user: userEvent.setup() }
}

type User = ReturnType<typeof userEvent.setup>
const exercise = (prompt: RegExp) => screen.getByRole('group', { name: prompt })
const confirmIn = (group: HTMLElement) => within(group).getByRole('button', { name: 'Confirm' })

describe('matching', () => {
  const rooms = () => exercise(/Match each room/)
  const lefts = () => within(rooms()).getByRole('group', { name: 'Match these' })
  const rights = () => within(rooms()).getByRole('group', { name: 'With these' })
  const left = (text: string) => within(lefts()).getByRole('button', { name: new RegExp(`^${text} →`) })
  const right = (text: string) => within(rights()).getByRole('button', { name: new RegExp(`^${text} →`) })
  const rightOrder = () => within(rights()).getAllByRole('button').map((button) => button.textContent)

  async function pair(user: User, from: string, to: string) {
    await user.click(left(from))
    await user.click(right(to))
  }

  it('pairs a tapped left item with the tapped right item', async () => {
    const { user } = play(immediate)

    await user.click(left('la cocina'))
    expect(left('la cocina')).toHaveAttribute('aria-pressed', 'true')
    await user.click(right('the kitchen'))

    expect(left('la cocina')).toHaveAccessibleName('la cocina → the kitchen')
    expect(right('the kitchen')).toHaveAccessibleName('the kitchen → la cocina')
  })

  it('undoes a pair when either of its items is tapped', async () => {
    const { user } = play(immediate)
    await pair(user, 'la cocina', 'the kitchen')
    await user.click(left('la cocina'))
    expect(left('la cocina')).toHaveAccessibleName('la cocina → not paired')

    await pair(user, 'el baño', 'the bathroom')
    await user.click(right('the bathroom'))
    expect(left('el baño')).toHaveAccessibleName('el baño → not paired')
  })

  it('moves a right item that is already paired to the newly tapped left item', async () => {
    const { user } = play(immediate)
    await pair(user, 'la cocina', 'the kitchen')

    await pair(user, 'el baño', 'the kitchen')

    expect(left('el baño')).toHaveAccessibleName('el baño → the kitchen')
    expect(left('la cocina')).toHaveAccessibleName('la cocina → not paired')
  })

  it('shuffles the right column by the seed', () => {
    const first = play(immediate, 'seed-a')
    const order = rightOrder()
    first.unmount()
    const again = play(immediate, 'seed-a')
    expect(rightOrder()).toEqual(order)
    again.unmount()
    play(immediate, 'seed-b')
    expect(rightOrder()).not.toEqual(order)
  })

  it('can be confirmed once every item is paired, and sends the pairs', async () => {
    const { user, api } = play(immediate)
    await pair(user, 'la cocina', 'the kitchen')
    await pair(user, 'el baño', 'the bathroom')
    await pair(user, 'el dormitorio', 'the bedroom')
    expect(confirmIn(rooms())).toBeDisabled()
    await pair(user, 'el salón', 'the living room')

    await user.click(confirmIn(rooms()))

    expect(api.assess).toHaveBeenCalledWith(
      'rooms',
      { type: 'matching', pairs: { p1: 'r3', p2: 'r1', p3: 'r2', p4: 'r4' } },
      { reveal: false },
    )
    expect(await within(rooms()).findByText('Correct')).toBeInTheDocument()
    expect(left('la cocina')).toBeDisabled()
  })

  it('marks wrong pairs on the retry, shows the hint, then locks with the solution', async () => {
    const { user } = play(immediate)
    await pair(user, 'la cocina', 'the bathroom')
    await pair(user, 'el baño', 'the kitchen')
    await pair(user, 'el dormitorio', 'the bedroom')
    await pair(user, 'el salón', 'the living room')
    await user.click(confirmIn(rooms()))

    expect(await within(rooms()).findByText('Not quite. Try once more.')).toBeInTheDocument()
    expect(within(rooms()).getByRole('note', { name: 'Hint' })).toBeInTheDocument()
    expect(left('la cocina')).toHaveAttribute('data-state', 'incorrect')
    expect(left('el salón')).toHaveAttribute('data-state', 'correct')
    expect(confirmIn(rooms())).toBeDisabled()

    await user.click(left('la cocina'))
    await user.click(left('el baño'))
    await pair(user, 'la cocina', 'the kitchen')
    await pair(user, 'el baño', 'the bathroom')
    await user.click(confirmIn(rooms()))

    expect(await within(rooms()).findByText('Correct')).toBeInTheDocument()
    expect(within(rooms()).getByRole('region', { name: 'Solution' })).toHaveTextContent('la cocina → the kitchen')
  })

  it('is operable by keyboard', async () => {
    const { user } = play(immediate)
    left('la cocina').focus()

    await user.keyboard('{Enter}')
    right('the kitchen').focus()
    await user.keyboard(' ')

    expect(left('la cocina')).toHaveAccessibleName('la cocina → the kitchen')
  })
})

describe('token ordering', () => {
  const ordering = () => exercise(/Put the words in order\.$/)
  const sentence = () => within(ordering()).getByRole('group', { name: 'Your order' })
  const pool = () => within(ordering()).getByRole('group', { name: 'Words to place' })
  const token = (text: string) => within(pool()).getByRole('button', { name: text })
  const placed = () => within(sentence()).queryAllByRole('button').map((button) => button.textContent)
  const poolOrder = () =>
    within(pool())
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter((text) => text !== 'Undo')

  async function tapInOrder(user: User, texts: string[]) {
    for (const text of texts) await user.click(token(text))
  }

  it('builds the order from the tokens tapped in sequence', async () => {
    const { user } = play(atTheEnd)

    await tapInOrder(user, ['I', 'visited', 'my'])

    expect(placed()).toEqual(['I', 'visited', 'my'])
    expect(poolOrder().sort()).toEqual(['grandmother', 'yesterday'])
  })

  it('takes back the last token with Undo, and any token by tapping it', async () => {
    const { user } = play(atTheEnd)
    await tapInOrder(user, ['I', 'visited', 'my'])

    await user.click(within(pool()).getByRole('button', { name: 'Undo' }))
    expect(placed()).toEqual(['I', 'visited'])

    await user.click(within(sentence()).getByRole('button', { name: 'I' }))
    expect(placed()).toEqual(['visited'])
  })

  it('shuffles the tokens by the seed', () => {
    const first = play(atTheEnd, 'seed-a')
    const order = poolOrder()
    first.unmount()
    const again = play(atTheEnd, 'seed-a')
    expect(poolOrder()).toEqual(order)
    again.unmount()
    play(atTheEnd, 'seed-b')
    expect(poolOrder()).not.toEqual(order)
  })

  it('counts as answered only when every token is placed, and submits the order', async () => {
    const { user, api } = play(atTheEnd)
    await tapInOrder(user, ['yesterday', 'I', 'visited', 'my'])
    expect(screen.getByText('2 unanswered')).toBeInTheDocument()
    await tapInOrder(user, ['grandmother'])
    const opposites = exercise(/opposite/)
    for (const [from, to] of [
      ['early', 'late'],
      ['cheap', 'expensive'],
      ['empty', 'full'],
    ]) {
      await user.click(within(opposites).getByRole('button', { name: new RegExp(`^${from} →`) }))
      await user.click(within(opposites).getByRole('button', { name: new RegExp(`^${to} →`) }))
    }

    await user.click(screen.getByRole('button', { name: 'Submit answers' }))

    expect(api.assess).toHaveBeenCalledWith(
      'yesterday',
      { type: 'token_ordering', order: ['t5', 't2', 't4', 't3', 't1'] },
      { reveal: true },
    )
    expect(await within(ordering()).findByText('Correct')).toBeInTheDocument()
    expect(within(exercise(/opposite/)).getByText('Correct')).toBeInTheDocument()
  })

  it('marks misplaced tokens and shows the accepted order after submission', async () => {
    const { user } = play(atTheEnd)
    await tapInOrder(user, ['I', 'visited', 'grandmother', 'my', 'yesterday'])
    const opposites = exercise(/opposite/)
    for (const [from, to] of [
      ['early', 'late'],
      ['cheap', 'expensive'],
      ['empty', 'full'],
    ]) {
      await user.click(within(opposites).getByRole('button', { name: new RegExp(`^${from} →`) }))
      await user.click(within(opposites).getByRole('button', { name: new RegExp(`^${to} →`) }))
    }

    await user.click(screen.getByRole('button', { name: 'Submit answers' }))

    expect(await within(ordering()).findByText('Not quite')).toBeInTheDocument()
    const states = within(sentence())
      .getAllByRole('button')
      .map((button) => button.getAttribute('data-state'))
    expect(states).toEqual(['correct', 'correct', 'incorrect', 'incorrect', 'correct'])
    expect(within(ordering()).getByRole('region', { name: 'Solution' })).toHaveTextContent(
      'I visited my grandmother yesterday',
    )
  })

  it('keeps a partial order across a reload', async () => {
    const first = play(atTheEnd)
    await tapInOrder(first.user, ['I', 'visited'])
    first.unmount()

    play(atTheEnd)

    expect(placed()).toEqual(['I', 'visited'])
  })
})

describe('second round of arrangements', () => {
  it('repeats a failed ordering with the tokens re-shuffled', async () => {
    const lesson: LessonPublic = {
      ...immediate,
      blocks: immediate.blocks.filter((block) => block.type !== 'matching'),
    }
    const { user } = play(lesson, 'seed-a')
    const group = exercise(/ask where the bathroom/)
    const firstPool = within(group)
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter((text) => !['Undo', 'Confirm'].includes(text ?? ''))
    for (const attempt of [
      ['el', '¿Dónde', 'está', 'baño?'],
      ['está', '¿Dónde', 'el', 'baño?'],
    ]) {
      for (const text of attempt) {
        await user.click(within(within(group).getByRole('group', { name: 'Words to place' })).getByRole('button', { name: text }))
      }
      await user.click(within(group).getByRole('button', { name: 'Confirm' }))
      await within(group).findByRole('status')
      if (attempt[0] === 'el') {
        for (let i = 0; i < 4; i++) await user.click(within(group).getByRole('button', { name: 'Undo' }))
      }
    }

    await user.click(await screen.findByRole('button', { name: 'Start the second round' }))

    const round = await screen.findByRole('region', { name: 'Second round' })
    const repeatPool = within(within(round).getByRole('group', { name: 'Words to place' }))
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter((text) => text !== 'Undo')
    expect(repeatPool).not.toEqual(firstPool)
    expect([...repeatPool].sort()).toEqual([...firstPool].sort())
  })
})

describe('retrying an ordering', () => {
  const lesson: LessonPublic = {
    ...immediate,
    blocks: immediate.blocks.filter((block) => block.type !== 'matching'),
  }
  const group = () => exercise(/ask where the bathroom/)
  const poolButton = (text: string) =>
    within(within(group()).getByRole('group', { name: 'Words to place' })).getByRole('button', { name: text })
  const sentenceButtons = () => within(within(group()).getByRole('group', { name: 'Your order' })).queryAllByRole('button')

  async function tryOrder(user: User, texts: string[]) {
    for (const text of texts) await user.click(poolButton(text))
    await user.click(within(group()).getByRole('button', { name: 'Confirm' }))
    await within(group()).findByRole('status')
  }

  it('drops the marks once the tried order is changed', async () => {
    const { user } = play(lesson)
    await tryOrder(user, ['el', '¿Dónde', 'está', 'baño?'])
    expect(sentenceButtons().map((b) => b.getAttribute('data-state'))).toEqual([
      'incorrect',
      'incorrect',
      'incorrect',
      'correct',
    ])

    await user.click(sentenceButtons()[0])

    expect(sentenceButtons().map((b) => b.getAttribute('data-state'))).toEqual([null, null, null])
  })

  it('treats tokens with the same text as the same answer when retrying', async () => {
    const twice: LessonPublic = {
      ...lesson,
      blocks: [
        {
          type: 'token_ordering',
          id: 'where-bathroom',
          prompt: 'Put the words in order to ask where the bathroom is.',
          tokens: [
            { id: 't1', text: 'la' },
            { id: 't2', text: 'la' },
            { id: 't3', text: 'y' },
          ],
          hint: null,
        },
      ],
    }
    const { user } = play(twice)
    const pool = () => within(within(group()).getByRole('group', { name: 'Words to place' }))
    for (const name of ['y', 'la', 'la']) await user.click(pool().getAllByRole('button', { name })[0])
    await user.click(within(group()).getByRole('button', { name: 'Confirm' }))
    await within(group()).findByRole('status')

    await user.click(sentenceButtons()[1])
    await user.click(sentenceButtons()[1])
    for (const name of ['la', 'la']) await user.click(pool().getAllByRole('button', { name })[0])

    expect(within(group()).getByRole('button', { name: 'Confirm' })).toBeDisabled()
  })
})

