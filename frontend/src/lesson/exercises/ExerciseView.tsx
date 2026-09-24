import { Match, Switch } from 'solid-js'
import type {
  ClozeAnswer,
  MatchingAnswer,
  MultipleChoiceAnswer,
  ShortAnswerAnswer,
  TokenOrderingAnswer,
} from '../../generated/lesson'
import type { RenderedAnswer, RenderedExercise } from '../schema'
import { Cloze } from './Cloze'
import { Matching, matchingLayout } from './Matching'
import { layoutOf, MultipleChoice } from './MultipleChoice'
import { ShortAnswer } from './ShortAnswer'
import { TokenOrdering, tokenLayout } from './TokenOrdering'
import type { ExerciseViewProps } from './types'

/** The seeded order of an exercise's shuffled items, for types that shuffle. */
export function exerciseLayout(exercise: RenderedExercise, seed: string): string[] | undefined {
  switch (exercise.type) {
    case 'multiple_choice':
      return layoutOf(exercise, seed)
    case 'matching':
      return matchingLayout(exercise, seed)
    case 'token_ordering':
      return tokenLayout(exercise, seed)
    default:
      return undefined
  }
}

/** Renders any exercise type this phase supports, narrowing the shared props to its type. */
export function ExerciseView(props: ExerciseViewProps<RenderedExercise, RenderedAnswer>) {
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
      <Match when={props.exercise.type === 'matching' && props.exercise}>
        {(exercise) => <Matching {...props} exercise={exercise()} draft={draftOf<MatchingAnswer>('matching')} />}
      </Match>
      <Match when={props.exercise.type === 'token_ordering' && props.exercise}>
        {(exercise) => (
          <TokenOrdering {...props} exercise={exercise()} draft={draftOf<TokenOrderingAnswer>('token_ordering')} />
        )}
      </Match>
    </Switch>
  )
}
