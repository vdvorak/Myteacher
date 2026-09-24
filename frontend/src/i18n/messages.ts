export const locales = ['cs', 'en'] as const
export type Locale = (typeof locales)[number]

const en = {
  'app.title': 'Myteacher',
  'language.label': 'Language',
  'preview.heading': 'Lesson preview',
  'preview.loading': 'Loading the lesson…',
  'preview.loadFailed': 'The lesson could not be loaded.',
  'preview.notFound': 'No lesson to preview here.',
  'preview.openFixture': 'Open the sample lesson',
  'exercise.confirm': 'Confirm',
  'exercise.checking': 'Checking…',
  'exercise.correct': 'Correct',
  'exercise.incorrect': 'Not quite',
  'exercise.solution': 'Solution',
  'exercise.assessFailed': 'The answer could not be checked. Try again.',
  'exercise.tryAgain': 'Not quite. Try once more.',
  'exercise.hint': 'Hint',
  'lesson.submit': 'Submit answers',
  'lesson.unanswered': '{count} unanswered',
  'lesson.secondRoundIntro': 'Some answers were wrong. They come back once more, in a new order.',
  'lesson.startSecondRound': 'Start the second round',
  'lesson.secondRound': 'Second round',
  'lesson.secondRoundFailed': 'The second round could not be loaded. Try again.',
  'lesson.finished': 'Lesson finished',
  'lesson.firstPassScore': '{correct} of {total} right in the first pass.',
}

export type MessageKey = keyof typeof en

const cs: Record<MessageKey, string> = {
  'app.title': 'Myteacher',
  'language.label': 'Jazyk',
  'preview.heading': 'Náhled lekce',
  'preview.loading': 'Načítám lekci…',
  'preview.loadFailed': 'Lekci se nepodařilo načíst.',
  'preview.notFound': 'Tady není žádná lekce k náhledu.',
  'preview.openFixture': 'Otevřít ukázkovou lekci',
  'exercise.confirm': 'Potvrdit',
  'exercise.checking': 'Kontroluji…',
  'exercise.correct': 'Správně',
  'exercise.incorrect': 'Ne tak docela',
  'exercise.solution': 'Řešení',
  'exercise.assessFailed': 'Odpověď se nepodařilo zkontrolovat. Zkuste to znovu.',
  'exercise.tryAgain': 'Ne tak docela. Zkuste to ještě jednou.',
  'exercise.hint': 'Nápověda',
  'lesson.submit': 'Odevzdat odpovědi',
  'lesson.unanswered': 'Nezodpovězeno: {count}',
  'lesson.secondRoundIntro': 'Některé odpovědi byly špatně. Vrátí se ještě jednou, v novém pořadí.',
  'lesson.startSecondRound': 'Začít druhé kolo',
  'lesson.secondRound': 'Druhé kolo',
  'lesson.secondRoundFailed': 'Druhé kolo se nepodařilo načíst. Zkuste to znovu.',
  'lesson.finished': 'Lekce dokončena',
  'lesson.firstPassScore': 'V prvním průchodu správně {correct} z {total}.',
}

export const messages: Record<Locale, Record<MessageKey, string>> = { cs, en }

export const localeNames: Record<Locale, string> = { cs: 'Čeština', en: 'English' }
