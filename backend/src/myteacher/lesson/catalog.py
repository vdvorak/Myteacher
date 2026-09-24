"""The component catalog: the exercise types this phase renders and assesses (ADR 0001).

The lesson schema knows more types than these; the others show as "not supported yet". The
catalog is what a teacher chooses from in a course brief and what the assistant is told to prefer.
"""

from typing import Literal, get_args

CatalogType = Literal[
    "multiple_choice",
    "short_answer",
    "cloze",
    "matching",
    "token_ordering",
    "token_selection",
    "free_text",
    "translation",
]

COMPONENT_CATALOG: tuple[str, ...] = get_args(CatalogType)
