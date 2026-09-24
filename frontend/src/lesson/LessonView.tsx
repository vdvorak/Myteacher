import { For, Match, Switch } from 'solid-js'
import type {
  AssessmentResult,
  LessonPublic,
  MultipleChoiceAnswer,
} from '../generated/lesson'
import { Markdown } from './Markdown'
import { MultipleChoice } from './MultipleChoice'
import './lesson.css'

export interface LessonViewProps {
  lesson: LessonPublic
  seed: string
  assess: (exerciseId: string, answer: MultipleChoiceAnswer) => Promise<AssessmentResult>
}

export function LessonView(props: LessonViewProps) {
  return (
    <article class="lesson" lang={props.lesson.language}>
      <h1 class="lesson-title">{props.lesson.title}</h1>
      <For each={props.lesson.blocks}>
        {(block) => (
          <Switch>
            <Match when={block.type === 'explanation' && block}>
              {(explanation) => <Markdown source={explanation().markdown} />}
            </Match>
            <Match when={block.type === 'multiple_choice' && block}>
              {(exercise) => (
                <MultipleChoice
                  exercise={exercise()}
                  seed={props.seed}
                  assess={(answer) => props.assess(exercise().id, answer)}
                />
              )}
            </Match>
          </Switch>
        )}
      </For>
    </article>
  )
}
