import { createMemoryHistory } from '@solidjs/router'
import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
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

function renderRun(options: { materials?: ReleasableMaterial[]; releases?: Release[]; studentIds?: number[] } = {}) {
  const history = createMemoryHistory()
  history.set({ value: '/runs/7' })
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

describe('releases of a run', () => {
  it('lists the releases with their settings', async () => {
    renderRun({ releases: [earlier] })

    const row = (await releaseTable()).getByText('Pretérito in class').closest('tr')!
    const cells = within(row)
    expect(cells.getByText('Pretérito indefinido')).toBeInTheDocument()
    expect(cells.getByText('1')).toBeInTheDocument()
    expect(cells.getByText('Petr Malý')).toBeInTheDocument()
    expect(cells.getByText('At the end')).toBeInTheDocument()
    expect(cells.getByText(new Date('2026-10-01T18:00:00Z').toLocaleString('en'))).toBeInTheDocument()
    expect(cells.getByText('Refused')).toBeInTheDocument()
    expect(cells.getByText('Repeated, the last counts')).toBeInTheDocument()
    expect(cells.getByText('Hidden')).toBeInTheDocument()
  })

  it('releases the latest version to the whole run with the default settings', async () => {
    const { runs } = renderRun()
    const user = userEvent.setup()

    await user.selectOptions(await screen.findByLabelText('Material'), String(preterite.id))
    expect(screen.getByLabelText('Version')).toHaveValue('2')
    expect(screen.getByLabelText('Whole run, including students who join later')).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Release' }))

    expect(runs.release).toHaveBeenCalledWith(7, {
      material_id: 4,
      version: 2,
      audience: 'run',
      student_ids: null,
      ...defaultSettings,
    })
    const row = (await releaseTable()).getByText('Pretérito in class').closest('tr')!
    expect(within(row).getByText('Whole run')).toBeInTheDocument()
    expect(within(row).getByText('Accepted, marked late')).toBeInTheDocument()
  })

  it('releases to chosen students, the material’s targets preselected', async () => {
    const { runs } = renderRun()
    const user = userEvent.setup()

    await user.selectOptions(await screen.findByLabelText('Material'), String(preterite.id))
    await user.click(screen.getByLabelText('Chosen students'))
    const chosen = within(screen.getByRole('group', { name: 'Chosen students' }))
    expect(chosen.getByLabelText('Petr Malý')).toBeChecked()
    expect(chosen.getByLabelText('Jana Veselá')).not.toBeChecked()
    await user.click(chosen.getByLabelText('Jana Veselá'))
    await user.click(screen.getByRole('button', { name: 'Release' }))

    expect(runs.release).toHaveBeenCalledWith(7, expect.objectContaining({ audience: 'chosen', student_ids: [jana.id, petr.id] }))
  })

  it('drops chosen students who left the run meanwhile', async () => {
    const { runs } = renderRun({ studentIds: [jana.id] })
    const user = userEvent.setup()

    await user.selectOptions(await screen.findByLabelText('Material'), String(preterite.id))
    await user.click(screen.getByLabelText('Chosen students'))
    await user.click(within(screen.getByRole('group', { name: 'Chosen students' })).getByLabelText('Jana Veselá'))
    // Petr, preselected as the material's target, leaves with the class.
    await user.click(within(await screen.findByRole('table', { name: 'Enrolled classes' })).getByRole('button', { name: 'Remove' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    await screen.findByText('No classes enrolled.')
    await user.click(screen.getByRole('button', { name: 'Release' }))

    expect(runs.release).toHaveBeenCalledWith(7, expect.objectContaining({ student_ids: [jana.id] }))
  })

  it('cannot release to chosen students once none of them is in the run', async () => {
    renderRun()
    const user = userEvent.setup()

    await user.selectOptions(await screen.findByLabelText('Material'), String(preterite.id))
    await user.click(screen.getByLabelText('Chosen students'))
    await user.click(within(await screen.findByRole('table', { name: 'Enrolled classes' })).getByRole('button', { name: 'Remove' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    await screen.findByText('No classes enrolled.')

    expect(screen.getByRole('button', { name: 'Release' })).toBeDisabled()
  })

  it('sends every setting the teacher chose, and an earlier version', async () => {
    const { runs } = renderRun()
    const user = userEvent.setup()

    await user.selectOptions(await screen.findByLabelText('Material'), String(preterite.id))
    await user.selectOptions(screen.getByLabelText('Version'), '1')
    await user.selectOptions(screen.getByLabelText('Feedback'), 'at_the_end')
    await user.type(screen.getByLabelText('Due'), '2026-10-01T20:00')
    await user.selectOptions(screen.getByLabelText('After the due date'), 'refuse')
    await user.selectOptions(screen.getByLabelText('Attempts'), 'repeated')
    await user.click(screen.getByLabelText('Show solutions after submission'))
    await user.click(screen.getByRole('button', { name: 'Release' }))

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

  it('says why a release was refused', async () => {
    const { runs } = renderRun()
    runs.release.mockRejectedValueOnce(new ReleaseRefused('due_in_the_past'))
    const user = userEvent.setup()

    await user.selectOptions(await screen.findByLabelText('Material'), String(preterite.id))
    await user.click(screen.getByRole('button', { name: 'Release' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The due date has passed already.')
  })

  it('says when the course has no material to release', async () => {
    renderRun({ materials: [] })

    expect(await screen.findByText('The course has no classroom material to release yet.')).toBeInTheDocument()
    expect(screen.getByText('Nothing released yet.')).toBeInTheDocument()
  })
})
