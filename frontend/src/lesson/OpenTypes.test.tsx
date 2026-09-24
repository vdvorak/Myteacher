import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import reading from '../../../schema/fixtures/es-lectura.public.json'
import type { LessonPublic } from '../generated/lesson'
import { LessonPlayer } from './LessonPlayer'
import { fakeApi, withI18n } from './testing'

const immediate = reading as LessonPublic
const atTheEnd: LessonPublic = { ...immediate, feedback_mode: 'at_the_end' }

beforeEach(() => localStorage.clear())

function play(lesson: LessonPublic = immediate) {
  const api = fakeApi(lesson)
  const view = render(withI18n(() => <LessonPlayer lesson={lesson} seed="1" api={api} />))
  return { ...view, api, user: userEvent.setup() }
}

type User = ReturnType<typeof userEvent.setup>
const exercise = (prompt: RegExp) => screen.getByRole('group', { name: prompt })
const freeText = () => exercise(/own neighbourhood/)
const translation = () => exercise(/Translate into Czech/)
const confirmIn = (group: HTMLElement) => within(group).getByRole('button', { name: 'Confirm' })
const essay = 'Vivo en Brno, en el barrio de Žabovřesky. Mi casa está cerca de un parque grande.'

async function answerClosed(user: User, wrongFirst = false) {
  const where = exercise(/Dónde vive/)
  if (wrongFirst) {
    await user.click(within(where).getByRole('radio', { name: 'En Madrid' }))
    await user.click(confirmIn(where))
    await within(where).findByRole('status')
    await user.click(within(where).getByRole('radio', { name: /barco/ }))
  } else {
    await user.click(within(where).getByRole('radio', { name: 'En Triana, en Sevilla' }))
  }
  await user.click(confirmIn(where))
  const baker = exercise(/panadero/)
  await user.type(within(baker).getByRole('textbox'), 'Tomás')
  await user.click(confirmIn(baker))
}

describe('the reading passage', () => {
  it('is rendered above the exercises about it', () => {
    play()

    const passage = screen.getByRole('region', { name: 'Mi barrio' })
    expect(passage).toHaveTextContent('Me llamo Lucía')
    const firstExercise = exercise(/Dónde vive/)
    expect(passage.compareDocumentPosition(firstExercise) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('is reachable from every exercise that references it', () => {
    play()

    for (const group of [exercise(/Dónde vive/), exercise(/panadero/), freeText(), translation()]) {
      expect(within(group).getByRole('link', { name: 'About the text: Mi barrio' })).toHaveAttribute(
        'href',
        '#passage-barrio',
      )
    }
    expect(document.getElementById('passage-barrio')).toBe(screen.getByRole('region', { name: 'Mi barrio' }))
  })
})

describe('free text and translation', () => {
  it('are text areas with a length counter', async () => {
    const { user } = play()
    const area = within(freeText()).getByRole('textbox', { name: 'Your answer' })
    expect(area.tagName).toBe('TEXTAREA')
    expect(area).toHaveAttribute('maxlength', '600')
    expect(area).toHaveAccessibleDescription('0 / 600 characters · at least 60')

    await user.type(area, 'Vivo en Brno.')

    expect(area).toHaveAccessibleDescription('13 / 600 characters · at least 60')
  })

  it('shows the source text and the direction of a translation', () => {
    play()

    expect(within(translation()).getByText('From Spanish into Czech')).toBeInTheDocument()
    const source = within(translation()).getByText(/Los domingos/)
    expect(source).toHaveAttribute('lang', 'es')
  })

  it('shows its hint up front, since there is no retry', () => {
    const lesson: LessonPublic = {
      ...immediate,
      blocks: immediate.blocks.map((block) =>
        block.type === 'free_text' ? { ...block, hint: 'Start with *Vivo en*.' } : block,
      ),
    }
    play(lesson)

    expect(within(freeText()).getByRole('note', { name: 'Hint' })).toHaveTextContent('Start with Vivo en.')
  })

  it('cannot be sent below the minimum length', async () => {
    const { user } = play()

    await user.type(within(freeText()).getByRole('textbox'), 'Vivo en Brno.')

    expect(confirmIn(freeText())).toBeDisabled()
  })

  it('is sent once and then awaits assessment, with no score, retry or solution', async () => {
    const { user, api } = play()
    const area = within(freeText()).getByRole('textbox')
    await user.type(area, essay)

    await user.click(confirmIn(freeText()))

    expect(api.assess).toHaveBeenCalledWith('your-neighbourhood', { type: 'free_text', text: essay }, { reveal: false })
    expect(await within(freeText()).findByText('Awaiting assessment')).toBeInTheDocument()
    expect(area).toBeDisabled()
    expect(within(freeText()).queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
    expect(within(freeText()).queryByRole('region', { name: 'Solution' })).not.toBeInTheDocument()
    expect(within(freeText()).queryByText(/Correct|Not quite/)).not.toBeInTheDocument()
  })

  it('awaits assessment after submission in at-the-end mode', async () => {
    const { user } = play(atTheEnd)
    await user.click(within(exercise(/Dónde vive/)).getByRole('radio', { name: 'En Triana, en Sevilla' }))
    await user.type(within(exercise(/panadero/)).getByRole('textbox'), 'Tomás')
    await user.type(within(translation()).getByRole('textbox'), 'V neděli jíme u babičky.')

    await user.click(screen.getByRole('button', { name: 'Submit answers' }))

    expect(await within(translation()).findByText('Awaiting assessment')).toBeInTheDocument()
    expect(within(exercise(/Dónde vive/)).getByText('Correct')).toBeInTheDocument()
  })

  it('may be left empty at the end, and is then not sent at all', async () => {
    const { user, api } = play(atTheEnd)
    await user.click(within(exercise(/Dónde vive/)).getByRole('radio', { name: 'En Triana, en Sevilla' }))
    await user.type(within(exercise(/panadero/)).getByRole('textbox'), 'Tomás')

    expect(screen.queryByText(/unanswered/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Submit answers' }))

    expect(await screen.findByText('Lesson finished')).toBeInTheDocument()
    expect(api.assess.mock.calls.map(([id]) => id).sort()).toEqual(['baker', 'where-lives'])
  })

  it('blocks submission at the end while a started answer is too short', async () => {
    const { user } = play(atTheEnd)
    await user.click(within(exercise(/Dónde vive/)).getByRole('radio', { name: 'En Triana, en Sevilla' }))
    await user.type(within(exercise(/panadero/)).getByRole('textbox'), 'Tomás')

    await user.type(within(freeText()).getByRole('textbox'), 'Vivo en Brno.')

    expect(screen.getByText('1 unanswered')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit answers' })).toBeDisabled()
  })
})

describe('open exercises and the second round', () => {
  it('never repeat open exercises, even unanswered, and finish once only open ones remain', async () => {
    const { user, api } = play(atTheEnd)
    await user.click(within(exercise(/Dónde vive/)).getByRole('radio', { name: 'En Madrid' }))
    await user.type(within(exercise(/panadero/)).getByRole('textbox'), 'Tomás')

    await user.click(screen.getByRole('button', { name: 'Submit answers' }))
    await user.click(await screen.findByRole('button', { name: 'Start the second round' }))

    expect(api.secondRound).toHaveBeenCalledWith(['where-lives'], '1')
    const round = await screen.findByRole('region', { name: 'Second round' })
    expect(within(round).getAllByRole('group').map((group) => group.getAttribute('aria-labelledby'))).toHaveLength(1)
  })

  it('counts written answers awaiting the teacher in the summary, not in the score', async () => {
    const { user } = play()
    await answerClosed(user)
    await user.type(within(freeText()).getByRole('textbox'), essay)
    await user.click(confirmIn(freeText()))
    await user.type(within(translation()).getByRole('textbox'), 'V neděli jíme u babičky.')
    await user.click(confirmIn(translation()))

    expect(await screen.findByText('Lesson finished')).toBeInTheDocument()
    expect(screen.getByText('2 of 2 right in the first pass.')).toBeInTheDocument()
    expect(screen.getByText('2 written answers await your teacher.')).toBeInTheDocument()
  })

  it('keeps an unsent written answer across a reload', async () => {
    const first = play()
    await first.user.type(within(freeText()).getByRole('textbox'), 'Vivo en')
    first.unmount()

    play()

    expect(within(freeText()).getByRole('textbox')).toHaveValue('Vivo en')
  })
})
