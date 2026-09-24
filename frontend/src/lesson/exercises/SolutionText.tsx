import { Match, Switch } from 'solid-js'
import type { ExerciseSolution, ExercisePublic } from '../schema'
import { ClozeSolutionText } from './Cloze'
import { optionText } from './MultipleChoice'

/** The canonical answer of an exercise as text, for its solution section and the answer key. */
export function SolutionText(props: { exercise: ExercisePublic | undefined; solution: ExerciseSolution }) {
  return (
    <Switch>
      <Match when={props.solution.type === 'multiple_choice' && props.solution}>
        {(solution) => (
          <strong>
            {props.exercise?.type === 'multiple_choice'
              ? optionText(props.exercise, solution().option_id)
              : solution().option_id}
          </strong>
        )}
      </Match>
      <Match when={props.solution.type === 'short_answer' && props.solution}>
        {(solution) => <strong>{solution().answer}</strong>}
      </Match>
      <Match when={props.solution.type === 'cloze' && props.exercise?.type === 'cloze' && props.solution}>
        {(solution) => (
          <ClozeSolutionText
            exercise={props.exercise as Extract<ExercisePublic, { type: 'cloze' }>}
            solution={solution()}
          />
        )}
      </Match>
    </Switch>
  )
}
