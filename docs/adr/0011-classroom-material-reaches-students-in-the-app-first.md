---
status: accepted
date: 2026-09-25
---

# Students first get classroom material in the app, released to a course run, not as an exported file

Individual lessons (slice 4) are the core of the product and the largest slice, and until they exist no student works on anything the teacher prepared. To get exercises to students sooner, a teacher may release a classroom material, which is already a lesson document without a student, to the students of a course run, who complete it in the app with their own accounts. Every student of the release gets the same frozen version; each works through it as an attempt, closed answers are assessed at once, and open answers are assessed by the assistant when the teacher asks, reaching students only once the teacher publishes the results. This is slice 3.5: the course run, release, attempt and assessment are the entities of slice 4, only without planning, the review queue and concept states, so slice 4 builds on them instead of replacing them.

## Considered options

- **An offline HTML file** the teacher exports and hands out, keeping progress in the browser and handing back a result file: rejected because the answer key would have to be inside the file, progress kept in a file opened from disk is unreliable across browsers, handing back a file is awkward for children, and a standalone bundle of the renderer plus importing results is more work than delivery in the app.
- **A link or QR code to an online page without accounts**, identified by a name or code: rejected because it bypasses student accounts and the guardian consent that minors need (ADR 0007). Superseded on this point by ADR 0012, which lets a course run be open to anyone with its link.
- **Releasing directly to a class, without a course run**: rejected because slice 4 needs the run anyway, and the run decides whose key pays for assessment (ADR 0008) and keeps the roster live.

## Consequences

- Attempts exist on the server before planning does, so the safeguards that trusted the browser (tries and solution reveal, the answer key, cloze variants and layouts) move to the attempt in this slice.
- Assessments are stored with the concepts of the approved map, so slice 4 can derive concept states from attempts made before it.
- A released version never changes; a corrected material is released again, and a wrong release is retracted as a whole.
