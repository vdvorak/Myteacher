"""Comparing typed answers under an exercise's tolerance rules."""

import unicodedata

from myteacher.lesson.schema import ToleranceRules

_TILDE = "̃"
_CARON = "̌"
_RING = "̊"

# Marks that make a letter of its own in a language, so ignoring diacritics keeps them:
# (base letter, combining mark), with None for any base letter. Keyed by the primary language
# subtag; a language not listed here keeps no mark.
_DISTINCT_LETTERS: dict[str, set[tuple[str | None, str]]] = {
    # ñ: año is not ano.
    "es": {("n", _TILDE)},
    # The háček (č ď ě ň ř š ť ž) and the kroužek (ů): řeka is not reka. The acute is ignored.
    "cs": {(None, _CARON), ("u", _RING)},
}


def _strip_diacritics(text: str, language: str) -> str:
    distinct = _DISTINCT_LETTERS.get(language.split("-")[0], set())
    kept = []
    base = ""
    for char in unicodedata.normalize("NFD", text):
        if not unicodedata.combining(char):
            base = char.lower()
        elif (base, char) not in distinct and (None, char) not in distinct:
            continue
        kept.append(char)
    return "".join(kept)


def normalise(text: str, rules: ToleranceRules, language: str) -> str:
    text = unicodedata.normalize("NFC", text).strip()
    if rules.ignore_punctuation:
        text = "".join(" " if unicodedata.category(c).startswith("P") else c for c in text)
    if rules.normalise_whitespace or rules.ignore_punctuation:
        text = " ".join(text.split())
    if rules.ignore_diacritics:
        text = _strip_diacritics(text, language)
    if rules.ignore_case:
        text = text.casefold()
    return unicodedata.normalize("NFC", text)


def matches(answer: str, accepted: list[str], rules: ToleranceRules, language: str) -> bool:
    """Whether a typed answer is one of the accepted ones, in the lesson's `language`."""
    given = normalise(answer, rules, language)
    return given != "" and any(given == normalise(option, rules, language) for option in accepted)
