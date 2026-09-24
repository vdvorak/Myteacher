import { createUniqueId, Show } from 'solid-js'
import type {
  FreeTextAnswer,
  FreeTextExercisePublic,
  TranslationAnswer,
  TranslationExercisePublic,
} from '../../generated/lesson'
import { useI18n } from '../../i18n/i18n'
import { ExerciseFrame } from './ExerciseFrame'
import type { ExerciseViewProps } from './types'

function languageName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

/**
 * Free text and translation: a text area with a length counter. The answer is sent once and
 * then awaits assessment against the exercise's rubric; nothing is scored here.
 */
export function OpenText(
  props: ExerciseViewProps<FreeTextExercisePublic | TranslationExercisePublic, FreeTextAnswer | TranslationAnswer>,
) {
  const { t, locale } = useI18n()
  const counterId = createUniqueId()
  const text = () => props.draft?.text ?? ''
  const withinLimits = () =>
    text().trim() !== '' &&
    text().length >= props.exercise.min_characters &&
    text().length <= props.exercise.max_characters
  const source = () => (props.exercise.type === 'translation' ? props.exercise : undefined)

  return (
    <ExerciseFrame
      prompt={props.exercise.prompt}
      passage={props.passage}
      hint={props.exercise.hint}
      // Open answers get no retry, so their hint is guidance up front, not a second chance.
      hintUpFront
      verdict={props.verdict}
      onConfirm={props.onConfirm}
      canConfirm={withinLimits()}
      locked={props.locked}
      checking={props.checking}
      failed={props.failed}
    >
      <Show when={source()}>
        {(translation) => (
          <div class="translation-source">
            <p class="translation-direction">
              {t('translation.direction', {
                source: languageName(translation().source_language, locale()),
                target: languageName(translation().target_language, locale()),
              })}
            </p>
            <blockquote lang={translation().source_language}>{translation().source_text}</blockquote>
          </div>
        )}
      </Show>
      <textarea
        class="exercise-textarea"
        aria-label={t('openText.label')}
        aria-describedby={counterId}
        lang={source()?.target_language}
        rows={props.exercise.max_characters > 300 ? 6 : 3}
        maxLength={props.exercise.max_characters}
        value={text()}
        disabled={props.locked || props.checking}
        onInput={(event) => props.onDraft({ type: props.exercise.type, text: event.currentTarget.value })}
      />
      <p id={counterId} class="exercise-counter">
        {t('openText.count', { count: text().length, max: props.exercise.max_characters })}
        <Show when={props.exercise.min_characters > 0}>
          {' · '}
          {t('openText.minimum', { min: props.exercise.min_characters })}
        </Show>
      </p>
    </ExerciseFrame>
  )
}
