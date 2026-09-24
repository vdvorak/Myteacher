import { createSignal, For, Match, Show, Switch } from 'solid-js'
import type { ClozeAnswer, ClozeExercisePublic, ClozeSolution } from '../../generated/lesson'
import { useI18n } from '../../i18n/i18n'
import { seededShuffle } from '../shuffle'
import { ExerciseFrame } from './ExerciseFrame'
import { triedAlready, type ExerciseViewProps } from './types'

/** The sentence with every gap filled by its canonical answer. */
export function ClozeSolutionText(props: { exercise: ClozeExercisePublic; solution: ClozeSolution }) {
  const answer = (id: string) => props.solution.gaps.find((gap) => gap.id === id)?.answer ?? '…'
  return (
    <p class="cloze-text">
      <For each={props.exercise.segments}>
        {(segment) => (segment.kind === 'gap' ? <strong>{answer(segment.id)}</strong> : segment.text)}
      </For>
    </p>
  )
}

/**
 * A text with gaps. Without a word bank the student types into each gap; with one the student
 * taps a word and then a gap to place it, and taps a filled gap to take the word back.
 */
export function Cloze(props: ExerciseViewProps<ClozeExercisePublic, ClozeAnswer>) {
  const { t } = useI18n()
  const [picked, setPicked] = createSignal<number>()
  const gapIds = () => props.exercise.segments.flatMap((segment) => (segment.kind === 'gap' ? [segment.id] : []))
  const gapLabel = (id: string) => t('cloze.gap', { n: gapIds().indexOf(id) + 1 })
  const value = (id: string) => props.draft?.gaps[id] ?? ''
  const setGap = (id: string, word: string) =>
    props.onDraft({
      type: 'cloze',
      gaps: { ...Object.fromEntries(gapIds().map((gap) => [gap, value(gap)])), [id]: word },
    })
  const complete = () => gapIds().every((id) => value(id).trim() !== '')
  const disabled = () => props.locked || props.checking
  const gapState = (id: string) => {
    if (!props.verdict) return undefined
    const item = props.items.find((entry) => entry.id === id)
    return item ? (item.correct ? 'correct' : 'incorrect') : undefined
  }

  const bank = () =>
    props.exercise.word_bank ? seededShuffle(props.exercise.word_bank, `${props.seed}:${props.exercise.id}:bank`) : []
  /** Bank positions not yet placed in a gap (each placed word uses up one occurrence). */
  const available = () => {
    const placed = new Map<string, number>()
    for (const id of gapIds()) if (value(id)) placed.set(value(id), (placed.get(value(id)) ?? 0) + 1)
    return bank().flatMap((word, index) => {
      const uses = placed.get(word) ?? 0
      if (uses > 0) {
        placed.set(word, uses - 1)
        return []
      }
      return [index]
    })
  }
  const tapGap = (id: string) => {
    const index = picked()
    if (index !== undefined) {
      setGap(id, bank()[index])
      setPicked(undefined)
    } else if (value(id)) {
      setGap(id, '')
    }
  }

  return (
    <ExerciseFrame
      prompt={props.exercise.prompt}
      hint={props.exercise.hint}
      verdict={props.verdict}
      solution={
        props.solution?.type === 'cloze' && (
          <ClozeSolutionText exercise={props.exercise} solution={props.solution} />
        )
      }
      explanation={props.solution?.explanation}
      onConfirm={props.onConfirm}
      canConfirm={complete() && !triedAlready(props.tries, props.draft)}
      locked={props.locked}
      checking={props.checking}
      failed={props.failed}
    >
      <p class="cloze-text">
        <For each={props.exercise.segments}>
          {(segment) => (
            <Switch fallback={segment.kind === 'text' && segment.text}>
              <Match when={segment.kind === 'gap' && !props.exercise.word_bank && segment}>
                {(gap) => (
                  <input
                    class="cloze-gap-input"
                    type="text"
                    aria-label={gapLabel(gap().id)}
                    value={value(gap().id)}
                    data-state={gapState(gap().id)}
                    disabled={disabled()}
                    autocomplete="off"
                    autocapitalize="none"
                    spellcheck={false}
                    enterkeyhint="next"
                    size={Math.max(4, value(gap().id).length + 1)}
                    onInput={(event) => setGap(gap().id, event.currentTarget.value)}
                  />
                )}
              </Match>
              <Match when={segment.kind === 'gap' && props.exercise.word_bank && segment}>
                {(gap) => (
                  <button
                    type="button"
                    class="cloze-gap"
                    data-state={gapState(gap().id)}
                    aria-label={`${gapLabel(gap().id)}: ${value(gap().id) || t('cloze.empty')}`}
                    disabled={disabled()}
                    onClick={() => tapGap(gap().id)}
                  >
                    {value(gap().id) || ' '}
                  </button>
                )}
              </Match>
            </Switch>
          )}
        </For>
      </p>
      <Show when={props.exercise.word_bank}>
        <div class="cloze-bank" role="group" aria-label={t('cloze.bank')}>
          <For each={available()}>
            {(index) => (
              <button
                type="button"
                class="cloze-word"
                aria-pressed={picked() === index}
                disabled={disabled()}
                onClick={() => setPicked(picked() === index ? undefined : index)}
              >
                {bank()[index]}
              </button>
            )}
          </For>
        </div>
      </Show>
    </ExerciseFrame>
  )
}
