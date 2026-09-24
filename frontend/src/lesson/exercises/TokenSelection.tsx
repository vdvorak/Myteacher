import { For, Show } from 'solid-js'
import type {
  TokenSelectionAnswer,
  TokenSelectionExercisePublic,
  TokenSelectionSolution,
} from '../../generated/lesson'
import { useI18n } from '../../i18n/i18n'
import { ExerciseFrame } from './ExerciseFrame'
import { triedAlready, type ExerciseViewProps } from './types'

/** The item's text with the tokens to select in bold. */
export function TokenSelectionSolutionText(props: {
  exercise: TokenSelectionExercisePublic
  solution: TokenSelectionSolution
}) {
  return (
    <p class="selection-solution">
      <For each={props.exercise.tokens}>
        {(token, index) => (
          <>
            {props.solution.selected.includes(index()) ? <strong>{token.text}</strong> : token.text}
            {token.space_after ? ' ' : ''}
          </>
        )}
      </For>
    </p>
  )
}

/**
 * Select tokens in a text (letters, syllables or words): each token is a toggle large enough
 * for a finger. With a limit of one, tapping another token moves the selection.
 */
export function TokenSelection(props: ExerciseViewProps<TokenSelectionExercisePublic, TokenSelectionAnswer>) {
  const { t } = useI18n()
  const selected = () => (props.draft?.item_id === props.exercise.item_id ? props.draft.selected : [])
  const limit = () => props.exercise.max_selections
  const atLimit = () => limit() !== null && selected().length >= limit()!
  const setSelected = (next: number[]) =>
    props.onDraft({
      type: 'token_selection',
      item_id: props.exercise.item_id,
      selected: [...next].sort((a, b) => a - b),
    })
  const toggle = (index: number) => {
    if (selected().includes(index)) setSelected(selected().filter((i) => i !== index))
    else if (limit() === 1) setSelected([index])
    else if (!atLimit()) setSelected([...selected(), index])
  }
  // The marks describe the last try's selection, so they show only while it stands.
  const marksApply = () => {
    const last = props.tries.at(-1)?.answer
    return (
      props.locked ||
      (last?.type === 'token_selection' && JSON.stringify(last.selected) === JSON.stringify(selected()))
    )
  }
  const state = (index: number) => {
    if (!props.verdict || !marksApply()) return undefined
    const item = props.items.find((entry) => entry.id === String(index))
    return item ? (item.correct ? 'correct' : 'incorrect') : undefined
  }
  const solution = () =>
    props.solution?.type === 'token_selection' && props.solution.item_id === props.exercise.item_id
      ? props.solution
      : undefined

  return (
    <ExerciseFrame
      prompt={props.exercise.prompt}
      passage={props.passage}
      hint={props.exercise.hint}
      verdict={props.verdict}
      solution={solution() && <TokenSelectionSolutionText exercise={props.exercise} solution={solution()!} />}
      explanation={props.solution?.explanation}
      onConfirm={props.onConfirm}
      canConfirm={selected().length > 0 && !triedAlready(props.tries, props.draft)}
      locked={props.locked}
      checking={props.checking}
      failed={props.failed}
    >
      <div
        class="selection-text"
        data-granularity={props.exercise.granularity}
        role="group"
        aria-label={t('selection.tokens')}
      >
        <For each={props.exercise.tokens}>
          {(token, index) => (
            <>
              <button
                type="button"
                class="selection-token"
                aria-pressed={selected().includes(index())}
                data-state={state(index())}
                disabled={
                  props.locked || props.checking || (atLimit() && limit() !== 1 && !selected().includes(index()))
                }
                onClick={() => toggle(index())}
              >
                {token.text}
              </button>
              {token.space_after ? <span class="selection-space"> </span> : null}
            </>
          )}
        </For>
      </div>
      <Show when={limit() !== null && limit()! > 1}>
        <p class="exercise-counter">{t('selection.limit', { max: limit()! })}</p>
      </Show>
    </ExerciseFrame>
  )
}
