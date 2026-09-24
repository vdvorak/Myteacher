import type { ShortAnswerAnswer, ShortAnswerExercisePublic } from '../../generated/lesson'
import { useI18n } from '../../i18n/i18n'
import { ExerciseFrame } from './ExerciseFrame'
import { triedAlready, type ExerciseViewProps } from './types'

export function ShortAnswer(props: ExerciseViewProps<ShortAnswerExercisePublic, ShortAnswerAnswer>) {
  const { t } = useI18n()
  const text = () => props.draft?.text ?? ''
  const canConfirm = () => text().trim() !== '' && !triedAlready(props.tries, props.draft)
  const state = () =>
    props.verdict === 'correct' ? 'correct' : props.verdict ? 'incorrect' : undefined

  return (
    <ExerciseFrame
      prompt={props.exercise.prompt}
      hint={props.exercise.hint}
      hintUpFront={props.exercise.show_hint}
      verdict={props.verdict}
      solution={props.solution?.type === 'short_answer' && <p>{props.solution.answer}</p>}
      explanation={props.solution?.explanation}
      onConfirm={props.onConfirm}
      canConfirm={canConfirm()}
      locked={props.locked}
      checking={props.checking}
      failed={props.failed}
    >
      <input
        class="exercise-text-input"
        type="text"
        aria-label={t('shortAnswer.label')}
        value={text()}
        data-state={state()}
        disabled={props.locked || props.checking}
        autocomplete="off"
        autocapitalize="none"
        spellcheck={false}
        enterkeyhint="done"
        onInput={(event) => props.onDraft({ type: 'short_answer', text: event.currentTarget.value })}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && canConfirm() && !props.checking) props.onConfirm?.()
        }}
      />
    </ExerciseFrame>
  )
}
