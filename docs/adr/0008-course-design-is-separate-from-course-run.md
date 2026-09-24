---
status: accepted
date: 2026-09-24
---

# A course is a reusable design; a course run is one delivery of it

A teacher builds a course (brief, topics, concept maps, sources, reference documents) once and teaches it to several classes and again next year, and other teachers want to reuse it rather than build their own. We therefore split the reusable design (Course) from its delivery to particular students (Course Run). Students and classes are enrolled into runs, generated lessons and submissions belong to runs, and release policy and pace are run settings. Concept states and student notes belong to the student and the course, so they survive into a later run of the same course (a student repeating a year keeps their history). Courses have an owner and editors; runs have a teacher and co-teachers.

Reuse between teachers is by fork, not by running someone else's course: the owner keeps an explicit access list (view, fork, edit) and a teacher who wants to teach a colleague's course makes their own copy with the owner's permission. A course is only ever run by its owner or editors, so outcomes of a run are always attributable to the teacher who owns the design being taught.

## Considered options

- **One entity with enrolments**: rejected because reusing it for a second class would mean copying the design and losing the link between copies.
- **Running a colleague's course directly, with run-level overrides**: rejected because outcomes would then mix the design owner's and the running teacher's contribution, which distorts any later statistics on course quality per teacher. A fork records its origin for lineage but does not follow the original's changes.
- **Instance-wide "shared" flag**: rejected in favour of an explicit per-teacher access list managed by the owner.

## Consequences

- The assistant's design-time work (interview, concept maps, reference documents) happens on the course; planning and assessment happen on the run.
- Design-time assistant work is paid by the key of the teacher who triggers it; planning and assessment in a run are always paid by the run teacher's key, even when a co-teacher triggers them or they run automatically.
- Concept states do not transfer across forks in phase 1, because a fork's concepts are copies with their own identity.
