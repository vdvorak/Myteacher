---
status: accepted
date: 2026-09-24
---

# Lessons are structured data rendered by app components, not free HTML

The teach skill that inspired this project emits each lesson as a self-contained HTML+JS file, which gives the model full creative freedom. We decided instead that a lesson is structured data (a Pydantic schema) and that the app renders every exercise with its own components from a component catalog. This gives us structured per-student results, uniform theming, render-time answer shuffling, deterministic assessment of closed exercise types, teacher control over which exercise types are used, and no model-generated JavaScript running in student browsers.

## Considered options

- **Free HTML per lesson** (the skill's approach): rejected because results are unstructured, every lesson looks different, exercise types cannot be constrained, and it means shipping model-written JS to students.
- **Structured schema with a hard whitelist**: rejected because real teaching needs exercises nobody anticipated (for example marking the stressed syllable in a Spanish word). The catalog is a recommendation to the assistant; when the assistant needs something outside it, the need is recorded so it can become a standard component instead of being re-invented each time. How such an exercise reaches the student before the component exists is decided in ADR 0006.

## Consequences

- Simulators and rich interactive widgets require a component before they can appear in a lesson.
- The Pydantic models are the single source of truth: they validate model output, generate the JSON Schema, and generate the TypeScript types for the renderer.
