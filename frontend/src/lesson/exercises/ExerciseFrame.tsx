import { createUniqueId, Show, type JSX, type ParentProps } from 'solid-js'
import { useI18n } from '../../i18n/i18n'
import { Markdown } from '../Markdown'
import '../exercise.css'

export type Verdict = 'correct' | 'incorrect' | 'retry'

export interface ExerciseFrameProps {
  prompt: string
  hint?: string | null
  /** Show the hint before the first try (a second-round short answer). */
  hintUpFront?: boolean
  verdict?: Verdict
  /** The canonical solution, rendered once the exercise is locked. */
  solution?: JSX.Element
  explanation?: string | null
  /** Present when the student confirms this exercise on its own (immediate feedback). */
  onConfirm?: () => void
  canConfirm: boolean
  locked: boolean
  checking: boolean
  failed: boolean
}

/** What every exercise shares: prompt, confirm, verdict, hint and solution around its body. */
export function ExerciseFrame(props: ParentProps<ExerciseFrameProps>) {
  const { t } = useI18n()
  const promptId = createUniqueId()
  const hintId = createUniqueId()
  const solutionHeading = createUniqueId()
  const showHint = () =>
    props.hint && (props.verdict === 'retry' || (props.hintUpFront && !props.locked))

  return (
    <fieldset class="exercise" aria-labelledby={promptId}>
      <div id={promptId} class="exercise-prompt">
        <Markdown source={props.prompt} />
      </div>
      {props.children}
      <Show when={props.onConfirm && !props.locked}>
        <button
          type="button"
          disabled={!props.canConfirm || props.checking}
          onClick={() => props.onConfirm?.()}
        >
          {props.checking ? t('exercise.checking') : t('exercise.confirm')}
        </button>
      </Show>
      <Show when={props.failed}>
        <p class="exercise-error" role="alert">
          {t('exercise.assessFailed')}
        </p>
      </Show>
      <Show when={props.verdict || showHint()}>
        <div class="exercise-result" data-verdict={props.verdict}>
          <Show when={props.verdict}>
            {(verdict) => (
              <p role="status" class="exercise-verdict">
                {verdict() === 'correct'
                  ? t('exercise.correct')
                  : verdict() === 'retry'
                    ? t('exercise.tryAgain')
                    : t('exercise.incorrect')}
              </p>
            )}
          </Show>
          <Show when={showHint() && props.hint}>
            {(hint) => (
              <aside role="note" aria-labelledby={hintId} class="exercise-hint">
                <h3 id={hintId}>{t('exercise.hint')}</h3>
                <Markdown source={hint()} />
              </aside>
            )}
          </Show>
          <Show when={props.locked && props.solution}>
            <section aria-labelledby={solutionHeading} class="exercise-solution">
              <h3 id={solutionHeading}>{t('exercise.solution')}</h3>
              {props.solution}
              <Show when={props.explanation}>
                {(explanation) => <Markdown source={explanation()} />}
              </Show>
            </section>
          </Show>
        </div>
      </Show>
    </fieldset>
  )
}
