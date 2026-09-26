import { A, useNavigate } from '@solidjs/router'
import { createResource, createSignal, For, Match, Show, Switch } from 'solid-js'
import { useApi } from '../api/context'
import { useSession } from '../auth/session'
import { basicsOf, CourseBasicsFields, emptyBasics, type BasicsDraft } from '../courses/CourseBasicsForm'
import { useI18n } from '../i18n/i18n'
import { asProblem, isPdf, PagesField, ProblemMessage, type Problem } from '../materials/MaterialsSection'
import { Dialog } from '../shell/Dialog'
import { sourceFileTypes } from '../sources/api'
import './home.css'

/** An existing course or topic, or a new one. */
type Choice = number | 'new'

const choiceOf = (value: string): Choice => (value === 'new' ? 'new' : Number(value))

/** A test the teacher has turned into classroom material of a topic, the course and the topic chosen or created on
 * the way; the topic is then opened while the material is being transcribed. */
export function TurnTestDialog(props: { onClose: () => void }) {
  const { t } = useI18n()
  const apis = useApi()
  const navigate = useNavigate()
  const session = useSession()
  // A teacher without a provider key is told so before filling the form; keys that could not be read do not
  // keep the form away, as the server refuses what needs a key anyway.
  const [credentials] = createResource(
    () => session.account()?.id,
    (accountId) => apis.settings.credentials(accountId),
  )
  const noProviderKey = () => !credentials.error && credentials()?.length === 0
  const [courses, { refetch: refetchCourses }] = createResource(async () =>
    (await apis.courses.list()).filter((course) => course.access === 'owner' || course.access === 'edit'),
  )
  const [courseChoice, setCourseChoice] = createSignal<Choice | null>(null)
  const chosenCourse = (): Choice => courseChoice() ?? courses()?.[0]?.id ?? 'new'
  const [basics, setBasics] = createSignal<BasicsDraft>(emptyBasics)
  const [topics, { refetch: refetchTopics }] = createResource(
    () => {
      const course = chosenCourse()
      return course === 'new' ? false : course
    },
    (course) => apis.courses.topics(course),
  )
  const [topicChoice, setTopicChoice] = createSignal<Choice | null>(null)
  // A new course gets a new topic; an existing one its first topic, or a new one when it has none. None is chosen
  // while the course's topics are not known.
  const chosenTopic = (): Choice | null => {
    if (chosenCourse() === 'new') return 'new'
    if (topics.error || topics() === undefined) return null
    return topicChoice() ?? topics()![0]?.id ?? 'new'
  }
  const [topicName, setTopicName] = createSignal('')
  const [testFile, setTestFile] = createSignal<File | null>(null)
  const [keyFile, setKeyFile] = createSignal<File | null>(null)
  const [testPages, setTestPages] = createSignal('')
  const [keyPages, setKeyPages] = createSignal('')
  // The pages written of a PDF; empty is the whole file.
  const pagesOf = (file: File | null, written: string) => (isPdf(file) && written.trim() !== '' ? written.trim() : null)
  const [busy, setBusy] = createSignal(false)
  const [problem, setProblem] = createSignal<Problem>(null)

  // What was created is chosen from then on, so trying again after a refusal does not create it twice. It is
  // chosen once listed, as a select shows no choice it has no option for.
  async function courseOf(choice: Choice): Promise<number> {
    if (choice !== 'new') return choice
    const { id } = await apis.courses.create(basicsOf(basics())!)
    await refetchCourses()
    setCourseChoice(id)
    return id
  }

  async function topicOf(course: number, choice: Choice): Promise<number> {
    if (choice !== 'new') return choice
    // A topic is added at the end of the course.
    const { id } = (await apis.courses.addTopic(course, topicName().trim())).at(-1)!
    await refetchTopics()
    setTopicChoice(id)
    return id
  }

  // The files uploaded to each course, so trying again does not upload them twice, nor the same file chosen as the
  // test and as the answer key, which are then other pages of one source.
  const uploaded = new Map<string, { course: number; source: number }>()
  async function sourceOf(course: number, file: File): Promise<number> {
    const identity = `${file.name}\n${file.size}\n${file.lastModified}`
    const known = uploaded.get(identity)
    if (known?.course === course) return known.source
    const { source } = await apis.sources.store(course, file)
    uploaded.set(identity, { course, source: source.id })
    return source.id
  }

  async function transcribe(event: SubmitEvent) {
    event.preventDefault()
    // Read before anything is created, as creating changes what is chosen.
    const course = chosenCourse()
    const topic = chosenTopic()
    const test = testFile()
    if (topic === null || test === null || (course === 'new' && basicsOf(basics()) === null)) return
    const answers = keyFile()
    setBusy(true)
    setProblem(null)
    try {
      const courseId = await courseOf(course)
      const topicId = await topicOf(courseId, topic)
      const source = await sourceOf(courseId, test)
      const keySource = answers === null ? null : await sourceOf(courseId, answers)
      await apis.materials.transcribe(courseId, topicId, {
        source_id: source,
        key_source_id: keySource,
        target_student_ids: [],
        source_pages: pagesOf(test, testPages()),
        key_pages: pagesOf(answers, keyPages()),
      })
      navigate(`/courses/${courseId}/topics/${topicId}?tab=materials`)
    } catch (error) {
      setProblem(asProblem(error))
    } finally {
      setBusy(false)
    }
  }

  const cancel = () => (
    <button type="button" class="button-secondary" onClick={() => props.onClose()}>
      {t('access.cancel')}
    </button>
  )

  return (
    <Dialog title={t('turnTest.title')} onClose={props.onClose}>
      <Switch>
        <Match when={noProviderKey()}>
          <p>
            {t('turnTest.needsKey')} <A href="/settings">{t('nav.settings')}</A>
          </p>
          <div class="dialog-actions">{cancel()}</div>
        </Match>
        <Match when={courses.error}>
          <p role="alert">{t('courses.loadFailed')}</p>
          <div class="dialog-actions">{cancel()}</div>
        </Match>
        <Match when={(credentials.error || credentials()) && courses()}>
          {(editable) => (
            <form class="settings-form turn-test" onSubmit={transcribe}>
              <p class="settings-note">{t('turnTest.intro')}</p>
              {/* A teacher who may edit no course creates one. */}
              <Show when={editable().length > 0}>
                <label>
                  {t('turnTest.course')}
                  <select
                    value={String(chosenCourse())}
                    onChange={(e) => {
                      setCourseChoice(choiceOf(e.currentTarget.value))
                      setTopicChoice(null)
                    }}
                  >
                    <For each={editable()}>{(course) => <option value={course.id}>{course.name}</option>}</For>
                    <option value="new">{t('turnTest.newCourse')}</option>
                  </select>
                </label>
              </Show>
              <Show when={chosenCourse() === 'new'}>
                <fieldset>
                  <legend>{t('courses.new')}</legend>
                  <CourseBasicsFields basics={basics()} onChange={setBasics} />
                </fieldset>
              </Show>
              <Show when={chosenCourse() !== 'new' && topics.error}>
                <p role="alert">{t('topics.loadFailed')}</p>
              </Show>
              <Show when={chosenCourse() !== 'new' && !topics.error && topics()}>
                {(held) => (
                  <Show when={held().length > 0}>
                    <label>
                      {t('turnTest.topic')}
                      <select
                        value={String(chosenTopic())}
                        onChange={(e) => setTopicChoice(choiceOf(e.currentTarget.value))}
                      >
                        <For each={held()}>{(topic) => <option value={topic.id}>{topic.name}</option>}</For>
                        <option value="new">{t('turnTest.newTopic')}</option>
                      </select>
                    </label>
                  </Show>
                )}
              </Show>
              <Show when={chosenTopic() === 'new'}>
                <label>
                  {t('turnTest.topicName')}
                  <input
                    required
                    maxLength={200}
                    value={topicName()}
                    onInput={(e) => setTopicName(e.currentTarget.value)}
                  />
                </label>
              </Show>
              <label>
                {t('materials.testFile')}
                <input
                  type="file"
                  accept={sourceFileTypes}
                  onChange={(e) => setTestFile(e.currentTarget.files?.[0] ?? null)}
                />
              </label>
              <Show when={isPdf(testFile())}>
                <PagesField label={t('materials.testPages')} pages={testPages()} onPages={setTestPages} />
              </Show>
              <label>
                {t('turnTest.keyFile')}
                <input
                  type="file"
                  accept={sourceFileTypes}
                  onChange={(e) => setKeyFile(e.currentTarget.files?.[0] ?? null)}
                />
              </label>
              <Show when={isPdf(keyFile())}>
                <PagesField label={t('materials.keyPages')} pages={keyPages()} onPages={setKeyPages} />
              </Show>
              <p class="settings-note">{t('turnTest.uploadNote')}</p>
              <ProblemMessage problem={problem()} />
              <div class="dialog-actions">
                {cancel()}
                <button type="submit" disabled={busy() || chosenTopic() === null || testFile() === null}>
                  {t('materials.transcribe')}
                </button>
              </div>
            </form>
          )}
        </Match>
      </Switch>
    </Dialog>
  )
}
