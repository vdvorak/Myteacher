import { For, Show } from 'solid-js'
import type {
  TokenOrderingAnswer,
  TokenOrderingExercisePublic,
  TokenOrderingSolution,
} from '../../generated/lesson'
import { useI18n } from '../../i18n/i18n'
import { reshuffle } from '../shuffle'
import { ExerciseFrame } from './ExerciseFrame'
import type { RenderedAnswer } from '../schema'
import { triedAlready, type ExerciseViewProps } from './types'

export function tokenLayout(exercise: TokenOrderingExercisePublic, seed: string, previous: string[] = []) {
  return reshuffle(
    exercise.tokens.map((token) => token.id),
    `${seed}:${exercise.id}`,
    previous,
  )
}

export function TokenOrderingSolutionText(props: { solution: TokenOrderingSolution }) {
  return (
    <p>
      <strong>{props.solution.tokens.join(' ')}</strong>
    </p>
  )
}

/** Put tokens in order: tap them in sequence; tap a placed token or Undo to take it back. */
export function TokenOrdering(props: ExerciseViewProps<TokenOrderingExercisePublic, TokenOrderingAnswer>) {
  const { t } = useI18n()
  const order = () => props.draft?.order ?? []
  const text = (id: string) => props.exercise.tokens.find((token) => token.id === id)?.text ?? id
  const pool = () =>
    tokenLayout(props.exercise, props.seed, props.previousLayout).filter((id) => !order().includes(id))
  const setOrder = (next: string[]) => props.onDraft({ type: 'token_ordering', order: next })
  const disabled = () => props.locked || props.checking
  const complete = () => order().length === props.exercise.tokens.length
  // Tokens with the same text are interchangeable, as the backend assesses them.
  const asTexts = (answer: RenderedAnswer) =>
    answer.type === 'token_ordering' ? JSON.stringify(answer.order.map(text)) : JSON.stringify(answer)
  // The marks describe the last try's positions, so they show only while that order stands.
  const marksApply = () => {
    const last = props.tries.at(-1)?.answer
    return props.locked || (last?.type === 'token_ordering' && JSON.stringify(last.order) === JSON.stringify(order()))
  }
  const tokenState = (id: string) => {
    if (!props.verdict || !marksApply()) return undefined
    const item = props.items.find((entry) => entry.id === id)
    return item ? (item.correct ? 'correct' : 'incorrect') : undefined
  }

  return (
    <ExerciseFrame
      prompt={props.exercise.prompt}
      hint={props.exercise.hint}
      verdict={props.verdict}
      solution={props.solution?.type === 'token_ordering' && <TokenOrderingSolutionText solution={props.solution} />}
      explanation={props.solution?.explanation}
      onConfirm={props.onConfirm}
      canConfirm={complete() && !triedAlready(props.tries, props.draft, asTexts)}
      locked={props.locked}
      checking={props.checking}
      failed={props.failed}
    >
      <div class="ordering-sentence" role="group" aria-label={t('ordering.sentence')}>
        <For each={order()} fallback={<span class="ordering-empty">{t('ordering.empty')}</span>}>
          {(id) => (
            <button
              type="button"
              class="ordering-token"
              data-state={tokenState(id)}
              disabled={disabled()}
              onClick={() => setOrder(order().filter((placed) => placed !== id))}
            >
              {text(id)}
            </button>
          )}
        </For>
      </div>
      <div class="ordering-pool" role="group" aria-label={t('ordering.pool')}>
        <For each={pool()}>
          {(id) => (
            <button
              type="button"
              class="ordering-token"
              disabled={disabled()}
              onClick={() => setOrder([...order(), id])}
            >
              {text(id)}
            </button>
          )}
        </For>
        <Show when={!props.locked}>
          <button
            type="button"
            class="ordering-undo"
            disabled={disabled() || order().length === 0}
            onClick={() => setOrder(order().slice(0, -1))}
          >
            {t('ordering.undo')}
          </button>
        </Show>
      </div>
    </ExerciseFrame>
  )
}
