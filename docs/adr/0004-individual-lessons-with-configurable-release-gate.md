---
status: accepted
date: 2026-09-24
---

# Every lesson is generated for one student, behind a per-course release policy

The product's core promise is that each student follows an individual path. The obvious way to make teacher review scale (a class-level pool of lessons from which students are assigned) was considered and rejected: it dilutes exactly the thing the product exists for. Instead every lesson is planned and generated for exactly one student, and the teacher stays in control through a release policy set per course run: strict (nothing reaches a student without approval) or trusted (lessons that stay within approved concepts and preferred exercise types are released automatically and reviewed afterwards). New runs start strict; the teacher relaxes the policy once the assistant has earned it.

## Considered options

- **Class pool with per-student selection**: cheaper and easier to review, rejected as above.
- **Always automatic release**: rejected; the teacher must be able to keep every lesson behind approval, and student text entering generation makes unreviewed release a prompt-injection surface.

## Consequences

- Review load grows with the number of students (20 to 30 per class here), so the review experience must be built for batches, not for reading one lesson at a time.
- Planning happens at checkpoints. In phase 1 the only checkpoint is lesson completion; finer checkpoints (per exercise) may come later and must not require a schema change.
- Student-written text reaches the assistant during assessment and planning, so prompt injection through student answers is a first-class threat to design against, not an afterthought.
