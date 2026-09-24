import { createEffect, createSignal, createUniqueId, For, Match, Show, Switch } from 'solid-js'
import type { LessonPublic, SecondRound } from '../generated/lesson'
import { useI18n } from '../i18n/i18n'
import type { Verdict } from './exercises/ExerciseFrame'
import { exerciseLayout, ExerciseView } from './exercises/ExerciseView'
import { Markdown } from './Markdown'
import { isRendered, type RenderedAnswer, type TryOutcome } from './schema'
import { UnsupportedExercise, type UnrenderedExercise } from './UnsupportedExercise'
import {
  clearProgress,
  exerciseProgress,
  exerciseStatus,
  failedExercises,
  isComplete,
  lessonExercises,
  lessonFinished,
  loadProgress,
  MAX_TRIES,
  newProgress,
  newRound,
  recordTry,
  roundComplete,
  saveProgress,
  scoredExercises,
  setDraft,
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
    answer: RenderedAnswer,
    options: { reveal: boolean },
  ) => Promise<TryOutcome>
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

  function confirm(key: RoundKey, exercise: Exercise) {
    const { draft, tries } = exerciseProgress(round(key)!, exercise.id)
    if (!draft || !isComplete(exercise, draft)) return
    const reveal = tries.length + 1 >= MAX_TRIES
    void track(`${key}:${exercise.id}`, async () => {
      const result = await props.api.assess(exercise.id, draft, { reveal })
      updateRound(key, (r) => recordTry(r, exercise.id, { answer: draft, result }))
    })
  }

  function submit(key: RoundKey) {
    const current = round(key)!
    void track(`${key}:submit`, async () => {
      // An open exercise left empty is not sent: it awaits nothing and is never repeated.
      const answered = current.exercises.filter((exercise) =>
        isComplete(exercise, exerciseProgress(current, exercise.id).draft),
      )
      const tries = await Promise.all(
        answered.map(async (exercise): Promise<[string, Try]> => {
          const answer = exerciseProgress(current, exercise.id).draft!
          const result = await props.api.assess(exercise.id, answer, { reveal: true })
          return [exercise.id, { answer, result }]
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
      setProgress((current) => ({
        ...current,
        second: newRound(repeats.exercises.filter(isRendered)),
      }))
    })
  }

  const firstLayouts = () =>
    new Map(
      lessonExercises(props.lesson).flatMap((exercise): [string, string[]][] => {
        const layout = exerciseLayout(exercise, props.seed)
        return layout ? [[exercise.id, layout]] : []
      }),
    )

  function renderExercise(key: RoundKey, exercise: Exercise) {
    const state = () => exerciseProgress(round(key)!, exercise.id)
    const status = () => exerciseStatus(mode(), round(key)!, exercise.id)
    const lastTry = () => state().tries.at(-1)
    const verdict = (): Verdict | undefined => {
      if (status() === 'retrying') return 'retry'
      if (status() !== 'locked') return undefined
      const result = lastTry()?.result
      if (!result) return undefined
      if (result.status === 'pending') return 'pending'
      return result.correct ? 'correct' : 'incorrect'
    }
    const assessed = () => {
      const result = lastTry()?.result
      return result?.status === 'assessed' ? result : undefined
    }
    return (
      <ExerciseView
        exercise={exercise}
        seed={key === 'first' ? props.seed : `${props.seed}:second-round`}
        previousLayout={key === 'second' ? firstLayouts().get(exercise.id) : undefined}
        draft={state().draft}
        onDraft={(draft) => updateRound(key, (r) => setDraft(r, exercise.id, draft))}
        tries={state().tries}
        locked={status() === 'locked'}
        verdict={verdict()}
        solution={status() === 'locked' ? assessed()?.solution : null}
        items={verdict() ? (assessed()?.items ?? []) : []}
        passage={exercise.passage_id ? passages().get(exercise.passage_id) : undefined}
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
    const scored = scoredExercises(progress().first)
    return { correct: scored.length - failedExercises(progress().first).length, total: scored.length }
  }
  const pendingCount = () =>
    progress().first.exercises.filter(
      (exercise) => exerciseProgress(progress().first, exercise.id).tries.at(-1)?.result.status === 'pending',
    ).length
  const passages = () =>
    new Map(
      props.lesson.blocks.flatMap((block) =>
        block.type === 'passage' ? [[block.id, { id: block.id, title: block.title ?? null }] as const] : [],
      ),
    )

  return (
    <article class="lesson" lang={props.lesson.language}>
      <h1 class="lesson-title">{props.lesson.title}</h1>
      <For each={props.lesson.blocks}>
        {(block) => (
          <Switch>
            <Match when={block.type === 'explanation' && block}>
              {(explanation) => <Markdown source={explanation().markdown} />}
            </Match>
            <Match when={block.type === 'passage' && block}>
              {(passage) => (
                <section class="passage" id={`passage-${passage().id}`} aria-labelledby={`passage-${passage().id}-title`}>
                  <h2 id={`passage-${passage().id}-title`} class="passage-title">
                    {passage().title ?? t('passage.untitled')}
                  </h2>
                  <Markdown source={passage().markdown} />
                </section>
              )}
            </Match>
            <Match when={isRendered(block) && block}>
              {(exercise) => renderExercise('first', exercise())}
            </Match>
            <Match when={block.type !== 'explanation' && block.type !== 'passage' && !isRendered(block) && block}>
              {(exercise) => <UnsupportedExercise exercise={exercise() as UnrenderedExercise} />}
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
          <Show when={firstPassScore().total > 0}>
            <p>{t('lesson.firstPassScore', firstPassScore())}</p>
          </Show>
          <Show when={pendingCount() > 0}>
            <p>{t('lesson.pendingCount', { count: pendingCount() })}</p>
          </Show>
        </div>
      </Show>
    </article>
  )
}
