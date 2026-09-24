import { createUniqueId, For, Show } from 'solid-js'
import type { AnswerKey, LessonPublic } from '../generated/lesson'
import { useI18n } from '../i18n/i18n'
import { Markdown } from '../lesson/Markdown'
import type { ExercisePublic } from '../lesson/schema'

/** The canonical solutions of a lesson, printed on a page of their own after the lesson. */
export function AnswerKeyPage(props: { lesson: LessonPublic; answerKey: AnswerKey }) {
  const { t } = useI18n()
  const headingId = createUniqueId()
  const exercise = (id: string) =>
    props.lesson.blocks.find((block): block is ExercisePublic => block.type !== 'explanation' && block.id === id)
  const answerText = (id: string, optionId: string) => {
    const found = exercise(id)
    return found?.type === 'multiple_choice'
      ? (found.options.find((option) => option.id === optionId)?.text ?? optionId)
      : optionId
  }

  return (
    <section class="answer-key" aria-labelledby={headingId}>
      <h2 id={headingId}>{t('answerKey.heading')}</h2>
      <ol class="answer-key-entries">
        <For each={props.answerKey.entries}>
          {(entry) => (
            <li class="answer-key-entry">
              <Show when={exercise(entry.exercise_id)?.prompt}>
                {(prompt) => (
                  <div class="answer-key-prompt">
                    <Markdown source={prompt()} />
                  </div>
                )}
              </Show>
              <Show
                when={entry.solution}
                fallback={<p class="answer-key-missing">{t('answerKey.unavailable')}</p>}
              >
                {(solution) => (
                  <>
                    <p class="answer-key-answer">
                      <strong>{answerText(entry.exercise_id, solution().option_id)}</strong>
                    </p>
                    <Show when={solution().explanation}>
                      {(explanation) => <Markdown source={explanation()} />}
                    </Show>
                  </>
                )}
              </Show>
            </li>
          )}
        </For>
      </ol>
    </section>
  )
}
