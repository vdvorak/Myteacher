---
status: accepted
date: 2026-09-24
---

# Exercises outside the catalog run as assistant-written HTML in a sandboxed iframe

ADR 0001 made the component catalog a recommendation rather than a hard limit, which left open how an exercise the app has no component for (marking the stressed syllable of a Spanish word was the motivating example) reaches a student before someone builds the component. We decided on an escape hatch: a custom exercise type whose content is assistant-written HTML/JS rendered in an iframe with no same-origin access and no network, communicating only through a fixed result contract (the student's answer plus an optional self-assessment). A custom exercise always waits for teacher approval regardless of the run's release policy, is labelled experimental to the teacher, and is recorded in the component backlog so that recurring needs become standard components.

## Considered options

- **No escape hatch; the assistant picks the nearest standard type and logs the wish**: rejected because the teacher loses the exercise they actually wanted, which is the failure this project exists to avoid.
- **Generic primitives only** (select tokens in text, drag tokens into slots, highlight span, fill a table): adopted as well, because most "non-standard" ideas collapse into them, but they do not remove the need for the escape hatch.

## Consequences

- Custom exercises are the one place model-written code reaches a student's browser; the sandbox and the mandatory approval are what make that acceptable.
- Promoting a backlog entry to a standard component is a developer task. The app only collects and counts.
