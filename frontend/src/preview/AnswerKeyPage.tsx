import { createUniqueId, For, Show } from 'solid-js'
import type { AnswerKey, LessonPublic } from '../generated/lesson'
import { useI18n } from '../i18n/i18n'
import { Markdown } from '../lesson/Markdown'
import { SolutionText } from '../lesson/exercises/SolutionText'
import type { ExercisePublic } from '../lesson/schema'

/** The canonical solutions of a lesson, printed on a page of their own after the lesson. `proposed`: the
 * exercises whose answers the assistant proposed, marked for the teacher to check. */
export function AnswerKeyPage(props: { lesson: LessonPublic; answerKey: AnswerKey; proposed?: string[] }) {
  const { t } = useI18n()
  const headingId = createUniqueId()
  const exercise = (id: string) =>
    props.lesson.blocks.find((block): block is ExercisePublic => block.type !== 'explanation' && block.id === id)

  // A translation may have no prompt; its source text tells the teacher which one it is.
  const sourceText = (id: string) => {
    const found = exercise(id)
    return found?.type === 'translation' ? found.source_text : undefined
  }

  return (
    <section class="answer-key" aria-labelledby={headingId}>
      <h2 id={headingId}>{t('answerKey.heading')}</h2>
      <ol class="answer-key-entries">
        <For each={props.answerKey.entries}>
          {(entry) => (
            <li class="answer-key-entry">
              <Show when={props.proposed?.includes(entry.exercise_id)}>
                <p class="answer-key-proposed">{t('answerKey.proposed')}</p>
              </Show>
              <Show when={exercise(entry.exercise_id)?.prompt}>
                {(prompt) => (
                  <div class="answer-key-prompt">
                    <Markdown source={prompt()} />
                  </div>
                )}
              </Show>
              <Show when={sourceText(entry.exercise_id)}>
                {(source) => <blockquote class="answer-key-source">{source()}</blockquote>}
              </Show>
              <Show
                when={entry.solution}
                fallback={
                  <Show when={entry.rubric} fallback={<p class="answer-key-missing">{t('answerKey.unavailable')}</p>}>
                    {(rubric) => (
                      <div class="answer-key-rubric">
                        <Show when={entry.model_answer}>
                          {(model) => (
                            <p>
                              {t('answerKey.modelAnswer')}: <strong>{model()}</strong>
                            </p>
                          )}
                        </Show>
                        <p>{t('answerKey.rubric')}</p>
                        <ul>
                          <For each={rubric().criteria}>
                            {(criterion) => (
                              <li>
                                <Markdown source={criterion.description} inline /> ({t('answerKey.points', { points: criterion.points ?? 1 })})
                              </li>
                            )}
                          </For>
                        </ul>
                      </div>
                    )}
                  </Show>
                }
              >
                {(solution) => (
                  <>
                    <div class="answer-key-answer">
                      <SolutionText exercise={exercise(entry.exercise_id)} solution={solution()} />
                    </div>
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
