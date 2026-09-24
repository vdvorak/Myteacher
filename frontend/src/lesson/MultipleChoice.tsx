import { createUniqueId, For, Show } from 'solid-js'
import type { MultipleChoiceExercisePublic, MultipleChoiceSolution } from '../generated/lesson'
import { useI18n } from '../i18n/i18n'
import { Markdown } from './Markdown'
import { reshuffle } from './shuffle'
import './exercise.css'

export type Verdict = 'correct' | 'incorrect' | 'retry'

export interface MultipleChoiceProps {
  exercise: MultipleChoiceExercisePublic
  /** The layout is derived from the seed, never stored pre-shuffled. */
  seed: string
  /** Option ids in the order the student saw them before; a repeat never looks the same. */
  previousLayout?: string[]
  selected: string | undefined
  onSelect: (optionId: string) => void
  locked: boolean
  /** Options already tried and found wrong; they cannot be picked again. */
  triedOptions?: string[]
  verdict?: Verdict
  solution?: MultipleChoiceSolution | null
  /** Present when the student can confirm this exercise on its own (immediate feedback). */
  onConfirm?: () => void
  checking?: boolean
  failed?: boolean
}

export function layoutOf(exercise: MultipleChoiceExercisePublic, seed: string, previous: string[] = []) {
  return reshuffle(
    exercise.options.map((option) => option.id),
    `${seed}:${exercise.id}`,
    previous,
  )
}

/** One multiple-choice exercise. Controlled: the lesson player owns answers and assessments. */
export function MultipleChoice(props: MultipleChoiceProps) {
  const { t } = useI18n()
  const name = createUniqueId()
  const promptId = createUniqueId()
  const hintId = createUniqueId()
  const solutionHeading = createUniqueId()
  const options = () => {
    const byId = new Map(props.exercise.options.map((option) => [option.id, option]))
    return layoutOf(props.exercise, props.seed, props.previousLayout).map((id) => byId.get(id)!)
  }
  const optionState = (optionId: string) => {
    if (props.solution && optionId === props.solution.option_id) return 'correct'
    if (props.triedOptions?.includes(optionId)) return 'incorrect'
    if (props.verdict === 'incorrect' && optionId === props.selected) return 'incorrect'
    return undefined
  }
  const optionText = (optionId: string) =>
    props.exercise.options.find((option) => option.id === optionId)?.text ?? optionId

  return (
    <fieldset class="exercise" aria-labelledby={promptId}>
      <div id={promptId} class="exercise-prompt">
        <Markdown source={props.exercise.prompt} />
      </div>
      <div class="exercise-options">
        <For each={options()}>
          {(option) => (
            <label class="exercise-option" data-state={optionState(option.id)}>
              <input
                type="radio"
                name={name}
                value={option.id}
                checked={props.selected === option.id}
                disabled={props.locked || props.checking || props.triedOptions?.includes(option.id)}
                onChange={() => props.onSelect(option.id)}
              />
              <span>{option.text}</span>
            </label>
          )}
        </For>
      </div>
      <Show when={props.onConfirm && !props.locked}>
        <button
          type="button"
          disabled={
            props.selected === undefined ||
            props.checking ||
            props.triedOptions?.includes(props.selected)
          }
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
      <Show when={props.verdict}>
        {(verdict) => (
          <div class="exercise-result" data-verdict={verdict()}>
            <p role="status" class="exercise-verdict">
              {verdict() === 'correct'
                ? t('exercise.correct')
                : verdict() === 'retry'
                  ? t('exercise.tryAgain')
                  : t('exercise.incorrect')}
            </p>
            <Show when={verdict() === 'retry' && props.exercise.hint}>
              {(hint) => (
                <aside role="note" aria-labelledby={hintId} class="exercise-hint">
                  <h3 id={hintId}>{t('exercise.hint')}</h3>
                  <Markdown source={hint()} />
                </aside>
              )}
            </Show>
            <Show when={props.solution}>
              {(solution) => (
                <section aria-labelledby={solutionHeading} class="exercise-solution">
                  <h3 id={solutionHeading}>{t('exercise.solution')}</h3>
                  <p>{optionText(solution().option_id)}</p>
                  <Show when={solution().explanation}>
                    {(explanation) => <Markdown source={explanation()} />}
                  </Show>
                </section>
              )}
            </Show>
          </div>
        )}
      </Show>
    </fieldset>
  )
}
