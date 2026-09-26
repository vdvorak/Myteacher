# Myteacher

A teaching platform where a teacher designs a course together with an AI assistant and every student receives an individual, teacher-controlled sequence of lessons adapted to their own progress.

## Language

### People and access

**Instance**:
One self-hosted deployment shared by a group of teachers and their students, typically one school. The word is reserved for this meaning; a running of a course is a Course Run.
_Avoid_: tenant, organization, school, course instance

**Admin**:
The person operating an instance and creating teacher accounts.
_Avoid_: superuser, owner, operator

**Teacher**:
A person who runs courses, reviews everything the assistant produces, and holds the AI provider keys that pay for it.
_Avoid_: author, tutor, instructor

**Student**:
A learner with an account on the instance who can be enrolled in course runs by any teacher. A student is not owned by a teacher and may be a minor.
_Avoid_: pupil, learner, user

**Deactivation**:
Marking a student's or teacher's account inactive. Nothing is physically removed; this is what "deleting" means in the product.
_Avoid_: deletion, removal, archiving

**Erasure**:
The separate admin action that physically removes a student's answers, notes and concept states to satisfy a legal request.
_Avoid_: hard delete, purge, GDPR delete

**Guardian Consent**:
The recorded fact that a legal guardian has agreed to a minor's account and data processing. A minor's account cannot be activated without it.
_Avoid_: parental approval, GDPR flag

**Class**:
A named group of students in the instance, such as "2.B 2026/27", maintained by any teacher and used to enrol students into course runs in bulk. Membership is live: a run enrolling a class always sees its current members.
_Avoid_: group, cohort, course

**Course Editor**:
A teacher granted the right to change a course's design and to run it alongside its owner.
_Avoid_: collaborator, contributor, co-author

**Co-teacher**:
A teacher with full rights on a course run alongside the run's teacher, typically a substitute. Czech: spoluvyučující.
_Avoid_: collaborator, substitute, assistant teacher

**Assistant**:
The AI acting on a teacher's behalf through that teacher's provider key.
_Avoid_: AI, model, bot, agent

### Course design

**Course**:
The reusable design of a subject: brief, ordered topics, concept maps, sources and reference documents. Owned by one teacher, never tied to particular students, and only ever run by its owner or editors.
_Avoid_: class, subject, workspace, template, curriculum

**Course Access**:
The explicit list, managed by the course owner, of which teachers may view, fork or edit a course. There is no instance-wide sharing.
_Avoid_: sharing, permissions, visibility

**Fork**:
A teacher's own copy of another teacher's course, made with the owner's permission. It records its origin but does not follow later changes to the original. Czech: vlastní kopie.
_Avoid_: copy, clone, duplicate, template

**Course Run**:
One delivery of a course by a teacher to enrolled students and classes, with its own pace, release policy and progress; or, as a link run, to the participants who joined through its join link. Czech: běh kurzu.
_Avoid_: course instance, cohort, class, session

**Link Run**:
A course run open to anyone with its join link instead of enrolled students, up to a capacity the teacher sets. Czech: běh pro lidi s odkazem.
_Avoid_: open run, public run, guest run

**Participant**:
A person in a link run without an account, known only by the name they entered and their personal link. Czech: účastník.
_Avoid_: guest, anonymous student, player

**Join Link**:
The one link of a link run that anyone may open to enter its lobby with a name. Czech: odkaz pro připojení.
_Avoid_: invite link, share link, code

**Personal Link**:
The link a participant gets on joining, which alone brings them back to their own work in the link run, on any device. Czech: osobní odkaz.
_Avoid_: token, magic link, login link

**Lobby**:
Where the participants of a link run wait, and the teacher sees who has joined, until the teacher releases material to them all at once. Czech: čekárna.
_Avoid_: waiting room, queue

**Enrolment**:
A student's membership in a course run, either direct or through a class.
_Avoid_: registration, assignment, membership

**Course Brief**:
The structured description of a course produced by the teacher interview: audience, level, goals, timeframe, sources, preferred exercise types, tone, language of instruction. The counterpart of the teach skill's mission. Czech: zadání kurzu.
_Avoid_: mission, settings, profile

**Teacher Interview**:
The relentless questioning the assistant runs before generating anything: thorough once per course, brief per topic. Czech: úvodní rozhovor.
_Avoid_: wizard, onboarding, setup

**Topic**:
A teacher-defined unit of a course, such as "pretérito indefinido", within which students receive individual lessons.
_Avoid_: chapter, module, unit

**Concept**:
The smallest tracked unit of knowledge or skill: a word, a grammar point, a sub-skill.
_Avoid_: skill, item, knowledge point

**Concept Map**:
The set of concepts belonging to a topic, proposed by the assistant and approved by the teacher.
_Avoid_: curriculum, syllabus, knowledge graph

**Source**:
Material supplied by the teacher (textbook chapter, document, URL) that generated content must cite.
_Avoid_: resource, attachment, reference

**Reference Document**:
A compressed, printable summary distilled from lessons, such as a vocabulary sheet or a grammar cheat sheet.
_Avoid_: handout, cheat sheet, summary

**Classroom Material**:
A printable or projectable set of exercises or text generated for a topic for use in the classroom, for the whole run or for chosen students, and checked by the teacher. The same for every student who gets it, unlike a lesson; the teacher may also hand it to students to complete in the app.
_Avoid_: worksheet, handout, class lesson

### Lessons and exercises

**Lesson**:
The unit a student receives: a short explanation followed by exercises, completable in one sitting, generated for exactly one student. Editing a lesson produces a new version; the student always works on one version through an attempt.
_Avoid_: assignment, homework, session, task

**Attempt**:
One student's pass through one version of a lesson or of a released classroom material, from opening to submission. Czech: průchod lekcí. A voided attempt keeps its answers for the teacher but counts for nothing.
_Avoid_: run (reserved for Course Run), session, try, pass

**Exercise**:
One interactive item inside a lesson, an instance of an exercise type.
_Avoid_: question, task, item, activity

**Exercise Type**:
A kind of exercise the app can render and assess, such as multiple choice, cloze or matching.
_Avoid_: widget, question type, component (a component is the renderer of a type)

**Component Catalog**:
The set of exercise types the app implements. A recommendation to the assistant, not a hard limit.
_Avoid_: whitelist, allowed types

**Custom Exercise**:
An exercise outside the component catalog, delivered as assistant-written HTML in a sandbox with a fixed result contract. Always requires teacher approval and is recorded in the component backlog.
_Avoid_: experimental widget, escape hatch, ad-hoc exercise

**Component Backlog**:
The recorded needs for exercise types that do not exist yet, collected from custom exercises so they can become standard components.
_Avoid_: feature requests, wishlist

**Rubric**:
The assessment criteria attached to an open exercise, generated with the exercise and approved by the teacher.
_Avoid_: answer key, criteria, model answer

**Diagnostic**:
An optional first lesson of a topic whose purpose is to establish each student's starting concept states. Offered by the assistant, declinable by the teacher.
_Avoid_: pre-test, placement test, assessment

### Progress and adaptation

**Concept State**:
One student's standing on one concept: unseen, fragile or consolidated, with last success time and attempt count. It belongs to the student and the course, so it survives across course runs.
_Avoid_: mastery, score, level, progress

**Student Notes**:
Free-text observations about one student in one course, written mostly by the assistant at each checkpoint (error patterns, misconceptions, what explanation style worked) and readable and correctable by the teacher. They are how the assistant adapts style, not a setting the teacher configures. The counterpart of the teach skill's learning records.
_Avoid_: learning records, profile, history, preferences

**Planning**:
The assistant's act of deciding and generating the next lesson for one student from their concept states, notes and the course brief.
_Avoid_: recommendation, adaptation, generation

**Feedback Mode**:
Whether a lesson shows the assessment of each exercise immediately or only after the whole lesson is submitted, so the student can revise first. Chosen per lesson.
_Avoid_: grading mode, instant feedback

**Current Topic**:
The topic a run's class is working on in the classroom, moved forward by the teacher by hand. Planning individualises within it and revisits earlier topics.
_Avoid_: position, progress pointer, active topic

**Target Pace**:
The number of lessons per week a run's teacher expects, used to size lessons and to show who is behind. Never a hard deadline.
_Avoid_: schedule, deadline, cadence

**Student Summary**:
A paragraph written by the assistant on request describing where a student struggles most, which path was taken with them and why.
_Avoid_: report, evaluation, verbal assessment

**Lesson Rationale**:
The assistant's explanation of why this lesson, with these concepts and exercises, was planned for this student now. Shown in review and in dashboards.
_Avoid_: justification, explanation, reasoning

**Checkpoint**:
The moment planning happens for a student. In phase 1 always the completion of a lesson.
_Avoid_: trigger, step

**Assessment**:
The grading of one exercise answer within an attempt: deterministic for closed types, produced by the assistant against the rubric for open types, always overridable by the teacher. Assessments of a voided attempt do not feed concept states.
_Avoid_: grade, mark, score, evaluation

**Student Question**:
A question or "I don't understand" raised by a student on a lesson, answered by the teacher (optionally from an assistant draft) and fed into planning.
_Avoid_: comment, feedback, ticket, help request

### Teacher control

**Release Policy**:
A per-run setting deciding whether generated lessons wait for teacher approval (strict) or are released automatically within constraints and reviewed afterwards (trusted).
_Avoid_: approval mode, trust level, auto-approve

**Approval**:
The teacher's judgement that a generated lesson is fit to be taught. Approval does not by itself show the lesson to the student.
_Avoid_: release, publish, accept

**Release**:
The moment a lesson becomes visible to its student, by hand or at a scheduled time, after approval or automatically under a trusted policy. A classroom material is released by hand to the students of a course run, to complete in the app. Czech: vydání.
_Avoid_: publish, unlock, approve

**Retraction**:
The teacher voiding a student's attempt, whether not yet opened, in progress or submitted. The student is told and taken out of the lesson if inside it; the teacher then edits, regenerates or replaces the lesson, and a new attempt is issued. Czech: stažení.
_Avoid_: invalidate, revoke, delete, cancel

**Review Queue**:
The list of generated lessons and assessments waiting for the teacher to approve, edit, regenerate or retract, presented as one summary row per student with the lesson rationale and any flags, with bulk approval of unflagged rows. Czech: ke kontrole.
_Avoid_: inbox, pending, approvals

**Daily Digest**:
The once-a-day email telling a teacher what waits in the review queue and which student questions are open.
_Avoid_: notification, alert, summary email
