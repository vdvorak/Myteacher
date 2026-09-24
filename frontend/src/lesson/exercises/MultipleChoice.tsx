import { createUniqueId, For } from 'solid-js'
import type { MultipleChoiceAnswer, MultipleChoiceExercisePublic } from '../../generated/lesson'
import { reshuffle } from '../shuffle'
import { ExerciseFrame } from './ExerciseFrame'
import type { ExerciseViewProps } from './types'

export function layoutOf(exercise: MultipleChoiceExercisePublic, seed: string, previous: string[] = []) {
  return reshuffle(
    exercise.options.map((option) => option.id),
    `${seed}:${exercise.id}`,
    previous,
  )
}

export function optionText(exercise: MultipleChoiceExercisePublic, optionId: string): string {
  return exercise.options.find((option) => option.id === optionId)?.text ?? optionId
}

export function MultipleChoice(props: ExerciseViewProps<MultipleChoiceExercisePublic, MultipleChoiceAnswer>) {
  const name = createUniqueId()
  const selected = () => props.draft?.option_id
  // Options already tried and found wrong cannot be picked again.
  const tried = () =>
    props.tries.flatMap((attempt) =>
      attempt.answer.type === 'multiple_choice' && !attempt.result.correct ? [attempt.answer.option_id] : [],
    )
  const options = () => {
    const byId = new Map(props.exercise.options.map((option) => [option.id, option]))
    return layoutOf(props.exercise, props.seed, props.previousLayout).map((id) => byId.get(id)!)
  }
  const solutionId = () => (props.solution?.type === 'multiple_choice' ? props.solution.option_id : undefined)
  const optionState = (optionId: string) => {
    if (optionId === solutionId()) return 'correct'
    if (tried().includes(optionId)) return 'incorrect'
    if (props.verdict === 'incorrect' && optionId === selected()) return 'incorrect'
    return undefined
  }

  return (
    <ExerciseFrame
      prompt={props.exercise.prompt}
      hint={props.exercise.hint}
      verdict={props.verdict}
      solution={solutionId() && <p>{optionText(props.exercise, solutionId()!)}</p>}
      explanation={props.solution?.explanation}
      onConfirm={props.onConfirm}
      canConfirm={selected() !== undefined && !tried().includes(selected()!)}
      locked={props.locked}
      checking={props.checking}
      failed={props.failed}
    >
      <div class="exercise-options">
        <For each={options()}>
          {(option) => (
            <label class="exercise-option" data-state={optionState(option.id)}>
              <input
                type="radio"
                name={name}
                value={option.id}
                checked={selected() === option.id}
                disabled={props.locked || props.checking || tried().includes(option.id)}
                onChange={() => props.onDraft({ type: 'multiple_choice', option_id: option.id })}
              />
              <span>{option.text}</span>
            </label>
          )}
        </For>
      </div>
    </ExerciseFrame>
  )
}
