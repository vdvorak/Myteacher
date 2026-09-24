---
status: accepted
date: 2026-09-24
---

# Student-written text is untrusted input to the assistant

Open exercise answers and student questions are written by students and enter the assistant's prompts during assessment and planning, so they are a prompt-injection surface. We decided on layered isolation: closed exercise types never touch a model; assessment of an open answer is an isolated call with no tools, the answer embedded as delimited data, and the output validated against a fixed schema so that an injection can at worst spoil one assessment; planning receives concept states, assessments and notes, and raw student text only as marked untrusted evidence; and in trusted release mode a separate cheap check verifies that a generated lesson stays within the concept map and preferred exercise types and contains no foreign content before it is released. A lesson that fails the check falls back to the strict queue with a flag for the teacher.

## Considered options

- **A single combined call for assessment and planning**: cheaper, rejected because a successful injection could then steer the next lesson directly.
- **Trusted release without the gate check**: rejected; trusted mode is not offered until the check exists.

## Consequences

- Extra model calls per checkpoint (assessment, planning, gate check) are the price of trusted mode and must be visible in the cost view.
- Detecting instruction-like student answers and flagging them to the teacher is a later addition, not part of phase 1.
