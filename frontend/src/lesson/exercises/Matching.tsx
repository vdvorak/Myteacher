import { createSignal, For } from 'solid-js'
import type { MatchingAnswer, MatchingExercisePublic, MatchingSolution } from '../../generated/lesson'
import { useI18n } from '../../i18n/i18n'
import { reshuffle } from '../shuffle'
import { ExerciseFrame } from './ExerciseFrame'
import { triedAlready, type ExerciseViewProps } from './types'

export function matchingLayout(exercise: MatchingExercisePublic, seed: string, previous: string[] = []) {
  return reshuffle(
    exercise.right.map((item) => item.id),
    `${seed}:${exercise.id}`,
    previous,
  )
}

/** Each left item with the right item it belongs to. */
export function MatchingSolutionText(props: { exercise: MatchingExercisePublic; solution: MatchingSolution }) {
  const text = (items: MatchingExercisePublic['left'], id: string) => items.find((item) => item.id === id)?.text ?? id
  return (
    <ul class="matching-solution">
      <For each={props.solution.pairs}>
        {(pair) => (
          <li>
            {text(props.exercise.left, pair.left_id)} → <strong>{text(props.exercise.right, pair.right_id)}</strong>
          </li>
        )}
      </For>
    </ul>
  )
}

/** Pair items across two columns: tap a left item, then a right one; tap a pair to undo it. */
export function Matching(props: ExerciseViewProps<MatchingExercisePublic, MatchingAnswer>) {
  const { t } = useI18n()
  const [picked, setPicked] = createSignal<string>()
  const pairs = () => props.draft?.pairs ?? {}
  const rights = () => {
    const byId = new Map(props.exercise.right.map((item) => [item.id, item]))
    const order = props.layout ?? matchingLayout(props.exercise, props.seed, props.previousLayout)
    return order.map((id) => byId.get(id)!)
  }
  const rightText = (id: string) => props.exercise.right.find((item) => item.id === id)?.text ?? id
  const leftOf = (rightId: string) => Object.keys(pairs()).find((left) => pairs()[left] === rightId)
  const leftText = (id: string) => props.exercise.left.find((item) => item.id === id)?.text ?? id
  const disabled = () => props.locked || props.checking
  const complete = () => props.exercise.left.every((item) => pairs()[item.id] !== undefined)
  const setPairs = (next: Record<string, string>) => props.onDraft({ type: 'matching', pairs: next })
  const without = (left: string) => Object.fromEntries(Object.entries(pairs()).filter(([id]) => id !== left))

  const tapLeft = (id: string) => {
    if (pairs()[id] !== undefined) {
      setPairs(without(id))
      setPicked(undefined)
    } else {
      setPicked(picked() === id ? undefined : id)
    }
  }
  const tapRight = (id: string) => {
    const left = picked()
    if (left !== undefined) {
      const owner = leftOf(id)
      setPairs({ ...(owner ? without(owner) : pairs()), [left]: id })
      setPicked(undefined)
    } else {
      const owner = leftOf(id)
      if (owner) setPairs(without(owner))
    }
  }
  const leftState = (id: string) => {
    if (!props.verdict) return undefined
    const item = props.items.find((entry) => entry.id === id)
    return item ? (item.correct ? 'correct' : 'incorrect') : undefined
  }

  return (
    <ExerciseFrame
      prompt={props.exercise.prompt}
      passage={props.passage}
      hint={props.exercise.hint}
      verdict={props.verdict}
      solution={
        props.solution?.type === 'matching' && (
          <MatchingSolutionText exercise={props.exercise} solution={props.solution} />
        )
      }
      explanation={props.solution?.explanation}
      onConfirm={props.onConfirm}
      canConfirm={complete() && !triedAlready(props.tries, props.draft)}
      locked={props.locked}
      checking={props.checking}
      failed={props.failed}
    >
      <div class="matching">
        <div class="matching-column" role="group" aria-label={t('matching.left')}>
          <For each={props.exercise.left}>
            {(item) => (
              <button
                type="button"
                class="matching-item"
                data-state={leftState(item.id)}
                aria-pressed={picked() === item.id}
                aria-label={`${item.text} → ${pairs()[item.id] ? rightText(pairs()[item.id]) : t('matching.unpaired')}`}
                disabled={disabled()}
                onClick={() => tapLeft(item.id)}
              >
                <span>{item.text}</span>
                <span class="matching-partner">{pairs()[item.id] ? rightText(pairs()[item.id]) : '…'}</span>
              </button>
            )}
          </For>
        </div>
        <div class="matching-column" role="group" aria-label={t('matching.right')}>
          <For each={rights()}>
            {(item) => (
              <button
                type="button"
                class="matching-item"
                data-paired={leftOf(item.id) !== undefined}
                aria-label={`${item.text} → ${leftOf(item.id) ? leftText(leftOf(item.id)!) : t('matching.unpaired')}`}
                disabled={disabled()}
                onClick={() => tapRight(item.id)}
              >
                {item.text}
              </button>
            )}
          </For>
        </div>
      </div>
    </ExerciseFrame>
  )
}
