# Myteacher: UI redesign brief

## What Myteacher is

A self-hosted web app for a school. A **teacher** designs a course together with an AI **assistant**, generates classroom material (exercise sets) from it, and releases the material to students. **Students** complete it in the app, mostly on phones. The teacher gets the results back. Everything the assistant produces goes through the teacher before a student sees it.

Three roles:

- **Admin**: runs the instance. Sets up email (SMTP), invites teachers and erases student data on legal request. Rarely logs in.
- **Teacher**: the main user and the most complex part of the UI. Designs courses, manages classes and students, runs courses, releases material and reads the results. Uses a laptop, sometimes a projector in class.
- **Student**: aged about 11–18, some under 15. Opens the app on a phone, sees what is released to them and completes exercises. This part must be dead simple.

The first real users are two teachers (Spanish, English) with classes of 20–30 students. The UI is **Czech first**, with English as a second language chosen per user. Czech strings are about 20–30 % longer than English.

## The problem

The current UI works but is terrible to use. A first-time user (even the project owner) does not know where to click or how the app works:

- Pages are long vertical stacks of unrelated panels. The course page holds the interview, sources, reference documents, topics, access rights and runs all at once.
- There is no sense of order. Setting up a course is a sequence (interview → sources → topics → concept map → material → run → release), but nothing shows the steps or what comes next.
- Important actions are hidden inside other pages. For example, releasing a material happens on the run page, and results are reached by clicking a release title.
- Background AI jobs (interview, concept maps, material generation, assessment) show little feedback.
- There is no dashboard. After signing in, a teacher does not see what needs attention.

## What I want from you

A redesign proposal that makes the app **self-explanatory**:

1. **Information architecture and navigation** per role: what the top-level sections are, and what the teacher and student home screens show.
2. **Guided setup**: how a teacher is led from an empty account to students completing material. This could be a checklist, a stepper or next-step prompts, whatever works best.
3. **Key screens**, redesigned (desktop for the teacher, phone for the student):
   - teacher home or dashboard;
   - course (split into clear steps or tabs), with topic, concept map and materials;
   - classes and students;
   - course run with releasing a material (settings: feedback mode, due date, late work, attempts, solutions, audience);
   - release results (students × exercises table, open answers assessed by the assistant, teacher overrides, publishing, retraction);
   - student home and the exercise player on a phone (all exercise types, both feedback modes, second round, results);
   - admin.
4. Empty, loading, error and "AI is working" states, and how a finished background job is announced.
5. A small **component and style system** built on the existing design tokens, which you may change.

## Constraints

- The frontend is SolidJS with plain CSS. All colours, fonts and spacing come from CSS custom properties (tokens) in one file (`05-current-styles.css`). Keep that approach: no Tailwind, no heavy component library.
- Both light and dark mode are required.
- Accessibility: WCAG AA, full keyboard use, and screen-reader-friendly exercises (they are already built with roles and labels).
- Mobile-first for students; the teacher screens must still work on a tablet.
- Keep the domain vocabulary from `02-glossary.md` (Course, Topic, Concept Map, Classroom Material, Course Run, Release, Attempt, Retraction…). Czech terms: běh kurzu = course run, průchod = attempt.
- Features that do not exist yet (individual lessons, review queue, dashboards and questions from slices 4–5 in `03-product-scope.md`) should have a place in the navigation so the structure will not need redoing, but they do not need designing now.

## Files

- `01-START-HERE.md`: this brief.
- `02-glossary.md`: the domain vocabulary (authoritative names).
- `03-product-scope.md`: what the product does in phase 1 and what comes later.
- `04-current-screens.md`: every current screen with its sections, actions and real UI texts, the navigation map, the end-to-end flows as they are today, and where users get lost.
- `05-current-styles.css`: the current design tokens and base styles.
- `screenshots/`: screenshots of the current app.
