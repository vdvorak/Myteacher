import { createMemoryHistory } from '@solidjs/router'
import { render, screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { fakeAuthApi, invitedTeacher } from '../auth/testing'
import type { Course, Topic } from '../courses/api'
import { fakeCoursesApi, noAdditions, spanish, topicFixture, type ScriptedTopicStep } from '../courses/testing'
import { fakeJobsApi } from '../jobs/testing'
import { withI18n } from '../lesson/testing'
import { fakeConceptsApi, type ScriptedProposal } from './testing'

const teacher: Account = { ...invitedTeacher, language: 'en' }
const round: ScriptedTopicStep = {
  round: [
    {
      question: 'Do your students already know the present tense of ser and ir?',
      recommended_answer: 'Yes, from the previous topic.',
    },
  ],
}
const additions: ScriptedTopicStep = {
  additions: { prior_knowledge: 'The present tense of ser and ir.' },
  summary: 'The topic builds on the present tense.',
}
const offered: ScriptedProposal = {
  concepts: [{ name: 'estar', description: 'Estuve, estuviste, estuvo.' }],
  diagnostic_offer: 'Students met ser and ir before; a diagnostic shows who needs them again.',
}

function renderTopic(
  options: { course?: Course; topic?: Partial<Topic>; topicScript?: ScriptedTopicStep[]; proposals?: ScriptedProposal[] } = {},
) {
  const course = options.course ?? spanish
  const history = createMemoryHistory()
  history.set({ value: `/courses/${course.id}/topics/2` })
  const jobs = fakeJobsApi()
  const topic = topicFixture({ id: 2, name: 'Pretérito indefinido', position: 0, ...options.topic })
  const courses = fakeCoursesApi({
    courses: [course],
    topics: { [course.id]: [topic] },
    topicScript: options.topicScript,
    jobs,
  })
  const concepts = fakeConceptsApi({ proposals: options.proposals, jobs, courses })
  const apis = fakeApis({ auth: fakeAuthApi({ signedIn: teacher }), courses, concepts, jobs })
  render(withI18n(() => <App apis={apis} history={history} />, 'en'))
  return { courses }
}

const interviewPanel = async () => within(await screen.findByRole('region', { name: 'Topic interview' }))
const additionsSection = async () => within(await screen.findByRole('region', { name: 'What this topic adds to the brief' }))
const offerSection = async () => within(await screen.findByRole('region', { name: 'Diagnostic lesson' }))

describe('topic interview', () => {
  it('asks about the topic in rounds and stores the additions on the topic', async () => {
    const { courses } = renderTopic({ topicScript: [round, additions] })
    const user = userEvent.setup()

    await user.click((await interviewPanel()).getByRole('button', { name: 'Start the topic interview' }))
    expect(courses.startTopicInterview).toHaveBeenCalledWith(1, 2)
    const panel = await interviewPanel()
    await user.click(await panel.findByRole('button', { name: 'Use the recommendation' }))
    await user.click(panel.getByRole('button', { name: 'Send answers' }))

    expect(courses.answerTopicInterview).toHaveBeenCalledWith(1, 2, ['Yes, from the previous topic.'])
    expect(await panel.findByText('The topic builds on the present tense.')).toBeInTheDocument()
    await waitFor(async () =>
      expect((await additionsSection()).getByRole('textbox', { name: 'What students already know' })).toHaveValue(
        'The present tense of ser and ir.',
      ),
    )
  })

  it('proposes the concept map once the interview finishes', async () => {
    renderTopic({ topicScript: [round, additions], proposals: [offered] })
    const user = userEvent.setup()

    await user.click((await interviewPanel()).getByRole('button', { name: 'Start the topic interview' }))
    const panel = await interviewPanel()
    await user.click(await panel.findByRole('button', { name: 'Use the recommendation' }))
    await user.click(panel.getByRole('button', { name: 'Send answers' }))

    expect(await screen.findByDisplayValue('estar')).toBeInTheDocument()
    expect(await (await offerSection()).findByText(offered.diagnostic_offer!)).toBeInTheDocument()
  })

  it('can be ended early', async () => {
    const { courses } = renderTopic({ topicScript: [round] })
    const user = userEvent.setup()

    await user.click((await interviewPanel()).getByRole('button', { name: 'Start the topic interview' }))
    await (await interviewPanel()).findByRole('button', { name: 'Send answers' })
    await user.click((await interviewPanel()).getByRole('button', { name: 'End the interview' }))

    expect(courses.endTopicInterview).toHaveBeenCalledWith(1, 2)
    expect(await (await interviewPanel()).findByText(/ended early/)).toBeInTheDocument()
  })

  it('is not offered to a viewer', async () => {
    renderTopic({ course: { ...spanish, can_edit: false } })

    await screen.findByRole('heading', { level: 1, name: 'Pretérito indefinido' })
    expect(screen.queryByRole('region', { name: 'Topic interview' })).not.toBeInTheDocument()
  })
})

describe('what a topic adds to the brief', () => {
  it('is changed by hand, sending only what changed', async () => {
    const { courses } = renderTopic({ topic: { additions: { ...noAdditions, goals: 'Tell a story.' } } })
    const user = userEvent.setup()
    const section = await additionsSection()

    expect(section.getByRole('textbox', { name: 'Goals of the topic' })).toHaveValue('Tell a story.')
    await user.type(section.getByRole('textbox', { name: 'What to stress or leave out' }), 'Only ser, ir and hacer.')
    await user.click(section.getByRole('button', { name: 'Save additions' }))

    expect(courses.changeTopic).toHaveBeenCalledWith(1, 2, { additions: { emphasis: 'Only ser, ir and hacer.' } })
    expect(await section.findByRole('status')).toHaveTextContent('Saved.')
  })

  it('clears an addition emptied by the teacher', async () => {
    const { courses } = renderTopic({ topic: { additions: { ...noAdditions, notes: 'Songs.' } } })
    const user = userEvent.setup()
    const section = await additionsSection()

    await user.clear(section.getByRole('textbox', { name: 'Notes' }))
    await user.click(section.getByRole('button', { name: 'Save additions' }))

    expect(courses.changeTopic).toHaveBeenCalledWith(1, 2, { additions: { notes: null } })
  })

  it('is read by a viewer', async () => {
    renderTopic({
      course: { ...spanish, can_edit: false },
      topic: { additions: { ...noAdditions, goals: 'Tell a story.' } },
    })

    const section = await additionsSection()
    expect(await section.findByText('Tell a story.')).toBeInTheDocument()
    expect(section.queryByRole('textbox')).not.toBeInTheDocument()
  })
})

describe('diagnostic offer', () => {
  it('comes with a proposal and sets the flag only when accepted', async () => {
    const { courses } = renderTopic({ proposals: [offered] })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Propose concepts' }))
    const offer = await offerSection()
    expect(offer.getByText(offered.diagnostic_offer!)).toBeInTheDocument()
    await user.click(offer.getByRole('button', { name: 'Start with a diagnostic lesson' }))

    expect(courses.answerDiagnosticOffer).toHaveBeenCalledWith(1, 2, true)
    expect(await offer.findByRole('status')).toHaveTextContent('Accepted: the topic starts with a diagnostic lesson.')
    expect(offer.queryByRole('button')).not.toBeInTheDocument()
  })

  it('is declined, leaving the flag as it was', async () => {
    const { courses } = renderTopic({ topic: { diagnostic_offer: { reason: 'They met it before.', answer: null } } })
    const user = userEvent.setup()

    await user.click((await offerSection()).getByRole('button', { name: 'Decline' }))

    expect(courses.answerDiagnosticOffer).toHaveBeenCalledWith(1, 2, false)
    expect(await (await offerSection()).findByRole('status')).toHaveTextContent('Declined.')
    expect((await courses.topics(1))[0].diagnostic_wanted).toBe(false)
  })

  it('is shown to a viewer without the answers', async () => {
    renderTopic({
      course: { ...spanish, can_edit: false },
      topic: { diagnostic_offer: { reason: 'They met it before.', answer: null } },
    })

    const offer = await offerSection()
    expect(offer.getByText('They met it before.')).toBeInTheDocument()
    expect(offer.queryByRole('button')).not.toBeInTheDocument()
  })
})
