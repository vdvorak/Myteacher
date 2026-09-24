import { Match, Switch } from 'solid-js'
import type { ClozeAnswer, MultipleChoiceAnswer, ShortAnswerAnswer } from '../../generated/lesson'
import type { RenderedAnswer, RenderedExercise } from '../schema'
import { Cloze } from './Cloze'
import { MultipleChoice } from './MultipleChoice'
import { ShortAnswer } from './ShortAnswer'
import type { ExerciseViewProps } from './types'

export interface AnyExerciseViewProps extends ExerciseViewProps<RenderedExercise, RenderedAnswer> {
  previousLayout?: string[]
}

/** Renders any exercise type this phase supports, narrowing the shared props to its type. */
export function ExerciseView(props: AnyExerciseViewProps) {
  const draftOf = <A extends RenderedAnswer>(type: A['type']) =>
    props.draft?.type === type ? (props.draft as A) : undefined
  return (
    <Switch>
      <Match when={props.exercise.type === 'multiple_choice' && props.exercise}>
        {(exercise) => (
          <MultipleChoice {...props} exercise={exercise()} draft={draftOf<MultipleChoiceAnswer>('multiple_choice')} />
        )}
      </Match>
      <Match when={props.exercise.type === 'short_answer' && props.exercise}>
        {(exercise) => (
          <ShortAnswer {...props} exercise={exercise()} draft={draftOf<ShortAnswerAnswer>('short_answer')} />
        )}
      </Match>
      <Match when={props.exercise.type === 'cloze' && props.exercise}>
        {(exercise) => <Cloze {...props} exercise={exercise()} draft={draftOf<ClozeAnswer>('cloze')} />}
      </Match>
    </Switch>
  )
}
