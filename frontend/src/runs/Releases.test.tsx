import { createMemoryHistory } from '@solidjs/router'
import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { fakeApis } from '../api/testing'
import type { Account } from '../auth/api'
import { fakeAuthApi, invitedTeacher } from '../auth/testing'
import { fakeClassesApi } from '../classes/testing'
import { withI18n } from '../lesson/testing'
import { fakeStudentsApi, jana, petr } from '../students/testing'
import { defaultSettings, ReleaseRefused, type ReleasableMaterial, type Release } from './api'
import { fakeRunsApi } from './testing'

const teacher: Account = { ...invitedTeacher, language: 'en' }
const classes = [{ id: 1, name: '2.B 2026/27', memberIds: [jana.id, petr.id] }]
const preterite: ReleasableMaterial = {
  id: 4,
  topic: 'Pretérito indefinido',
  title: 'Pretérito in class',
  versions: [2, 1],
  target_student_ids: [petr.id],
}
const earlier: Release = {
  id: 1,
  material_id: 4,
  title: 'Pretérito in class',
  topic: 'Pretérito indefinido',
  topic_id: 2,
  version: 1,
  audience: 'chosen',
  students: [{ id: petr.id, name: petr.name }],
  released_by_id: 2,
  released_at: '2026-09-24T08:00:00Z',
  retracted_at: null,
  retraction_reason: null,
  ...defaultSettings,
  feedback_mode: 'at_the_end',
  due_at: '2026-10-01T18:00:00Z',
  late_submissions: 'refuse',
  attempts: 'repeated',
  show_solutions: false,
}

function renderRun(
  options: { materials?: ReleasableMaterial[]; releases?: Release[]; studentIds?: number[]; tab?: string } = {},
) {
  const history = createMemoryHistory()
  history.set({ value: `/runs/7${options.tab ? `?tab=${options.tab}` : ''}` })
  const runs = fakeRunsApi({
    runs: [{ id: 7, courseId: 1, name: '2.B 2026/27', classIds: [1], studentIds: options.studentIds ?? [] }],
    classes,
    students: [jana, petr],
    materials: options.materials ?? [preterite],
    releases: { 7: options.releases ?? [] },
  })
  const apis = fakeApis({
    auth: fakeAuthApi({ signedIn: teacher }),
    classes: fakeClassesApi({ classes, students: [jana, petr] }),
    students: fakeStudentsApi({ students: [jana, petr] }),
    runs,
  })
  render(withI18n(() => <App apis={apis} history={history} />, 'en'))
  return { runs }
}

const releaseTable = async () => within(await screen.findByRole('table', { name: 'Releases' }))
const dialog = () => within(screen.getByRole('dialog', { name: 'Release in a run' }))
const dialogNamed = (name: string) => within(screen.getByRole('dialog', { name }))

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Release material' }))
  return dialog()
}

describe('releases of a run', () => {
  it('lists the releases with how many submitted and how many answers wait', async () => {
    renderRun({ releases: [earlier], tab: 'releases' })

    const row = within((await releaseTable()).getByText('Pretérito in class').closest('tr')!)
    expect(row.getByRole('link', { name: 'Pretérito in class' })).toHaveAttribute('href', '/runs/7/releases/1')
    expect(row.getByText('Pretérito indefinido')).toBeInTheDocument()
    expect(row.getByText('0 of 1')).toBeInTheDocument()
  })

  it('releases the latest version to the whole run after a summary', async () => {
    const { runs } = renderRun({ tab: 'releases' })
    const user = userEvent.setup()

    const form = await openDialog(user)
    await user.selectOptions(await form.findByLabelText('Material'), String(preterite.id))
    expect(form.getByLabelText('Version')).toHaveValue('2')
    expect(form.getByLabelText('Whole run, including students who join later')).toBeChecked()
    await user.click(form.getByRole('button', { name: 'Continue to the summary' }))

    const summary = within(dialog().getByRole('region', { name: 'Summary' }))
    expect(summary.getByText('Students who will see the material right away: 2')).toBeInTheDocument()
    expect(summary.getByText('Pretérito in class, version 2')).toBeInTheDocument()
    expect(summary.getByText('Accepted, marked late')).toBeInTheDocument()
    expect(runs.release).not.toHaveBeenCalled()
    await user.click(summary.getByRole('button', { name: 'Release' }))

    expect(runs.release).toHaveBeenCalledWith(7, {
      material_id: 4,
      version: 2,
      audience: 'run',
      student_ids: null,
      ...defaultSettings,
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect((await releaseTable()).getByText('Pretérito in class')).toBeInTheDocument()
  })

  it('goes back from the summary with the choices kept', async () => {
    renderRun()
    const user = userEvent.setup()

    const form = await openDialog(user)
    await user.selectOptions(await form.findByLabelText('Material'), String(preterite.id))
    await user.selectOptions(form.getByLabelText('Attempts'), 'repeated')
    await user.click(form.getByRole('button', { name: 'Continue to the summary' }))
    await user.click(dialog().getByRole('button', { name: 'Back' }))

    expect(dialog().getByLabelText('Attempts')).toHaveValue('repeated')
  })

  it('releases to chosen students, the material’s targets preselected', async () => {
    const { runs } = renderRun()
    const user = userEvent.setup()

    const form = await openDialog(user)
    await user.selectOptions(await form.findByLabelText('Material'), String(preterite.id))
    await user.click(form.getByLabelText('Chosen students'))
    const chosen = within(form.getByRole('group', { name: 'Chosen students' }))
    expect(chosen.getByLabelText('Petr Malý')).toBeChecked()
    expect(chosen.getByLabelText('Jana Veselá')).not.toBeChecked()
    await user.click(chosen.getByLabelText('Jana Veselá'))
    await user.click(form.getByRole('button', { name: 'Continue to the summary' }))
    expect(dialog().getByText('Students who will see the material right away: 2')).toBeInTheDocument()
    expect(dialog().getByText('Jana Veselá, Petr Malý')).toBeInTheDocument()
    await user.click(dialog().getByRole('button', { name: 'Release' }))

    expect(runs.release).toHaveBeenCalledWith(7, expect.objectContaining({ audience: 'chosen', student_ids: [jana.id, petr.id] }))
  })

  it('cannot go on to chosen students with none chosen', async () => {
    renderRun()
    const user = userEvent.setup()

    const form = await openDialog(user)
    await user.selectOptions(await form.findByLabelText('Material'), String(preterite.id))
    await user.click(form.getByLabelText('Chosen students'))
    await user.click(within(form.getByRole('group', { name: 'Chosen students' })).getByLabelText('Petr Malý'))

    expect(form.getByRole('button', { name: 'Continue to the summary' })).toBeDisabled()
  })

  it('sends every setting the teacher chose, and an earlier version', async () => {
    const { runs } = renderRun()
    const user = userEvent.setup()

    const form = await openDialog(user)
    await user.selectOptions(await form.findByLabelText('Material'), String(preterite.id))
    await user.selectOptions(form.getByLabelText('Version'), '1')
    await user.selectOptions(form.getByLabelText('Feedback'), 'at_the_end')
    await user.type(form.getByLabelText('Due'), '2026-10-01T20:00')
    await user.selectOptions(form.getByLabelText('After the due date'), 'refuse')
    await user.selectOptions(form.getByLabelText('Attempts'), 'repeated')
    await user.click(form.getByLabelText('Show solutions after submission'))
    await user.click(form.getByRole('button', { name: 'Continue to the summary' }))
    await user.click(dialog().getByRole('button', { name: 'Release' }))

    expect(runs.release).toHaveBeenCalledWith(7, {
      material_id: 4,
      version: 1,
      audience: 'run',
      student_ids: null,
      feedback_mode: 'at_the_end',
      due_at: new Date('2026-10-01T20:00').toISOString(),
      late_submissions: 'refuse',
      attempts: 'repeated',
      show_solutions: false,
    })
  })

  it('says why a release was refused, back in the form', async () => {
    const { runs } = renderRun()
    runs.release.mockRejectedValueOnce(new ReleaseRefused('due_in_the_past'))
    const user = userEvent.setup()

    const form = await openDialog(user)
    await user.selectOptions(await form.findByLabelText('Material'), String(preterite.id))
    await user.click(form.getByRole('button', { name: 'Continue to the summary' }))
    await user.click(dialog().getByRole('button', { name: 'Release' }))

    expect(await dialog().findByRole('alert')).toHaveTextContent('The due date has passed already.')
    expect(dialog().getByLabelText('Material')).toBeInTheDocument()
  })

  it('says when the course has no material to release, with the way to its topics', async () => {
    renderRun({ materials: [], tab: 'releases' })
    const user = userEvent.setup()

    expect(await screen.findByText('Nothing released yet.')).toBeInTheDocument()
    const form = await openDialog(user)
    expect(await form.findByText('The course has no classroom material to release yet.')).toBeInTheDocument()
    expect(form.getByRole('link', { name: 'Go to the course topics' })).toHaveAttribute('href', '/courses/1?tab=topics')
  })

  it('closes with Escape, releasing nothing', async () => {
    const { runs } = renderRun()
    const user = userEvent.setup()

    await openDialog(user)
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(runs.release).not.toHaveBeenCalled()
  })
})

describe('the dialog', () => {
  it('gives the focus back to the button that opened it', async () => {
    renderRun()
    const user = userEvent.setup()

    const opener = await screen.findByRole('button', { name: 'Release material' })
    await user.click(opener)
    expect(dialog().getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    await user.click(dialog().getByRole('button', { name: 'Cancel' }))

    expect(opener).toHaveFocus()
  })
})

describe('run overview', () => {
  it('says when the releases cannot be loaded, instead of the steps of a new run', async () => {
    const { runs } = renderRun({ releases: [earlier] })
    runs.releases.mockRejectedValueOnce(new Error('offline'))

    expect(await screen.findByText('The releases could not be loaded.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Start the run' })).not.toBeInTheDocument()
  })

  it('follows the roster: enrolling reads the releases again', async () => {
    const { runs } = renderRun({ tab: 'students' })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Enrol a class or student' }))
    await user.selectOptions(dialogNamed('Enrol a class or student').getByLabelText('Enrol a student'), String(jana.id))
    await user.click(dialogNamed('Enrol a class or student').getByRole('button', { name: 'Enrol student' }))

    await vi.waitFor(() => expect(runs.releases).toHaveBeenCalledTimes(2))
  })

  it('shows the current topic, the latest releases with progress, and who is behind', async () => {
    renderRun({ releases: [{ ...earlier, due_at: '2026-09-01T18:00:00Z' }] })

    expect(await screen.findByText('Pretérito indefinido')).toBeInTheDocument()
    const latest = within(screen.getByRole('region', { name: 'Latest releases' }))
    expect(latest.getByRole('link', { name: 'Pretérito in class' })).toHaveAttribute('href', '/runs/7/releases/1')
    expect(latest.getByText('0 of 1 submitted')).toBeInTheDocument()
    const behind = within(screen.getByRole('region', { name: 'Who is behind' }))
    expect(behind.getByRole('link', { name: 'Petr Malý' })).toHaveAttribute('href', `/students/${petr.id}`)
    expect(behind.getByText('Not submitted by the due date: 1')).toBeInTheDocument()
  })

  it('says when nobody is behind', async () => {
    renderRun({ releases: [earlier] })

    const behind = within(await screen.findByRole('region', { name: 'Who is behind' }))
    expect(behind.getByText('Nobody missed a due date.')).toBeInTheDocument()
  })
})
