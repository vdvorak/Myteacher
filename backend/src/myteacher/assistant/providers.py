"""The AI providers the app supports and how a teacher's key reaches them (ADR 0002).

The supported providers and their default model slots live in `providers.json`; this module is
the only other place with provider knowledge, and it defers to pydantic-ai for the rest.
"""

import json
import logging
import os
from collections.abc import Callable
from dataclasses import dataclass
from importlib import resources
from typing import Literal

from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelAPIError, ModelHTTPError
from pydantic_ai.models import Model, infer_model
from pydantic_ai.providers import infer_provider_class

os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ProviderInfo:
    id: str
    label: str
    strong_model: str
    fast_model: str
    # The provider's own answer limit is low (4096 with Anthropic), so each task sets its own;
    # others answer up to the model's limit, reasoning included, and are left to it.
    sets_max_tokens: bool = False


def _load() -> dict[str, ProviderInfo]:
    table = json.loads(
        (resources.files("myteacher.assistant") / "providers.json").read_text(encoding="utf-8")
    )
    return {
        provider_id: ProviderInfo(id=provider_id, **row)
        for provider_id, row in table.items()
        if not provider_id.startswith("_")
    }


PROVIDERS: dict[str, ProviderInfo] = _load()

# Builds a model for (provider, model name, API key); tests substitute pydantic-ai's test models.
ModelFactory = Callable[[str, str, str], Model]


def pydantic_ai_model(provider: str, model_name: str, api_key: str) -> Model:
    return infer_model(
        f"{provider}:{model_name}",
        provider_factory=lambda name: infer_provider_class(name)(api_key=api_key),
    )


# What went wrong with a provider call, in terms a teacher can act on: fix the key, top up the
# account, wait and retry, or nothing obvious.
ProviderProblem = Literal["authentication", "quota", "transient", "other"]
KeyProblem = ProviderProblem


def _out_of_credit(error: ModelHTTPError) -> bool:
    # Anthropic answers an exhausted prepaid balance with 400 "credit balance is too low".
    return error.status_code == 400 and "credit balance" in str(error.body).lower()


def _rejected_key(error: ModelHTTPError) -> bool:
    # Google answers an invalid key with 400 INVALID_ARGUMENT and the reason API_KEY_INVALID.
    return error.status_code == 400 and "API_KEY_INVALID" in str(error.body)


def classify(error: Exception) -> ProviderProblem:
    """The kind of a failed provider call; shared by the key test and every assistant task."""
    if isinstance(error, ModelHTTPError):
        if error.status_code in (401, 403) or _rejected_key(error):
            return "authentication"
        if error.status_code in (402, 429) or _out_of_credit(error):
            return "quota"
        # 529 is Anthropic's "overloaded".
        if error.status_code in (408, 500, 502, 503, 504, 529):
            return "transient"
        return "other"
    if isinstance(error, ModelAPIError):
        # No HTTP answer at all: connection refused, timeout.
        return "transient"
    return "other"


async def test_key(
    factory: ModelFactory, provider: str, model_name: str, api_key: str
) -> KeyProblem | None:
    """Make the cheapest possible call; None when it worked, else what kind of failure it was."""
    try:
        agent = Agent(factory(provider, model_name, api_key))
        # No output limit: OpenAI refuses very small ones and Gemini spends them on thinking,
        # either of which would fail a working key. A one-word reply costs next to nothing.
        await agent.run("Reply with the single word OK.", model_settings={"timeout": 30})
    except Exception as error:  # noqa: BLE001 - any failure of a test call is reported, not raised
        problem = classify(error)
        logger.info("key test for %s failed (%s): %r", provider, problem, error)
        return problem
    return None
