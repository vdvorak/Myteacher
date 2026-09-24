import { A, useNavigate } from '@solidjs/router'
import { createResource, createSignal, For, Show } from 'solid-js'
import { useApi } from '../api/context'
import { useI18n } from '../i18n/i18n'
import '../admin/admin.css'
import { TeachersOnly } from '../students/StudentsPage'
import { NameTaken } from './api'

type Problem = 'nameTaken' | 'failed' | null

/** Every class on the instance, and the form to create one. */
export function ClassesPage() {
  return (
    <TeachersOnly>
      <ClassesList />
    </TeachersOnly>
  )
}

function ClassesList() {
  const { t } = useI18n()
  const api = useApi().classes
  const navigate = useNavigate()
  const [classes] = createResource(() => api.list())
  const [name, setName] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [problem, setProblem] = createSignal<Problem>(null)

  async function create(event: SubmitEvent) {
    event.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      const created = await api.create(name().trim())
      navigate(`/classes/${created.id}`)
    } catch (error) {
      setProblem(error instanceof NameTaken ? 'nameTaken' : 'failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section class="admin-section" aria-labelledby="classes-heading">
      <h1 id="classes-heading">{t('classes.heading')}</h1>
      <Show when={classes.error}>
        <p role="alert">{t('classes.loadFailed')}</p>
      </Show>
      <Show when={!classes.error && classes()}>
        {(list) => (
          <Show when={list().length > 0} fallback={<p>{t('classes.none')}</p>}>
            <div class="table-scroll">
              <table class="admin-table">
                <thead>
                  <tr>
                    <th scope="col">{t('classes.name')}</th>
                    <th scope="col">{t('classes.memberCount')}</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={list()}>
                    {(klass) => (
                      <tr>
                        <td>
                          <A href={`/classes/${klass.id}`}>{klass.name}</A>
                        </td>
                        <td>{klass.member_count}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        )}
      </Show>
      <h2>{t('classes.new')}</h2>
      <form class="settings-form" onSubmit={create}>
        <label>
          {t('classes.name')}
          <input
            required
            maxLength={100}
            placeholder="2.B 2026/27"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </label>
        <div class="settings-actions">
          <button type="submit" disabled={busy()}>
            {t('classes.create')}
          </button>
        </div>
      </form>
      <Show when={problem()}>
        {(current) => (
          <p role="alert">{t(current() === 'nameTaken' ? 'classes.nameTaken' : 'smtp.requestFailed')}</p>
        )}
      </Show>
    </section>
  )
}
