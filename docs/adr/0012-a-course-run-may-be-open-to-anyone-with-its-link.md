---
status: accepted
date: 2026-09-26
---

# A course run may be open to anyone with its link, as participants without accounts

ADR 0011 rejected a link to an online page without accounts because it bypasses student accounts and guardian consent. In practice the first release needs students to have accounts, and accounts need invitations sent by email. An instance without SMTP settings therefore cannot put any work in front of a class. We decided that a teacher may start a course run as a **link run** instead of enrolling students: anyone with its join link enters its lobby by typing a name, up to a capacity the teacher sets. They join as **participants** without accounts. The teacher releases classroom material to them all at once, so nobody starts early. This supersedes ADR 0011 on that one point. Enrolled runs, and the student accounts and consent of ADR 0007, stay as they are.

Participants are kept to the minimum. We store the name they typed, their answers and nothing else: no email, no password. Their names and answers are deleted 90 days after the run's last release, or earlier when the teacher asks. The teacher confirms, when starting a link run, that they are responsible for the people they share the link with. The teacher, not the platform, knows whether those people are minors and has their consent where it is needed.

## Considered options

- **Keep accounts only and require SMTP first**: rejected for the first version, because nothing reaches a class until email works, and an instance may run for a while without it.
- **A link on one release instead of on the run**: rejected, because the participants of a run should get its later releases too, and the lobby and capacity belong to the run.
- **Identity by name alone, or by a name and a PIN**: rejected. A name is not unique, as two children in a class can share one, and a PIN is one more thing children forget. Each participant gets a **personal link** instead. It alone brings them back to their work, on any device, but open on one device at a time.

## Consequences

- A run is either enrolled or a link run, chosen when it starts; it never holds both. Releases, attempts, assessment, publishing results and who pays (ADR 0008) work the same for participants as for students.
- Participants have no concept states and no student notes, and individual lessons (slice 4) do not reach them. A link run delivers classroom material only.
- A shared personal link lets someone else work in a participant's place, as a shared password would. Moving the work to another device is allowed but shown to the teacher, so misuse is visible.
- The join link can be replaced and joining closed, in case the link spreads beyond the intended people. Replacing it leaves the personal links working.
