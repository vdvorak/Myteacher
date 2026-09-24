"""Prompts as versioned files (ADR 0010).

Each task kind has a directory of versions (`v1.md`, `v2.md`, …); `manifest.json` names the
current one. A prompt includes a shared fragment with `{{fragment:<name>}}`, resolved from
`fragments/`, so the pedagogy and the component catalog are stated once.
"""

import hashlib
import json
import re
from dataclasses import dataclass
from importlib import resources

_FRAGMENT = re.compile(r"\{\{fragment:([a-z_]+)\}\}")


@dataclass(frozen=True)
class Prompt:
    task_kind: str
    version: str
    text: str

    @property
    def hash(self) -> str:
        """Of the assembled text, so that a changed fragment is visible in generation records."""
        return hashlib.sha256(self.text.encode("utf-8")).hexdigest()


def _read(*parts: str) -> str:
    return (resources.files(__name__).joinpath(*parts)).read_text(encoding="utf-8")


def manifest() -> dict[str, str]:
    return {k: v for k, v in json.loads(_read("manifest.json")).items() if not k.startswith("_")}


def current_version(task_kind: str) -> str:
    return manifest()[task_kind]


def load(task_kind: str, version: str | None = None) -> Prompt:
    version = version or current_version(task_kind)
    text = _FRAGMENT.sub(
        lambda m: _read("fragments", f"{m.group(1)}.md").strip(), _read(task_kind, f"{version}.md")
    )
    return Prompt(task_kind=task_kind, version=version, text=text)
