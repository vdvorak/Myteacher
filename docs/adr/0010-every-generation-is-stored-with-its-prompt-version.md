---
status: accepted
date: 2026-09-24
---

# Every assistant generation is stored with its prompt version, and the teacher's reaction is the quality signal

The project promises lessons "as good as the teach skill", but there is no formal evaluation harness in phase 1. We decided that every assistant call (interview turns, concept maps, lessons, assessments, gate checks, summaries) is stored together with the version of the prompt that produced it, and that the teacher's reactions (approve untouched, edit, regenerate with an instruction, retract, override an assessment) are recorded against that generation. Prompt changes can then be judged by how teachers react to their output, and a formal evaluation set can be assembled later from real briefs and real reactions.

## Considered options

- **Formal evaluation harness from the start**: rejected as premature; there are no real briefs yet to evaluate against.
- **Storing only the output**: rejected because data not captured now cannot be recovered, and without the prompt version no comparison is possible.

## Consequences

- Prompts are versioned artefacts in the repository, not inline strings.
- Storage grows with every call; retention can be pruned later, but the reaction record must survive pruning.
