---
status: accepted
date: 2026-09-24
---

# Myteacher: phase 1 scope

Vocabulary: [CONTEXT.md](../CONTEXT.md). Decisions and their reasons: [docs/adr](./adr). This document says what phase 1 builds, what it deliberately leaves out, and the assumptions the build rests on. It was produced by a grilling session on 2026-09-24 and should be edited, not appended to, when the scope changes.

## Goal

Make it easy for a teacher to produce teaching material and exercises with an AI assistant, and give every student an individual sequence of lessons adapted to their own mistakes, while the teacher keeps control over everything that reaches a student. The pedagogy is that of the `teach` skill (knowledge before skill, desirable difficulty, zone of proximal development, cited sources), applied per student instead of per user.

## First users

Two teachers at schools: one teaching Spanish, one teaching Spanish, English and chemistry. Classes of 20 to 30 students, some under 15. One self-hosted instance run by the project owner on a small VPS. Phase 1 is validated on Spanish and English; chemistry follows in phase 2.

## What a teacher does

1. **Builds a course.** The assistant runs a thorough teacher interview and fills a structured course brief the teacher can edit. The teacher supplies sources (uploads, URLs). Topics are ordered by the teacher. Concept maps are proposed per topic as the topic approaches (or all at once on request) and approved by the teacher. The assistant offers a diagnostic lesson per topic, which the teacher may decline.
2. **Produces material.** Reference documents (printable summaries) and classroom material (printable or projectable exercise sets for the whole run or for chosen students) are generated from the same concept maps and sources.
3. **Starts a run.** Enrols classes or individual students, sets target pace, release policy (strict by default), release schedule, and the two model slots (strong, fast). A short interview covers what is specific to this class.
4. **Reviews.** The review queue shows one row per student with the lesson rationale, exercise types, estimated time and flags. Unflagged rows can be approved in bulk; any row opens to the full lesson for editing, regeneration with an instruction, or retraction. Approval and release are separate steps; release follows the run's schedule unless overridden per lesson.
5. **Answers questions.** Student questions arrive asynchronously; the teacher answers directly or from an assistant draft. The question feeds the student's notes.
6. **Watches dashboards.** Student detail (concept states, lesson history with rationale, notes, on-demand student summary), run overview (students by concept, who is behind, "the class should revisit X"), and cost per run and per student.

## What a student does

Opens the app on a phone, sees the released lesson, works through explanation and exercises in an attempt. Closed exercises are assessed instantly (one retry with a hint, then the solution) or at the end, depending on the lesson's feedback mode. Open answers get an assistant assessment labelled as such, visible immediately, which the teacher may later override. Exercises answered wrongly return in a second round at the end of the lesson. The student can ask a question or mark "I don't understand". After submission, planning produces the next lesson, which appears once released.

## What the assistant does, and under which constraints

- Interview, brief, concept maps, reference documents, classroom material, lessons, open-answer assessments, student notes, lesson rationales, student summaries, drafts of answers to student questions, and the trusted-mode gate check.
- Runs with the run teacher's key inside a run and with the triggering teacher's key at design time.
- Adapts per student in which concepts, how many exercises, which exercise types and which explanation style, inferring style from error patterns recorded in student notes.
- Treats student text as untrusted: assessment is an isolated, tool-less, schema-validated call; planning receives student text only as marked evidence; trusted release requires a passing gate check ([ADR 0009](./adr/0009-student-text-is-untrusted-input-to-the-assistant.md)).
- Prefers the component catalog and may fall back to a custom exercise, which always waits for approval and is recorded in the component backlog ([ADR 0006](./adr/0006-custom-exercises-run-in-a-sandbox.md)).
- Every generation is stored with its prompt version together with the teacher's reaction ([ADR 0010](./adr/0010-every-generation-is-stored-with-its-prompt-version.md)).

## Exercise types

Phase 1 renderers: multiple choice, cloze (with and without a word bank), matching, token ordering, short answer with tolerance, free text and translation (assistant-assessed against a rubric), token selection in text (letter, syllable or word), custom (sandboxed).

In the schema from day one but without a renderer, and excluded by instruction: span highlighting, table fill, numeric answer with tolerance, listening.

Reading comprehension is a lesson block (text plus exercises), not a type.

## Access model

- Instance: admin creates teacher accounts. Teachers sign in with email and password.
- Students belong to the instance, are created by a teacher with an email, receive an invitation link and set a password. Minors need recorded guardian consent before activation. Deleting means deactivation; erasure is a separate admin action.
- Classes are maintained by any teacher; membership is live.
- Course: owner plus an explicit access list (view, view and fork, edit). Only the owner and editors run it. Reuse by other teachers is a fork with permission, which records its origin.
- Run: teacher plus co-teachers.
- Concept states and student notes belong to the student and the course, surviving runs. They do not cross forks.

## Stack

SolidJS single-page app served by FastAPI from one Docker image, SQLite, pydantic-ai for providers, Pydantic models as the single source of truth generating JSON Schema and TypeScript types. Interface in Czech and English, chosen per user. Prompts are versioned files in the repository. Course export as JSON plus source attachments. See [ADR 0002](./adr/0002-multi-provider-via-pydantic-ai.md) and [ADR 0003](./adr/0003-solid-spa-fastapi-sqlite.md).

## Assumptions the build rests on

1. Lesson explanation text is Markdown with a limited element set; images only when uploaded by the teacher; no generated images.
2. Teacher accounts are email and password, admin-created, password reset by email, no second factor. The instance needs SMTP settings for invitations, digests and answered questions.
3. Interface language is a per-user choice, for students too.
4. Monorepo with `backend/` and `frontend/`.
5. Token usage is stored per call; model prices are editable configuration with defaults; the cost dashboard is an estimate.
6. A fork is internally an export followed by an import.
7. A diagnostic is a lesson with feedback mode "at the end" and no second round.
8. A student's first lesson in a topic without a diagnostic is planned from all-unseen concept states plus notes from earlier topics.
9. A student question is shown in the lesson and in the student's overview; the teacher's answer is also emailed.
10. Deletion of any account is a flag. Physical erasure exists only as an explicit admin action.
11. Provider capabilities assumed of pydantic-ai (structured output, streaming, usage accounting for each chosen provider) are verified against its documentation before the first line of assistant code.

## Deliberately outside phase 1

External source search through a provider-independent search API · MCP server for administration and research · listening (TTS) and speaking (STT) · chemistry (numeric type, formula notation) · real-time view of students working · detection of instruction-like student answers · course import · formal prompt evaluation set · course quality across runs · structured per-student style settings · topic deadlines · presentations · Postgres · teacher self-registration and billing.

## Done when

- Both teachers have built a course through the interview, approved concept maps for the current topic and produced at least one reference document and one classroom material without editing generated text by hand more than they would edit a colleague's draft.
- A run with a real class has completed at least three planning cycles under strict policy, and the review queue with bulk approval keeps a 25-student review under fifteen minutes.
- At least one teacher has switched a run to trusted policy and kept it there.
- The cost dashboard matches the provider's invoice within the expected estimation error.
