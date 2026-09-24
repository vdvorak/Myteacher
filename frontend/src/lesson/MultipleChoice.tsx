import { createSignal, createUniqueId, For, Show } from 'solid-js'
import type {
  AssessmentResult,
  MultipleChoiceAnswer,
  MultipleChoiceExercisePublic,
} from '../generated/lesson'
import { useI18n } from '../i18n/i18n'
import { Markdown } from './Markdown'
import { seededShuffle } from './shuffle'
import './exercise.css'

export interface MultipleChoiceProps {
  exercise: MultipleChoiceExercisePublic
  /** The attempt's seed; the layout is derived from it, never stored pre-shuffled. */
  seed: string
  /** Assessment happens on the backend: the browser never holds the answer key. */
  assess: (answer: MultipleChoiceAnswer) => Promise<AssessmentResult>
}

export function MultipleChoice(props: MultipleChoiceProps) {
  const { t } = useI18n()
  const name = createUniqueId()
  const solutionHeading = createUniqueId()
  const promptId = createUniqueId()
  const options = () => seededShuffle(props.exercise.options, `${props.seed}:${props.exercise.id}`)
  const [selected, setSelected] = createSignal<string>()
  const [checking, setChecking] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  const [result, setResult] = createSignal<AssessmentResult>()

  const confirm = async () => {
    const optionId = selected()
    if (!optionId) return
    setChecking(true)
    setFailed(false)
    try {
      setResult(await props.assess({ type: 'multiple_choice', option_id: optionId }))
    } catch {
      setFailed(true)
    } finally {
      setChecking(false)
    }
  }

  const optionState = (optionId: string) => {
    const assessed = result()
    if (!assessed) return undefined
    if (optionId === assessed.solution.option_id) return 'correct'
    if (optionId === selected()) return 'incorrect'
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
                checked={selected() === option.id}
                disabled={result() !== undefined || checking()}
                onChange={() => setSelected(option.id)}
              />
              <span>{option.text}</span>
            </label>
          )}
        </For>
      </div>
      <Show when={!result()}>
        <button
          type="button"
          disabled={selected() === undefined || checking()}
          onClick={confirm}
        >
          {checking() ? t('exercise.checking') : t('exercise.confirm')}
        </button>
      </Show>
      <Show when={failed()}>
        <p class="exercise-error" role="alert">
          {t('exercise.assessFailed')}
        </p>
      </Show>
      <Show when={result()}>
        {(assessed) => (
          <div class="exercise-result" data-correct={assessed().correct}>
            <p role="status" class="exercise-verdict">
              {assessed().correct ? t('exercise.correct') : t('exercise.incorrect')}
            </p>
            <section aria-labelledby={solutionHeading} class="exercise-solution">
              <h3 id={solutionHeading}>{t('exercise.solution')}</h3>
              <p>{optionText(assessed().solution.option_id)}</p>
              <Show when={assessed().solution.explanation}>
                {(explanation) => <Markdown source={explanation()} />}
              </Show>
            </section>
          </div>
        )}
      </Show>
    </fieldset>
  )
}
