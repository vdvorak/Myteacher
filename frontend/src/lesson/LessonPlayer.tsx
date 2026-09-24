import { createEffect, createSignal, createUniqueId, For, Match, Show, Switch } from 'solid-js'
import type {
  AssessmentResult,
  LessonPublic,
  MultipleChoiceAnswer,
  SecondRound,
} from '../generated/lesson'
import { useI18n } from '../i18n/i18n'
import { Markdown } from './Markdown'
import { layoutOf, MultipleChoice, type Verdict } from './MultipleChoice'
import {
  clearProgress,
  exerciseProgress,
  exerciseStatus,
  failedExercises,
  lessonExercises,
  lessonFinished,
  loadProgress,
  MAX_TRIES,
  newProgress,
  newRound,
  recordTry,
  roundComplete,
  saveProgress,
  select,
  unanswered,
  type Exercise,
  type LessonProgress,
  type RoundProgress,
  type Try,
} from './progress'
import './lesson.css'

export interface LessonApi {
  /** `reveal: false` marks a try the student may still retry: a wrong answer comes back without its solution. */
  assess: (
    exerciseId: string,
    answer: MultipleChoiceAnswer,
    options: { reveal: boolean },
  ) => Promise<AssessmentResult>
  secondRound: (failedExerciseIds: string[], seed: string) => Promise<SecondRound>
}

export interface LessonPlayerProps {
  lesson: LessonPublic
  seed: string
  api: LessonApi
}

type RoundKey = 'first' | 'second'

/** Plays one lesson: the first pass in the lesson's feedback mode, then a second round of what failed. */
export function LessonPlayer(props: LessonPlayerProps) {
  const { t } = useI18n()
  const mode = () => props.lesson.feedback_mode
  const [progress, setProgress] = createSignal<LessonProgress>(
    loadProgress(props.lesson, props.seed) ?? newProgress(props.lesson, props.seed),
  )
  const [busy, setBusy] = createSignal<ReadonlySet<string>>(new Set())
  const [failures, setFailures] = createSignal<ReadonlySet<string>>(new Set())
  const secondRoundHeading = createUniqueId()

  const finished = () => lessonFinished(mode(), progress())
  createEffect(() => {
    const current = progress()
    if (lessonFinished(mode(), current)) clearProgress(current.lessonId)
    else saveProgress(current)
  })

  const flag = (setter: typeof setBusy, key: string, on: boolean) =>
    setter((keys) => {
      const next = new Set(keys)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  /** Runs `task` with `key` marked busy; a thrown error marks `key` as failed. */
  async function track(key: string, task: () => Promise<void>) {
    flag(setBusy, key, true)
    flag(setFailures, key, false)
    try {
      await task()
    } catch {
      flag(setFailures, key, true)
    } finally {
      flag(setBusy, key, false)
    }
  }

  const round = (key: RoundKey) => progress()[key]
  const updateRound = (key: RoundKey, change: (round: RoundProgress) => RoundProgress) =>
    setProgress((current) => ({ ...current, [key]: change(current[key]!) }))

  const answerOf = (optionId: string): MultipleChoiceAnswer => ({
    type: 'multiple_choice',
    option_id: optionId,
  })

  function confirm(key: RoundKey, exercise: Exercise) {
    const { selected, tries } = exerciseProgress(round(key)!, exercise.id)
    if (selected === undefined) return
    const reveal = tries.length + 1 >= MAX_TRIES
    void track(`${key}:${exercise.id}`, async () => {
      const result = await props.api.assess(exercise.id, answerOf(selected), { reveal })
      updateRound(key, (r) => recordTry(r, exercise.id, { optionId: selected, result }))
    })
  }

  function submit(key: RoundKey) {
    const current = round(key)!
    void track(`${key}:submit`, async () => {
      const tries = await Promise.all(
        current.exercises.map(async (exercise): Promise<[string, Try]> => {
          const optionId = exerciseProgress(current, exercise.id).selected!
          const result = await props.api.assess(exercise.id, answerOf(optionId), { reveal: true })
          return [exercise.id, { optionId, result }]
        }),
      )
      updateRound(key, (r) => ({
        ...tries.reduce((acc, [id, attempt]) => recordTry(acc, id, attempt), r),
        submitted: true,
      }))
    })
  }

  function startSecondRound() {
    void track('second-round', async () => {
      const repeats = await props.api.secondRound(failedExercises(progress().first), props.seed)
      setProgress((current) => ({ ...current, second: newRound(repeats.exercises) }))
    })
  }

  const firstLayouts = () =>
    new Map(lessonExercises(props.lesson).map((exercise) => [exercise.id, layoutOf(exercise, props.seed)]))

  function renderExercise(key: RoundKey, exercise: Exercise) {
    const state = () => exerciseProgress(round(key)!, exercise.id)
    const status = () => exerciseStatus(mode(), round(key)!, exercise.id)
    const lastTry = () => state().tries.at(-1)
    const verdict = (): Verdict | undefined => {
      if (status() === 'retrying') return 'retry'
      if (status() !== 'locked') return undefined
      return lastTry()?.result.correct ? 'correct' : 'incorrect'
    }
    return (
      <MultipleChoice
        exercise={exercise}
        seed={key === 'first' ? props.seed : `${props.seed}:second-round`}
        previousLayout={key === 'second' ? firstLayouts().get(exercise.id) : undefined}
        selected={state().selected}
        onSelect={(optionId) => updateRound(key, (r) => select(r, exercise.id, optionId))}
        locked={status() === 'locked'}
        triedOptions={state()
          .tries.filter((attempt) => !attempt.result.correct)
          .map((attempt) => attempt.optionId)}
        verdict={verdict()}
        solution={status() === 'locked' ? lastTry()?.result.solution : null}
        onConfirm={mode() === 'immediate' ? () => confirm(key, exercise) : undefined}
        checking={busy().has(`${key}:${exercise.id}`) || busy().has(`${key}:submit`)}
        failed={failures().has(`${key}:${exercise.id}`)}
      />
    )
  }

  function renderSubmit(key: RoundKey) {
    const remaining = () => unanswered(round(key)!)
    return (
      <Show when={mode() === 'at_the_end' && !round(key)!.submitted}>
        <div class="lesson-actions">
          <Show when={remaining() > 0}>
            <span class="lesson-note">{t('lesson.unanswered', { count: remaining() })}</span>
          </Show>
          <button
            type="button"
            disabled={remaining() > 0 || busy().has(`${key}:submit`)}
            onClick={() => submit(key)}
          >
            {t('lesson.submit')}
          </button>
          <Show when={failures().has(`${key}:submit`)}>
            <p class="lesson-error" role="alert">
              {t('exercise.assessFailed')}
            </p>
          </Show>
        </div>
      </Show>
    )
  }

  const firstPassScore = () => {
    const first = progress().first
    return { correct: first.exercises.length - failedExercises(first).length, total: first.exercises.length }
  }

  return (
    <article class="lesson" lang={props.lesson.language}>
      <h1 class="lesson-title">{props.lesson.title}</h1>
      <For each={props.lesson.blocks}>
        {(block) => (
          <Switch>
            <Match when={block.type === 'explanation' && block}>
              {(explanation) => <Markdown source={explanation().markdown} />}
            </Match>
            <Match when={block.type === 'multiple_choice' && block}>
              {(exercise) => renderExercise('first', exercise())}
            </Match>
          </Switch>
        )}
      </For>
      {renderSubmit('first')}

      <Show when={roundComplete(mode(), progress().first) && !progress().second && !finished()}>
        <div class="lesson-actions">
          <p class="lesson-note">{t('lesson.secondRoundIntro')}</p>
          <button type="button" disabled={busy().has('second-round')} onClick={startSecondRound}>
            {t('lesson.startSecondRound')}
          </button>
          <Show when={failures().has('second-round')}>
            <p class="lesson-error" role="alert">
              {t('lesson.secondRoundFailed')}
            </p>
          </Show>
        </div>
      </Show>

      <Show when={progress().second}>
        {(second) => (
          <section class="lesson-round" aria-labelledby={secondRoundHeading}>
            <h2 id={secondRoundHeading}>{t('lesson.secondRound')}</h2>
            <For each={second().exercises}>{(exercise) => renderExercise('second', exercise)}</For>
            {renderSubmit('second')}
          </section>
        )}
      </Show>

      <Show when={finished()}>
        <div class="lesson-finished" role="status">
          <h2>{t('lesson.finished')}</h2>
          <p>{t('lesson.firstPassScore', firstPassScore())}</p>
        </div>
      </Show>
    </article>
  )
}
