import re
from importlib import resources

from myteacher.assistant import prompts
from myteacher.lesson.catalog import COMPONENT_CATALOG


def test_every_task_in_the_manifest_has_its_current_prompt():
    for task_kind, version in prompts.manifest().items():
        prompt = prompts.load(task_kind)
        assert prompt.version == version
        assert prompt.text.strip()
        assert "{{" not in prompt.text, task_kind


def test_the_hash_follows_the_assembled_text():
    prompt = prompts.load("course_interview")

    assert prompt.hash == prompts.load("course_interview", prompt.version).hash
    assert len(prompt.hash) == 64


def test_the_catalog_fragment_offers_exactly_the_component_catalog():
    fragment = (resources.files(prompts) / "fragments" / "catalog.md").read_text(encoding="utf-8")

    offered = re.findall(r"^- `([a-z_]+)`", fragment, flags=re.MULTILINE)

    assert offered == list(COMPONENT_CATALOG)
