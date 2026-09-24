"""Comparing typed answers under an exercise's tolerance rules."""

import unicodedata

from myteacher.lesson.schema import ToleranceRules

_COMBINING_TILDE = "̃"


def _strip_diacritics(text: str) -> str:
    # ñ is a letter of its own in Spanish (año is not ano), so its tilde is kept.
    decomposed = unicodedata.normalize("NFD", text)
    kept = []
    for index, char in enumerate(decomposed):
        if unicodedata.combining(char):
            keeps_enye = char == _COMBINING_TILDE and index > 0 and decomposed[index - 1] in "nN"
            if not keeps_enye:
                continue
        kept.append(char)
    return "".join(kept)


def normalise(text: str, rules: ToleranceRules) -> str:
    text = unicodedata.normalize("NFC", text).strip()
    if rules.ignore_punctuation:
        text = "".join(" " if unicodedata.category(c).startswith("P") else c for c in text)
    if rules.normalise_whitespace or rules.ignore_punctuation:
        text = " ".join(text.split())
    if rules.ignore_diacritics:
        text = _strip_diacritics(text)
    if rules.ignore_case:
        text = text.casefold()
    return unicodedata.normalize("NFC", text)


def matches(answer: str, accepted: list[str], rules: ToleranceRules) -> bool:
    given = normalise(answer, rules)
    return given != "" and any(given == normalise(option, rules) for option in accepted)
