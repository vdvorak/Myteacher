import { useParams, useSearchParams } from '@solidjs/router'
import { createEffect, createResource, createSignal, For, Index, Match, Show, Switch } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { useApi } from '../api/context'
import { DocumentsSection } from '../documents/DocumentsSection'
import { useI18n } from '../i18n/i18n'
import type { MessageKey } from '../i18n/messages'
import { JobFailureMessage, JobStatus } from '../jobs/JobStatus'
import { MaterialsSection } from '../materials/MaterialsSection'
import { useCourseTrail } from '../courses/trail'
import { PageHeader } from '../shell/PageHeader'
import { NextStep, StepTabs, type StepState, type Tab } from '../shell/StepTabs'
import { TeachersOnly } from '../students/StudentsPage'
import '../admin/admin.css'
import '../courses/courses.css'
import {
  ConceptMapRefused,
  type Concept,
  type ConceptChange,
  type ConceptDraft,
  type ConceptMap,
  type ConceptMapRefusal,
} from './api'
import './concepts.css'
import { AdditionsSection, DiagnosticOfferSection, TopicInterviewPanel } from './TopicSections'

type Problem =
  | { kind: 'refused'; reason: ConceptMapRefusal }
  | { kind: 'failed' | 'loadFailed' | 'nameRequired' }
  | null

// Refusals that mean the map is not what the teacher saw: it is read again.
const staleRefusals: ReadonlySet<ConceptMapRefusal> = new Set([
  'map_changed',
  'proposal_running',
  'map_approved',
  'not_approved',
  'approved_before',
  'unknown_prerequisite',
])

const refusalMessages: Record<Exclude<ConceptMapRefusal, 'no_provider_key'>, MessageKey> = {
  map_changed: 'concepts.changedMeanwhile',
  proposal_running: 'concepts.changedMeanwhile',
  map_approved: 'concepts.changedMeanwhile',
  not_approved: 'concepts.changedMeanwhile',
  approved_before: 'concepts.changedMeanwhile',
  unknown_prerequisite: 'concepts.changedMeanwhile',
  empty_map: 'concepts.emptyMap',
  prerequisite_cycle: 'concepts.cycle',
}

const otherMessages: Record<'failed' | 'loadFailed' | 'nameRequired', MessageKey> = {
  failed: 'courses.saveFailed',
  loadFailed: 'concepts.loadFailed',
  nameRequired: 'concepts.nameRequired',
}

const working = (map: ConceptMap | null) => map?.job?.state === 'queued' || map?.job?.state === 'running'

type TopicTab = 'additions' | 'map' | 'documents' | 'materials'
const topicTabs: TopicTab[] = ['additions', 'map', 'documents', 'materials']
const topicTabLabels: Record<TopicTab, MessageKey> = {
  additions: 'topicTabs.additions',
  map: 'topicTabs.map',
  documents: 'topicTabs.documents',
  materials: 'topicTabs.materials',
}

/** One topic as steps: what it adds to the brief, its concept map, then what is made from the
 * approved map for teaching. */
export function ConceptMapPage() {
  return (
    <TeachersOnly>
      <ConceptMapDetail />
    </TeachersOnly>
  )
}

function ConceptMapDetail() {
  const { t } = useI18n()
  const apis = useApi()
  const api = apis.concepts
  const params = useParams<{ courseId: string; topicId: string }>()
  const [search] = useSearchParams<{ tab?: string }>()
  const courseId = () => Number(params.courseId)
  const topicId = () => Number(params.topicId)
  const [course] = createResource(courseId, (id) => apis.courses.get(id))
  const [topics, { mutate: setTopics, refetch: refetchTopics }] = createResource(courseId, (id) => apis.courses.topics(id))
  const topic = () => (topics.error ? undefined : topics()?.find((t) => t.id === topicId()))
  // Reconciled by id, so a concept keeps its row (and what is typed in it) when the map changes.
  const [state, setState] = createStore<{ map: ConceptMap | null }>({ map: null })
  const [problem, setProblem] = createSignal<Problem>(null)
  const [busy, setBusy] = createSignal(false)
  const [selected, setSelected] = createSignal<number[]>([])

  const show = (map: ConceptMap | null) => {
    setState('map', reconcile(map, { key: 'id', merge: true }))
    const current = new Set(map?.concepts.map((c) => c.id) ?? [])
    setSelected(selected().filter((id) => current.has(id)))
  }
  const [loaded, { refetch }] = createResource(
    () => [courseId(), topicId()] as const,
    async ([cid, tid]) => {
      try {
        show(await api.map(cid, tid))
        return true
      } catch {
        setProblem({ kind: 'loadFailed' })
        return false
      }
    },
  )

  const map = () => state.map
  const canEdit = () => course()?.can_edit === true
  const editable = () => canEdit() && map()?.state === 'draft' && !working(map())
  const canPropose = () => canEdit() && !working(map()) && (map() === null || (map()!.state === 'draft' && !map()!.approved_before))
  const failedJob = () => (map()?.job?.state === 'failed' ? map()!.job : null)

  async function run(action: () => Promise<ConceptMap>): Promise<boolean> {
    setBusy(true)
    setProblem(null)
    try {
      show(await action())
      return true
    } catch (error) {
      if (error instanceof ConceptMapRefused) {
        setProblem({ kind: 'refused', reason: error.reason })
        if (staleRefusals.has(error.reason)) await refetch()
      } else {
        setProblem({ kind: 'failed' })
      }
      return false
    } finally {
      setBusy(false)
    }
  }

  const propose = () => run(async () => (await api.propose(courseId(), topicId())).concept_map)
  const change = (concept: Concept, change: ConceptChange) =>
    run(() => api.change(courseId(), topicId(), concept.id, change))
  const remove = (concept: Concept) => run(() => api.remove(courseId(), topicId(), concept.id))
  const split = (concept: Concept, parts: ConceptDraft[]) => run(() => api.split(courseId(), topicId(), concept.id, parts))
  const choose = (concept: Concept, chosen: boolean) =>
    setSelected(chosen ? [...selected(), concept.id] : selected().filter((id) => id !== concept.id))
  // In map order, whatever order they were chosen in.
  const chosenConcepts = () => (map()?.concepts ?? []).filter((c) => selected().includes(c.id))
  const requireName = (name: string) => {
    if (name.trim() !== '') return true
    setProblem({ kind: 'nameRequired' })
    return false
  }

  useCourseTrail(() => ({ courseId: courseId(), topicId: topicId() }))

  const approved = () => map()?.state === 'approved'
  const holds = () => ({ documents: topic()?.documents ?? 0, materials: topic()?.materials ?? 0 })
  const additionsGiven = () => Object.values(topic()?.additions ?? {}).some((value) => value)
  // What the topic already holds stays within reach while its map is reopened for changes.
  const reachable = (id: 'documents' | 'materials') => approved() || holds()[id] > 0
  const stepState = (id: TopicTab): StepState => {
    if (id === 'additions') return additionsGiven() ? 'done' : 'open'
    if (id === 'map') return approved() ? 'done' : 'next'
    if (!reachable(id)) return 'locked'
    if (!approved()) return 'open'
    if (id === 'documents') return holds().documents > 0 ? 'done' : 'open'
    return holds().materials > 0 ? 'done' : 'next'
  }
  const tabs = (): Tab[] =>
    topicTabs.map((id, index) => ({ id, label: t(topicTabLabels[id]), step: { number: index + 1, state: stepState(id) } }))
  // The step to do when the topic opened; the page stays there as steps get done.
  const [landed, setLanded] = createSignal<{ topic: number; tab: TopicTab }>()
  createEffect(() => {
    if (loaded() && landed()?.topic !== topicId()) setLanded({ topic: topicId(), tab: approved() ? 'materials' : 'map' })
  })
  /** The tab in the address, or else the step that was next when the topic opened. */
  const current = (): TopicTab => {
    const asked = topicTabs.find((id) => id === search.tab)
    if (asked) return asked
    const opened = landed()
    return opened?.topic === topicId() ? opened.tab : approved() ? 'materials' : 'map'
  }
  const href = (id: string) => `/courses/${courseId()}/topics/${topicId()}?tab=${id}`
  const suggestion = (): { sentence: string; action: { label: string; href: string } } | undefined => {
    if (!loaded() || !course()) return undefined
    if (!approved()) {
      return {
        sentence: t(map()?.concepts.length ? 'nextStep.reviewMap' : 'nextStep.proposeMap'),
        action: { label: t('nextStep.openMap'), href: href('map') },
      }
    }
    if (holds().materials === 0) {
      return { sentence: t('nextStep.createMaterial'), action: { label: t('nextStep.openMaterials'), href: href('materials') } }
    }
    return {
      sentence: t('nextStep.release'),
      action: { label: t('nextStep.openRuns'), href: `/courses/${courseId()}?tab=runs` },
    }
  }
  const lockedNote = (
    <p class="step-locked">{t('topicTabs.lockedUntilApproved')}</p>
  )

  return (
    <section class="admin-section">
      <PageHeader title={topic()?.name ?? t('concepts.heading')} meta={course()?.name} />
      <StepTabs label={t('topicTabs.label')} tabs={tabs()} current={current()} href={href} />
      <NextStep sentence={suggestion()?.sentence} action={suggestion()?.action} here={href(current())} />
      <Switch>
        <Match when={current() === 'additions'}>
          <Show when={canEdit()}>
            <TopicInterviewPanel
              courseId={courseId()}
              topicId={topicId()}
              onFinished={() => {
                // A finished interview starts proposing the map.
                void refetch()
                void refetchTopics()
              }}
            />
          </Show>
          <Show when={course() && topic()}>
            {(shown) => (
              <AdditionsSection courseId={courseId()} topic={shown()} canEdit={canEdit()} onChanged={setTopics} />
            )}
          </Show>
        </Match>
        <Match when={current() === 'map'}>
          <section class="settings-form" aria-labelledby="concepts-heading">
            <div class="step-heading">
              <h2 id="concepts-heading">{t('concepts.heading')}</h2>
              {/* Approving is the step's main action, at its head rather than under a long list. */}
              <Show when={editable() && map()!.concepts.length > 0}>
                <button type="button" disabled={busy()} onClick={() => run(() => api.approve(courseId(), topicId(), map()!.version))}>
                  {t('concepts.approve')}
                </button>
              </Show>
            </div>
            <Show when={loaded() && course()}>
              <Show when={editable() && map()!.concepts.length > 0}>
                <p class="settings-note">{t('concepts.approveNote')}</p>
              </Show>
              <p class="settings-note">
                {t(
                  map()?.state === 'approved'
                    ? 'concepts.approved'
                    : map()?.concepts.length
                      ? 'concepts.draft'
                      : 'concepts.none',
                )}
              </p>
              <Show when={working(map()) && map()!.job} keyed>
                {(job) => (
                  <JobStatus
                    job={job}
                    onFinished={() => {
                      // A proposal may bring a diagnostic offer, which is part of the topic.
                      void refetch()
                      void refetchTopics()
                    }}
                  />
                )}
              </Show>
              <Show when={failedJob()}>
                {(job) => <JobFailureMessage kind={job().error_kind ?? 'other'} rawOutput={job().raw_output} />}
              </Show>
              <Show when={canPropose()}>
                <div class="settings-actions">
                  <button type="button" disabled={busy()} onClick={propose}>
                    {t(map()?.concepts.length ? 'concepts.proposeAgain' : 'concepts.propose')}
                  </button>
                </div>
                <Show when={map()?.concepts.length}>
                  <p class="settings-note">{t('concepts.proposalReplaces')}</p>
                </Show>
              </Show>
              <Show when={map()?.concepts.length}>
                <Show
                  when={editable()}
                  fallback={
                    <ol class="concept-list" aria-label={t('concepts.heading')}>
                      <For each={map()!.concepts}>{(concept) => <ConceptView concept={concept} all={map()!.concepts} />}</For>
                    </ol>
                  }
                >
                  <ol class="concept-list" aria-label={t('concepts.heading')}>
                    <For each={map()!.concepts}>
                      {(concept) => (
                        <ConceptEditor
                          concept={concept}
                          all={map()!.concepts}
                          busy={busy()}
                          chosen={selected().includes(concept.id)}
                          onChoose={(chosen) => choose(concept, chosen)}
                          onSave={(changed) => (requireName(changed.name ?? concept.name) ? change(concept, changed) : false)}
                          onRemove={() => remove(concept)}
                          onSplit={(parts) => (parts.every((p) => requireName(p.name)) ? split(concept, parts) : false)}
                        />
                      )}
                    </For>
                  </ol>
                </Show>
              </Show>
              <Show when={editable() && chosenConcepts().length >= 2}>
                <MergeForm
                  concepts={chosenConcepts()}
                  busy={busy()}
                  onMerge={async (merged) => {
                    if (!requireName(merged.name)) return false
                    const ids = chosenConcepts().map((c) => c.id)
                    return run(() => api.merge(courseId(), topicId(), ids, merged))
                  }}
                />
              </Show>
              <Show when={canEdit() && (map() === null || editable())}>
                <NewConceptForm
                  busy={busy()}
                  onAdd={(draft) =>
                    requireName(draft.name) ? run(() => api.add(courseId(), topicId(), { ...draft, prerequisite_ids: [] })) : false
                  }
                />
              </Show>
              <Show when={canEdit() && map()?.state === 'approved'}>
                <div class="settings-actions">
                  <button type="button" disabled={busy()} onClick={() => run(() => api.reopen(courseId(), topicId()))}>
                    {t('concepts.reopen')}
                  </button>
                </div>
              </Show>
            </Show>
            <Show when={problem()}>
              {(shown) => {
                const value = shown()
                if (value.kind === 'refused' && value.reason === 'no_provider_key') return <JobFailureMessage kind="no_key" />
                return (
                  <p role="alert">
                    {t(value.kind === 'refused' ? refusalMessages[value.reason as keyof typeof refusalMessages] : otherMessages[value.kind])}
                  </p>
                )
              }}
            </Show>
          </section>
          <Show when={course() && topic()}>
            {(shown) => (
              <DiagnosticOfferSection
                courseId={courseId()}
                topic={shown()}
                canEdit={canEdit()}
                onChanged={setTopics}
                onStale={() => void refetchTopics()}
              />
            )}
          </Show>
        </Match>
        <Match when={current() === 'documents'}>
          <Show when={loaded() && course()}>
            <Show when={reachable('documents')} fallback={lockedNote}>
              <DocumentsSection
                courseId={courseId()}
                topicId={topicId()}
                canEdit={canEdit()}
                mapApproved={approved()}
                onChanged={() => void refetchTopics()}
              />
            </Show>
          </Show>
        </Match>
        <Match when={current() === 'materials'}>
          <Show when={loaded() && course()}>
            <Show when={reachable('materials')} fallback={lockedNote}>
              <MaterialsSection
                courseId={courseId()}
                topicId={topicId()}
                canEdit={canEdit()}
                mapApproved={approved()}
                onChanged={() => void refetchTopics()}
              />
            </Show>
          </Show>
        </Match>
      </Switch>
    </section>
  )
}

const namesOf = (ids: number[], all: Concept[]) =>
  all
    .filter((c) => ids.includes(c.id))
    .map((c) => c.name)
    .join(', ')

/** A concept as read: its name, its description and what it requires. */
function ConceptView(props: { concept: Concept; all: Concept[] }) {
  const { t } = useI18n()
  return (
    <li class="concept">
      <strong>{props.concept.name}</strong>
      <Show when={props.concept.description}>
        <p>{props.concept.description}</p>
      </Show>
      <Show when={props.concept.prerequisite_ids.length > 0}>
        <p class="settings-note">
          {t('concepts.requiresList', { names: namesOf(props.concept.prerequisite_ids, props.all) })}
        </p>
      </Show>
    </li>
  )
}

/** One concept of a draft: its text and prerequisites, a split into parts, and its removal. */
function ConceptEditor(props: {
  concept: Concept
  all: Concept[]
  busy: boolean
  chosen: boolean
  onChoose: (chosen: boolean) => void
  onSave: (change: ConceptChange) => Promise<boolean> | false
  onRemove: () => Promise<boolean>
  onSplit: (parts: ConceptDraft[]) => Promise<boolean> | false
}) {
  const { t } = useI18n()
  // What the teacher typed; undefined while untouched, so a change from elsewhere shows.
  const [name, setName] = createSignal<string>()
  const [description, setDescription] = createSignal<string>()
  // The prerequisites the teacher ticked (true) and unticked (false); empty while untouched.
  const [toggled, setToggled] = createSignal<Record<number, boolean>>({})
  const [splitting, setSplitting] = createSignal(false)
  const [removing, setRemoving] = createSignal(false)
  const current = {
    name: () => name() ?? props.concept.name,
    description: () => description() ?? props.concept.description,
    // The saved ones with the teacher's ticks, in map order and without a concept that left
    // the map meanwhile, which could never be saved or unticked.
    requires: () =>
      props.all
        .map((c) => c.id)
        .filter((id) => toggled()[id] ?? props.concept.prerequisite_ids.includes(id)),
  }
  const toggle = (id: number, on: boolean) => setToggled({ ...toggled(), [id]: on })

  async function save(event: SubmitEvent) {
    event.preventDefault()
    // Only what the teacher changed, so that a co-editor's change to the rest is not undone.
    const change: ConceptChange = {}
    const name = current.name().trim()
    const description = current.description().trim()
    if (name !== props.concept.name) change.name = name
    if (description !== props.concept.description) change.description = description
    // Only the ticks that differ from what is saved, of concepts still in the map.
    const ticks = props.all
      .map((c) => c.id)
      .filter((id) => id in toggled() && toggled()[id] !== props.concept.prerequisite_ids.includes(id))
    const added = ticks.filter((id) => toggled()[id])
    const removed = ticks.filter((id) => !toggled()[id])
    if (added.length > 0) change.add_prerequisite_ids = added
    if (removed.length > 0) change.remove_prerequisite_ids = removed
    const saved = Object.keys(change).length === 0 || (await props.onSave(change))
    if (saved) {
      setName(undefined)
      setDescription(undefined)
      setToggled({})
    }
  }

  return (
    <li class="concept">
      <label class="settings-check">
        <input type="checkbox" checked={props.chosen} onChange={(e) => props.onChoose(e.currentTarget.checked)} />
        {t('concepts.choose', { name: props.concept.name })}
      </label>
      <form class="concept-form" onSubmit={save}>
        <label>
          {t('concepts.name')}
          <input maxLength={200} value={current.name()} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <label>
          {t('concepts.description')}
          <textarea
            rows={2}
            maxLength={1000}
            value={current.description()}
            onInput={(e) => setDescription(e.currentTarget.value)}
          />
        </label>
        <Show when={props.all.length > 1}>
          <fieldset class="concept-prerequisites">
            <legend>{t('concepts.requires')}</legend>
            <For each={props.all.filter((c) => c.id !== props.concept.id)}>
              {(other) => (
                <label class="settings-check">
                  <input
                    type="checkbox"
                    checked={current.requires().includes(other.id)}
                    onChange={(e) => toggle(other.id, e.currentTarget.checked)}
                  />
                  {t('concepts.requiresOne', { name: other.name })}
                </label>
              )}
            </For>
          </fieldset>
        </Show>
        <div class="settings-actions">
          <button type="submit" disabled={props.busy}>
            {t('concepts.save')}
          </button>
          <Show when={!splitting()}>
            <button type="button" disabled={props.busy} onClick={() => setSplitting(true)}>
              {t('concepts.split')}
            </button>
          </Show>
          <Show
            when={removing()}
            fallback={
              <button type="button" disabled={props.busy} onClick={() => setRemoving(true)}>
                {t('concepts.remove')}
              </button>
            }
          >
            <button type="button" class="danger" disabled={props.busy} onClick={() => void props.onRemove()}>
              {t('concepts.removeForGood', { name: props.concept.name })}
            </button>
            <button type="button" onClick={() => setRemoving(false)}>
              {t('concepts.keep')}
            </button>
          </Show>
        </div>
      </form>
      <Show when={splitting()}>
        <SplitForm
          concept={props.concept}
          busy={props.busy}
          onSplit={props.onSplit}
          onCancel={() => setSplitting(false)}
        />
      </Show>
    </li>
  )
}

/** The parts a concept is split into, two to start with. */
function SplitForm(props: {
  concept: Concept
  busy: boolean
  onSplit: (parts: ConceptDraft[]) => Promise<boolean> | false
  onCancel: () => void
}) {
  const { t } = useI18n()
  const [parts, setParts] = createSignal<ConceptDraft[]>([
    { name: '', description: '' },
    { name: '', description: '' },
  ])
  const setPart = (index: number, change: Partial<ConceptDraft>) =>
    setParts(parts().map((part, i) => (i === index ? { ...part, ...change } : part)))

  return (
    <form
      class="concept-form concept-split"
      aria-label={t('concepts.splitHeading', { name: props.concept.name })}
      onSubmit={(event) => {
        event.preventDefault()
        void props.onSplit(parts().map((p) => ({ name: p.name.trim(), description: p.description.trim() })))
      }}
    >
      {/* By index, so a row keeps its inputs (and focus) while its part is typed. */}
      <Index each={parts()}>
        {(part, index) => (
          <>
            <label>
              {t('concepts.partName', { n: index + 1 })}
              <input maxLength={200} value={part().name} onInput={(e) => setPart(index, { name: e.currentTarget.value })} />
            </label>
            <label>
              {t('concepts.partDescription', { n: index + 1 })}
              <textarea
                rows={2}
                maxLength={1000}
                value={part().description}
                onInput={(e) => setPart(index, { description: e.currentTarget.value })}
              />
            </label>
          </>
        )}
      </Index>
      <div class="settings-actions">
        <button type="button" onClick={() => setParts([...parts(), { name: '', description: '' }])}>
          {t('concepts.addPart')}
        </button>
        <button type="submit" disabled={props.busy}>
          {t('concepts.split')}
        </button>
        <button type="button" onClick={() => props.onCancel()}>
          {t('concepts.cancel')}
        </button>
      </div>
    </form>
  )
}

/** The new concept that replaces the chosen ones, named after them to start with. */
function MergeForm(props: {
  concepts: Concept[]
  busy: boolean
  onMerge: (merged: ConceptDraft) => Promise<boolean> | false
}) {
  const { t } = useI18n()
  const [name, setName] = createSignal<string>()
  const [description, setDescription] = createSignal('')
  const shownName = () => name() ?? props.concepts.map((c) => c.name).join(' / ')

  return (
    <form
      class="concept-form"
      aria-label={t('concepts.mergeHeading', { count: props.concepts.length })}
      onSubmit={(event) => {
        event.preventDefault()
        void props.onMerge({ name: shownName().trim(), description: description().trim() })
      }}
    >
      <h3>{t('concepts.mergeHeading', { count: props.concepts.length })}</h3>
      <label>
        {t('concepts.mergedName')}
        <input maxLength={200} value={shownName()} onInput={(e) => setName(e.currentTarget.value)} />
      </label>
      <label>
        {t('concepts.mergedDescription')}
        <textarea rows={2} maxLength={1000} value={description()} onInput={(e) => setDescription(e.currentTarget.value)} />
      </label>
      <div class="settings-actions">
        <button type="submit" disabled={props.busy}>
          {t('concepts.merge')}
        </button>
      </div>
    </form>
  )
}

/** A concept added by hand at the end of the map. */
function NewConceptForm(props: { busy: boolean; onAdd: (draft: ConceptDraft) => Promise<boolean> | false }) {
  const { t } = useI18n()
  const [name, setName] = createSignal('')
  const [description, setDescription] = createSignal('')

  return (
    <form
      class="concept-form"
      aria-label={t('concepts.new')}
      onSubmit={async (event) => {
        event.preventDefault()
        if (await props.onAdd({ name: name().trim(), description: description().trim() })) {
          setName('')
          setDescription('')
        }
      }}
    >
      <h3>{t('concepts.new')}</h3>
      <label>
        {t('concepts.name')}
        <input maxLength={200} value={name()} onInput={(e) => setName(e.currentTarget.value)} />
      </label>
      <label>
        {t('concepts.description')}
        <textarea rows={2} maxLength={1000} value={description()} onInput={(e) => setDescription(e.currentTarget.value)} />
      </label>
      <div class="settings-actions">
        <button type="submit" disabled={props.busy}>
          {t('concepts.add')}
        </button>
      </div>
    </form>
  )
}
