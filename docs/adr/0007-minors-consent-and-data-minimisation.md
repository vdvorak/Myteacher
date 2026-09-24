---
status: accepted
date: 2026-09-24
---

# Students may be under 15: consent gates activation and notes stay minimal

The first classes are school classes and some students will be under 15. Their accounts carry an email and the platform stores their answers and free-text observations about them. We decided that a student marked as a minor cannot be activated until guardian consent is recorded, and that student notes are limited to learning-related observations: the assistant is instructed never to record health, family or other sensitive facts, and the teacher guidance says the same.

## Consequences

- The student record needs a minor flag and a consent record (who attested, when). How consent is captured is a product decision, not a schema one.
- Deleting a student is a flag (deactivation), never a physical delete, so course statistics and attempt history stay intact. A legal erasure request is served by a separate admin action that physically removes the student's answers, notes and concept states; it exists because the flag alone would not satisfy such a request.
