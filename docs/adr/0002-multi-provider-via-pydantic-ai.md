---
status: accepted
date: 2026-09-24
---

# Teachers bring their own AI provider key; the app talks to providers through pydantic-ai

Teachers pay for the assistant with their own API keys and want to choose the provider, so the app must support several providers rather than only Anthropic. We decided to use pydantic-ai as the provider abstraction so that the Pydantic lesson and assessment schemas double as the structured-output contract with every provider.

## Considered options

- **Anthropic only**: simplest and gives access to provider-specific features (native web search, caching), rejected because the first teachers explicitly want a choice of provider.
- **Own thin layer over each provider SDK**: rejected as duplicated work as long as pydantic-ai covers the providers and structured output we need. Revisit if a required provider or feature is missing there.

## Consequences

- Provider-native features that differ between vendors (web search, citations, caching) cannot be relied on. External source lookup, when added, goes through a provider-independent search API.
- Provider capabilities (structured output, streaming, token accounting) must be verified against the library's documentation before implementation, not assumed.
- Provider keys are stored encrypted on the server, per teacher, because the assistant runs for students' results while the teacher is not present.

## Verification (2026-09-24, pydantic-ai 2.49)

Checked before the first provider code (PHASE-1 assumption 11) for the providers offered first: Anthropic, OpenAI and Google Gemini.

- All three are supported through `pydantic-ai-slim` extras (`anthropic`, `openai`, `google`), with a per-call API key via their provider classes.
- Structured output works through `output_type` with Pydantic models; streaming through `run_stream` and `run_stream_events`; usage accounting through `result.usage` (input and output tokens, requests).
- Provider errors arrive as `ModelHTTPError` with the HTTP status. An invalid key is 401 for Anthropic and OpenAI but 400 with reason `API_KEY_INVALID` for Google, so key tests classify errors per status and body, not by status alone.

Adjustment: the supported providers and their default model slots are one table (`backend/src/myteacher/assistant/providers.json`) whose keys are pydantic-ai provider names. Adding a provider means adding a row, plus its `pydantic-ai-slim` extra if it needs one.

