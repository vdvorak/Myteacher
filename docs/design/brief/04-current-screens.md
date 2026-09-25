# Myteacher frontend: screen inventory for the redesign

Source: `frontend/src` (SolidJS). Every quoted label is the English text from `src/i18n/messages.ts`; the interface also ships in Czech (`cs`). Placeholders such as `{name}` are filled at runtime.

## Roles in the code

- **Anonymous**: not signed in. Any in-app route redirects to `/sign-in`.
- **Teacher**: an account with `kind = teacher`.
- **Admin**: not a separate account type. An admin is a teacher whose `roles` include `admin`. Admins see everything a teacher sees, plus the "Administration" nav item and `/admin`.
- **Student**: an account with `kind = student`.

Teacher-only pages are wrapped in `TeachersOnly`. A student who opens one by URL sees only the alert "Only teachers can open this page." `/admin` shows "Only admins can open this page." to non-admins.

## Global conventions (they apply to almost every screen)

- **Layout**: one centred column, max width `--content-width` (42rem, about 670px), even for wide tables such as release results. Sections are stacked vertically. No sidebars, cards, tabs or accordions, except two collapsible `<details>` blocks (raw AI output) and a few show/hide toggles.
- **Feedback**: every action reports its result in a plain paragraph. `role="status"` is used for success (unstyled text) and `role="alert"` for errors (unstyled, except on the auth pages where alerts are red). The message usually appears at the bottom of the section or page, often far from the button that was clicked.
- **Confirmation**: destructive actions use an inline two-step pattern. The first button ("Remove", "Discard") swaps itself for a red-outlined "… for good" button plus "Keep"/"Cancel". Some destructive actions have no confirmation at all (noted per screen).
- **Buttons**: every button looks the same: a filled accent (blue) primary button. There is no secondary or tertiary style. Some "buttons" are really links (`<a>`), e.g. "Preview and print", "Concept map", "Export the course", and look like plain underlined links.
- **Background AI work ("jobs")**: shown inline with a spinner and "The assistant is working…" (or a specific text). Status is polled. If polling fails the text gets " The connection was lost; still trying." Failures show a red-bordered box (`JobFailureMessage`) with a plain-language reason. For key problems it adds a "Settings" link, and when the model returned garbage it adds a collapsible "What the assistant answered" with the raw output. Failure texts:
  - authentication: "Your provider rejected your API key. Check it in [Settings]"
  - quota: "Your provider key has run out of credit or hit its rate limit. Check the billing at your provider, then try again."
  - transient: "The provider cannot be reached right now. Try again in a while."
  - other: "The assistant failed. Try again; if it keeps failing, check the model names in your settings."
  - invalid_output: "The assistant's answer did not have the expected shape, even after one retry. Try again."
  - no_key: "Add an AI provider key in Settings first. [Settings]"
  - interrupted: "The work was cut off by a restart of the app. Try again."
  - Source-specific: no_text, unreadable_file, unreachable, page_error, not_a_page, too_large, blocked_address (texts under Sources below).
- **Generic error fallbacks** are reused across unrelated features: "The request failed. Try again." (key `smtp.requestFailed`, used by students, classes, runs, erasure) and "The change could not be saved." (`courses.saveFailed`, used by topics, sources, documents, materials, concepts, interview).
- **Loading states**: most in-app screens render nothing while loading (no skeleton or spinner). Exceptions are the lesson preview ("Loading the lesson…"), student work ("Loading…") and the invitation check ("Checking the invitation…").

---

# Part 1: Screens

## 1. Sign in (`/sign-in`)

- **Who**: anonymous. A signed-in user is redirected to `/`.
- **How you get here**: automatically from any in-app URL when signed out; from "Sign out"; from "Go to sign-in" / "Back to sign-in" links on the password pages.
- **Purpose**: sign in with email and password.
- **Layout** (narrow column, half the content width):
  - Header: caption "MYTEACHER" (uppercase, muted) on the left, "Language" select (Čeština / English) on the right.
  - Form, heading "Sign in":
    - "Email" (email input)
    - "Password" (password input)
    - Error alerts (red): "The email or password is not right." / "This account is inactive. Ask your teacher or the admin to reactivate it." / "Signing in failed. Try again."
    - Button "Sign in" (disabled while submitting)
    - Link "Forgot your password?" leads to `/forgot-password`
- **Confusing points**: no product explanation and no hint who creates accounts. There is no self sign-up, and nothing tells the visitor that access is by invitation only.

## 2. Forgot password (`/forgot-password`)

- **Who**: anonymous.
- **How you get here**: "Forgot your password?" on sign-in, or "Ask for a new link" on an expired reset link.
- **Purpose**: request a password-reset email.
- **Layout**: same header. Heading "Reset your password", then the intro "Enter the email of your account and we will send you a link to set a new password.", then:
  - "Email"
  - Status: "If an account uses this email, a link to set a new password is on its way. It works for an hour." / alert "The request failed. Try again."
  - Button "Send reset link"
  - Link "Back to sign-in"

## 3. Invitation / set password (`/invitation#<token>`) and Reset password (`/reset-password#<token>`)

Both use the same component (`PasswordLinkPage`).

- **Who**: anonymous, arriving from an email link. The token is in the URL fragment.
- **Purpose**: set a first password (invitation) or a new password (reset). Submitting also signs the user in and redirects to `/`.
- **Layout**: header as on sign-in. Heading "Set your password" (invitation) or "Reset your password" (reset).
  - While checking: "Checking the invitation…" (this text is also shown for reset links).
  - Invalid link (alert plus a recovery link):
    - Invitation: "This invitation link has already been used. Sign in with your password, or reset it." / "This invitation link was replaced by a newer one or withdrawn. Use the latest invitation email." / "This invitation link has expired. Ask for a new invitation." / "This link is not a valid invitation. Check that you opened the whole link from the email." Recovery link: "Go to sign-in".
    - Reset: "This reset link has already been used. Ask for a new one if you still need it." / "A newer reset link replaced this one. Use the latest email." / "This reset link has expired. Ask for a new one." / "This link is not a valid reset link. …". Recovery link: "Ask for a new link".
    - Check failed: "The invitation could not be checked. Reload the page."
  - Valid link form:
    - Invitation only: "You were invited to Myteacher as **email**"
    - "New password", "Repeat the password"
    - Validation: "The password needs at least 12 characters." / "The passwords differ." / "This account is inactive. …" / "The password could not be set. Try again."
    - Button "Set password and sign in"
- **Confusing points**: the 12-character minimum is only revealed after a failed submit. There is no welcome text about what Myteacher is or what happens next. A student lands straight on an empty home if nothing has been released yet.

## 4. Shell: header and navigation (wraps every screen below)

- **Who**: any signed-in user. Anonymous visitors are redirected to `/sign-in`. If loading the account fails, the only content is "Your account could not be loaded. Reload the page."
- **Header** (small, muted text):
  - Left: caption "MYTEACHER" (not a link).
  - Right: "Signed in as **email**", then role chips ("Teacher", "Student", "Admin" as small bordered pills), the "Language" select, and the "Sign out" button.
  - Changing the language switches the UI immediately and stores it on the account. If storing fails: "The language could not be saved to your account. It applies only here for now."
  - Sign-out failure: "Signing out failed. Try again."
- **Nav** ("Main"; a row of plain text links, the current one in bold):
  - All roles: "Home"
  - Teacher (including admin): "Courses", "Students", "Classes"
  - All roles: "Settings"
  - Admin: "Administration"
- **Confusing points**:
  - The nav order (Courses, Students, Classes) does not follow the setup order.
  - Runs have no nav entry. They are reachable only from inside a course page.
  - There is no breadcrumb. Sub-pages have ad-hoc back links ("All courses", course name, "Back to …").
  - The language switch appears twice: in the header and in Settings.

## 5. Home (`/`)

The content differs by role.

### 5a. Teacher and admin home

- Heading "Myteacher" and one link, "Open the sample lesson" (goes to `/preview/es-ser-estar`, a built-in Spanish demo lesson).
- That is all. There is no dashboard, no recent courses or runs, no pending assessments, and no getting-started checklist.
- **Confusing**: this is the biggest gap for a first-time user. After an admin invites them, a new teacher lands here with no guidance. They must discover that they need (1) an AI key in Settings, (2) a course, (3) a brief, sources and topics, (4) concept-map approval per topic, (5) material, (6) students and classes, and (7) a run and a release. The admin home is identical: nothing points the admin to Administration (e.g. unconfigured SMTP).

### 5b. Student home

- Heading "Hello, {name}" (falls back to the email).
- Section **"Your work"** (h2): a bullet list of releases, latest first. Each item shows:
  - Title (link to `/work/:releaseId`)
  - Muted "{topic} · {run}"
  - State: "Not started" / "In progress" / "Submitted"
  - "Submitted late" if late
  - "Due {date}" if there is a due date and the work is not submitted
- Empty state: "Your lessons will appear here once your teacher sends you the first one."
- Error: "Your work could not be loaded."
- **Confusing**: this is a flat text list. There is no visual priority (overdue, due soon, new), no grouping by course or run, and no indication of scores or published teacher feedback. The list shows no retraction marker; a retraction notice appears only on the work page itself.

## 6. Sample lesson preview (`/preview/:lessonId?seed=`)

- **Who**: anyone who has the link. It is outside the Shell, so there is no nav. It is linked from the teacher home.
- **Purpose**: see a lesson exactly as a student would, and print it.
- **Layout**:
  - Header: caption "LESSON PREVIEW" and the "Language" select.
  - Toolbar: checkbox "Include answer key", button "Print" (disabled while the key loads), alert "The answer key could not be loaded."
  - The Lesson player (section 21), fully interactive.
  - If the key is included: an "Answer key" section after the lesson, printed on its own page.
  - Errors: "No lesson to preview here." / "The lesson could not be loaded."
- **Confusing**: there is no way back into the app (no nav, no back link).

## 7. Settings (`/settings`)

- **Who**: all signed-in users. The content differs by role.
- **How you get here**: the "Settings" nav item, and "Settings" links inside AI error messages.
- **Purpose**: personal preferences and, for teachers, the AI provider keys.
- **Sections in order**:
  1. Heading **"Settings"**. Error: "Your settings could not be loaded."
  2. **"Interface language"** select (saves immediately on change). This duplicates the header switch.
  3. **Daily digest** (shown only when the account has a digest time, i.e. teachers):
     - "Daily digest at" (time input), note "The time of day your daily summary email is sent." and, if the default is in use, "The instance default is used."
     - Buttons "Save digest time" and "Use the instance default" (the latter only when a custom time is set).
     - Result: "Saved." / "Saving failed. Try again."
  4. **"AI providers"** (teachers only). Intro: "The assistant works through your own API key. It is stored encrypted on the server and never shown again; you see only its last characters." Error: "Your providers could not be loaded."
     - One **card per saved provider** (bordered fieldset, the legend is the provider name, e.g. "Anthropic"):
       - "Stored key: `…abcd`"
       - Buttons "Test key" and "Remove key". **Remove has no confirmation.**
       - Test results: "The key works." / "The provider rejected the key. Check that you copied the whole key and that it is still active." / "The key works, but its credit or rate limit is used up. Check the billing at the provider." / "The provider cannot be reached right now. Try again in a while." / "The test call failed. Check the fast model name, or try again later."
       - Models form: "Strong model", "Fast model" (text inputs), note "The strong model plans and writes lessons; the fast one does quick checks. The recommended models are filled in; change them only if you know you want to.", button "Save models".
       - Replace-key form: "New API key", button "Replace key".
       - Result: "Saved." / "Saving failed. Check the values and try again."
     - **"Add a provider"** form (shown while some provider has no key): "Provider" select, "API key" (password, at least 8 characters), "Strong model" and "Fast model" (pre-filled with the recommendations), the same note, button "Add key". Error: "Saving failed. Check the values and try again."
- **Confusing points**:
  - The AI key is required for almost everything a teacher does, yet it sits at the bottom of Settings, below the language and digest settings, and nothing on Home points to it.
  - Each provider card holds three forms (test/remove, models, replace key) in one block. The raw model-ID fields are exposed to non-technical teachers.
  - Adding a key does not test it automatically.
  - Students see a Settings page with only a language select, which duplicates the header.

## 8. Administration (`/admin`)

- **Who**: admin only.
- **How you get here**: the "Administration" nav item.
- **Purpose**: manage teachers, instance email (SMTP) and legal erasure of student data.
- **Sections in order** (heading "Administration"):
  1. **"Teachers"**
     - Table columns: "Email" | "State" ("Invited" / "Active" / "Inactive") | "Role" ("Admin" / "Teacher") | "Actions".
     - Row actions: "Resend invitation" (invited only), "Make admin" / "Remove admin role", "Deactivate" / "Reactivate". **None has a confirmation.**
     - Invite form: "Email of the new teacher", "Their language" (select), button "Invite teacher".
     - Outcomes (below the form): "Invitation sent to {email}." / "The account was created, but the invitation was not sent: {error}" / "The invitation was not sent, and the previous link still works: {error}" / "This email already belongs to an account." / "The instance needs at least one active admin. Make another teacher an admin first." / "This teacher has already accepted the invitation." / "The request failed. Try again."
     - Load error: "The teachers could not be loaded."
  2. **"Email (SMTP)"**
     - Save form: "Server", "Port" (default 587), "Security" (select: "STARTTLS (usually port 587)" / "SSL/TLS (usually port 465)" / "None"), "Username", "Password" (with the note "A password is saved. Leave empty to keep it." and the checkbox "Remove the saved password" when one is stored), "Sender address", button "Save settings".
     - Test form (separated by a rule): "Send a test email to" (pre-filled with the admin's email), button "Send test email" (disabled until SMTP is configured and saved).
     - Outcomes: "Settings saved." / "Some fields are not valid. Check them and try again." / "The request failed. Try again." / "The test email was sent to {to}." / "The test email was not sent: {error}"
     - Load error: "The SMTP settings could not be loaded."
  3. **"Erasure of a student"**
     - Note: "Only for a legal erasure request. To remove a student from use, deactivate them on their page instead."
     - "Student to erase" select ("Choose a student…"), button "Erase…".
     - An inline red-bordered "dialog" opens below. Heading "Erase {name}?", explanation "The student's personal data is removed for good: … This cannot be undone.", "If the student only needs to lose access, cancel and deactivate the student instead.", input "Type the student's name to confirm: {name}", then a red-outlined "Erase permanently" (enabled only when the name matches) and "Cancel".
     - Outcomes: "The name does not match. The student may have been renamed; reload the page." / "The data of {name} was erased." / "{name} was already erased."
- **Confusing points**:
  - The order is backwards for first-time setup. Inviting teachers comes first, but invitations fail until SMTP (the second section) is configured, and nothing warns about this in the Teachers section.
  - A failed invitation still creates the account, so the admin must come back and press "Resend invitation".
  - Granting or removing admin and deactivating happen in one click with no confirmation.
  - The destructive erasure tool sits on the same page as routine setup.

## 9. Students list (`/students`)

- **Who**: teacher.
- **How you get here**: the "Students" nav item.
- **Purpose**: see every student on the instance and create or invite new ones.
- **Sections**:
  1. Heading **"Students"**. Table columns: "Name" (link to `/students/:id`) | "Email" | "State" ("Invited" / "Active" / "Inactive" / "Awaiting consent" / "Erased"). Empty: "No students yet." Error: "The students could not be loaded."
  2. **"New student"** form:
     - Note at the top: "Only learning-related observations belong in student notes: how the student learns and where they struggle. Never health, family or other sensitive facts."
     - Fields: "Name", "Email", "Their language" (select), checkbox "Minor: the account works only once a guardian's consent is recorded".
     - Button "Create and invite".
     - Outcomes: "Invitation sent to {email}." / "The student was created. As a minor, they get no invitation until you record a guardian's consent and activate the account." / "The account was created, but the invitation was not sent: {error}" / "This email already belongs to an account."
- **Confusing points**:
  - The note about "student notes" appears on a form that has no notes field.
  - The list shows every student on the instance (shared across all teachers), not "my" students. There is no search, filter or class column.
  - Creating one student at a time is the only option (no bulk import).
  - For minors the next step (open the student, record consent, activate) is only mentioned in the status message.

## 10. Student detail (`/students/:studentId`)

- **Who**: teacher.
- **How you get here**: a name in the Students list, the class member table, the run roster, or the run's enrolled-students table.
- **Purpose**: edit a student's basics and manage their invitation, consent and activation.
- **Sections in order**:
  1. Back link "All students". Error: "The student could not be loaded."
  2. Heading: the student's name. "State: **Active**" (or another state).
  3. Edit form (the same component as "New student", including the notes note): "Name", "Email", "Their language", "Minor…" checkbox, button "Save". Outcomes: "Saved." / "Saved. The invitation sent to the previous email no longer works; resend it to the new one." / "Saved. As a minor without a recorded guardian's consent, the student is deactivated until you record it."
  4. **"Classes"**: a list of class links, or "Not in any class."
  5. **"Guardian consent"** (minors only):
     - Either "No guardian consent is recorded. The account cannot be activated until it is." or "Recorded on {at}, attested by {teacher}." plus the note.
     - Required checkbox "I confirm that a legal guardian of this student has agreed to the account and to the processing of the student's data in Myteacher."
     - "Note (optional)" textarea, button "Record consent".
     - Outcomes: "Consent recorded." / "Consent recorded. You can activate the account now."
  6. Action row:
     - Invited only: "Resend invitation" and "Revoke invitation".
     - Always: one toggle button labelled "Activate" (awaiting consent) / "Reactivate" (inactive) / "Deactivate". **No confirmation.**
     - Outcomes: "The invitation link no longer works. Resend it to give the student a new one." / "The account is deactivated, so no invitation was sent. Reactivate it first." / "A minor's account can be activated only once a guardian's consent is recorded."
- **Confusing points**:
  - The state is plain text, not a badge.
  - For minors the sequence is record consent, then press "Activate", then (presumably) an invitation is sent. That sequence is spread over two separate places, and the Activate button sits below the consent form, far from the state line.
  - "Revoke invitation" and "Deactivate" look exactly like "Resend invitation".
  - There is no view of the student's work or results across runs here.

## 11. Classes list (`/classes`)

- **Who**: teacher.
- **How you get here**: the "Classes" nav item.
- **Purpose**: list classes and create one.
- **Sections**:
  1. Heading **"Classes"**. Table columns: "Class name" (link) | "Students" (member count). Empty: "No classes yet." Error: "The classes could not be loaded."
  2. **"New class"** form: "Class name" (placeholder "2.B 2026/27"), button "Create class". It navigates to the new class. Errors: "Another class already has this name." / "The request failed. Try again."

## 12. Class detail (`/classes/:classId`)

- **Who**: teacher.
- **How you get here**: the Classes list, a newly created class, a student's class list, or a run's enrolled classes.
- **Purpose**: rename the class and manage its members.
- **Sections**:
  1. Back link "All classes". Heading: the class name.
  2. Rename form: "Class name" (pre-filled), button "Rename".
  3. **"Members"** table: "Name" (link) | "Email" | "State" | "Actions" (button "Remove from class", **no confirmation**). Empty: "No students in this class yet."
  4. Add form: "Add a student" select ("Choose a student…", listing "Name (email)" of every student not yet in the class), button "Add to class" (disabled when nobody can be added).
  5. Errors: "Another class already has this name." / "The request failed. Try again."
- **Confusing points**:
  - Students are added one at a time from a long dropdown of all instance students.
  - A student must first be created on the Students page, so there is no "create and add to this class" shortcut.
  - The rename form is the first thing on the page even though renaming is rare.

## 13. Courses list (`/courses`)

- **Who**: teacher.
- **How you get here**: the "Courses" nav item. After a transfer of ownership that leaves you no right, the app redirects here.
- **Purpose**: list your own and shared courses and create one.
- **Sections**:
  1. Heading **"Courses"**. Table columns: "Course name" (link) | "Subject" | "Your access" ("Owner" / "Can view" / "Can view and fork" / "Can edit"). Empty: "No courses yet." Error: "The courses could not be loaded."
  2. **"New course"** form: "Course name", "Subject", "Language taught" (select; first option "Not a language course"), "Language of explanations" (select, required), note "Spanish grammar can be explained in Czech: the two languages are set separately.", button "Create course". It navigates to the new course. Error: "The request failed. Try again."
- **Confusing**: nothing says that the course is a reusable plan and that delivery to students happens through a run.

## 14. Course detail (`/courses/:courseId`)

This is the longest and most overloaded page.

- **Who**: teacher with any access. Viewers see a read-only version.
- **How you get here**: the Courses list, a new course, "Course: {name}" on a run page, the course-name back link on a topic page, or after forking.
- **Purpose**: everything about one course: basics, sharing, the AI interview, brief, runs, topics and sources.
- **Sections in page order**:
  1. Back link "All courses". Error: "The course could not be loaded."
  2. Heading: the course name.
  3. Notes (muted): "You can view this course but not change it." (read-only) and "This course is a copy of another course. It does not follow changes to it." (fork).
  4. Action row:
     - Button "Make my own copy" (when you may fork). It navigates to the copy. Error: "The copy could not be made. Try again."
     - Link "Export the course" (downloads an archive).
     - Note: "An archive of the course with its topics, concepts, documents, material and source files, as a backup. Who it is shared with is not in it."
  5. Button **"Share the course"** (owner only). It opens the **Course access** inline panel (section 15) in place.
  6. **Basics form**: "Course name", "Subject", "Language taught", "Language of explanations", button "Save course". Result: "Course saved." / "The change could not be saved." Viewers see the fields disabled and no button.
  7. **"Teacher interview"** (editors only). An AI chat-like panel (section 16).
  8. **"Course brief"** (section 17). Intro: "Everything generated for this course is based on the brief. Each field is saved on its own."
  9. **"Runs"**:
     - Intro: "A run is one delivery of the course to classes and students. Only its teacher sees it."
     - A list of runs: link "{run name}" plus "Students: {count}". Empty: "You have not started a run of this course yet." Error: "The runs could not be loaded."
     - Editors: form "Run name", button "Start a run" (navigates to the new run). Error: "The run could not be started."
  10. **"Topics"** (section 18).
  11. **"Sources"** (section 19).
- **Confusing points**:
  - Unrelated concerns share one scroll: admin-ish actions (fork, export, share), setup (basics, interview, brief), delivery (runs), and content (topics, sources).
  - The order contradicts the workflow. **Runs come before Topics and Sources**, but a run is useless until topics have approved maps and material. Sources come **last**, yet the interview asks about sources and generation cites them, so they should be added early.
  - Reference documents and classroom material (the actual output) are not on this page at all. They are one level down, inside each topic's "Concept map" page, and the link label "Concept map" does not suggest that.
  - Nothing shows overall progress (which topics are ready, which have material).
  - "Export the course" is a link that looks different from the buttons next to it.
  - Every section is a flat form separated by thin rules, so the page is very long with little hierarchy.

## 15. Course access panel (inline on the course page)

- **Who**: owner only.
- **How you get here**: "Share the course".
- **Purpose**: share the course with other teachers and transfer ownership.
- **Content** (bordered box, heading "Course access"):
  - Intro: "Teachers you name here see the course; an editor also changes it, but only you manage this list and the ownership."
  - Access table: "Teacher" (email) | "Right" (select per row: "Can view" / "Can view and fork" / "Can edit"; saves on change) | button "Remove" (**no confirmation**). Empty: "The course is shared with nobody yet." Error: "The access list could not be loaded."
  - **"Share with a teacher"** form: "Teacher's email", "Right" select, button "Give access". Errors: "No teacher has this email." / "This teacher already owns the course." / "The access list changed meanwhile and was reloaded."
  - **"Ownership"** form: "New owner's email", "What you keep" (select: "No right" / the three rights), button "Transfer ownership".
    - Second step: "{email} will own the course and you will keep no right to it." (or "…keep this right: {right}."), then a red "Confirm the transfer" and "Cancel".
  - Button "Close".
- **Confusing**: it is styled like the erasure dialog (red border) although sharing is not dangerous. The dangerous ownership transfer sits in the same box as routine sharing.

## 16. Teacher interview panel (course page) and Topic interview panel (topic page)

The same component is used with different texts.

- **Who**: editors.
- **Purpose**: the AI asks rounds of questions and fills in the course brief (course interview) or the topic's additions (topic interview).
- **States**:
  - **Never started**: note "Before generating anything, the assistant asks about your students, their level, your goals, timeframe, sources, exercise types and tone, and fills in the brief. You can end it at any time and edit the brief by hand." Button "Start the interview". Topic version: intro "The assistant asks a few questions about what this topic adds to the course brief: its goals, what students already know, what to stress. Then it proposes the concepts, unless the map already has some. You can end it at any time and edit the additions by hand." Button "Start the topic interview".
  - **Working** (job): spinner "The assistant is working…".
  - **Job failed**: failure box and button "Try again".
  - **Open round** (form, heading "Round {n}"): for each question a bordered fieldset. The legend is "{n}. {question}", followed by the muted "Recommended: {answer}", a textarea "Your answer" and a button "Use the recommendation" (copies the recommendation into the textarea). Then the note "A question you leave empty stays open." and the button "Send answers".
  - Between rounds: note "{count} rounds so far."
  - Always while active: button "End the interview".
  - **Finished**: "The interview is finished and the brief was filled in. You can still edit every field." plus the AI summary. If no sources were offered: "You offered no sources, so content will be generated without sources and marked as unsourced." Topic version: "The interview is finished and the topic's additions were filled in. You can still edit them."
  - **Ended early**: "The interview was ended early. The brief stays as it is." (topic: "…The additions stay as they are.")
  - After finished or ended: button "Start a new interview".
  - Errors: "The interview could not be loaded." / "The interview changed meanwhile and was reloaded." / no-key failure box.
- **Confusing points**:
  - The number of rounds is unknown, and there is no progress indication.
  - "Use the recommendation" appears once per question; there is no "accept all recommendations".
  - "End the interview" is always visible next to "Send answers", with the same style, so it is easy to click by mistake.
  - Once the interview finishes, the brief below changes silently, with no highlight of what was filled.
  - The finished topic interview automatically starts the concept-map proposal, but the panel does not say so.

## 17. Course brief (course page)

- **Who**: editors edit; viewers see it read-only.
- **Purpose**: the settings that drive all AI generation for the course.
- **Content**:
  - Six text fields. Each is its own mini-form: a textarea with a placeholder hint and its own "Save" button, followed by the inline status "{field} saved.":
    - "Audience" (hint "Who the students are: age, year, background")
    - "Level" ("For example A2, or second year of secondary school")
    - "Goals" ("What the students should be able to do by the end")
    - "Timeframe" ("For example two lessons a week, September to June")
    - "Tone" ("How explanations should sound")
    - "Notes" ("Anything else the assistant should know")
  - Fieldset **"Preferred exercise types"**: checkboxes "Multiple choice", "Short answer", "Cloze", "Matching", "Ordering", "Selection in text", "Free text", "Translation". These save immediately on tick.
  - Fieldset **"Forbidden exercise types"**: the same list. A type ticked in one list is disabled in the other. These also save immediately.
  - Sub-heading **"Defaults for lessons"**:
    - "Feedback" select: "After each exercise" / "After the whole lesson"
    - Checkbox "One retry with a hint after a wrong answer"
    - Checkbox "Wrong answers come back in a second round"
    - All save immediately.
  - Errors: "A type cannot be both preferred and forbidden." / "The change could not be saved."
- **Confusing points**:
  - Mixed save models on one card: six separate "Save" buttons for the text fields, while checkboxes and selects save instantly. It is unclear what is saved at any moment.
  - "Defaults for lessons" (feedback mode) overlaps with the release settings on the run page, which also set "Feedback" per release. The relation between the two is never explained.

## 18. Topics section (course page)

- **Who**: editors edit; viewers get a plain numbered list.
- **Purpose**: define the course's topics in teaching order and see the concept-map status of each.
- **Content** (heading "Topics"):
  - Empty: "No topics yet." Error: "The topics could not be loaded."
  - **Editor view**: a numbered list. Each topic has:
    - A name input (labelled "Name of topic {n}") with a "Rename" button
    - Checkbox "Diagnostic lesson wanted" (saves immediately)
    - Map status (muted): "No concept map yet." / "Draft concept map with {count} concepts." / "Concept map approved." While the AI proposes: spinner "The assistant is proposing concepts…". On failure: the failure box.
    - Actions: link **"Concept map"** (to the topic page), "Move up", "Move down", "Remove". Remove is two-step: "Remove {name} for good" (red) and "Keep".
  - **Viewer view**: a numbered list of topic-name links plus " (diagnostic lesson wanted)" and the map status.
  - Below the list (editors, when topics exist): note "The assistant proposes a concept map for every topic that has none to review yet, so that you can review them all at once." and button **"Prepare all topics"**. Result: "Proposing concepts for {started} topics; {skipped} skipped." or the no-key failure box.
  - "New topic" input with button "Add topic".
  - Errors: "A topic needs a name." / "The topics changed meanwhile and were reloaded." / "Material of this topic was released to students, so the topic stays." / "The change could not be saved."
- **Confusing points**:
  - Every topic row is an always-on edit form (rename input plus four buttons), which makes the list heavy. Reordering is by buttons only.
  - The only way into a topic's content (interview, concepts, documents, material) is a small link labelled "Concept map", which undersells what is behind it.
  - The status shows only the concept map, not whether documents or material exist.
  - "Diagnostic lesson wanted" has no explanation.
  - "Prepare all topics" sits between the list and the "New topic" form, so it is easy to miss.

## 19. Sources section (course page)

- **Who**: editors edit; viewers can read.
- **Purpose**: upload the textbook, handouts and web pages the AI grounds its content in, and check the extracted text.
- **Content** (heading "Sources", intro "Your textbook, handouts and notes. The assistant works from the text read from them, which you can check here."):
  - Empty: "No sources yet." Error: "The sources could not be loaded."
  - **One item per source**:
    - Name (h3), muted "{kind}, {size}" (kind: "PDF" / "Text" / "Image" / "Web page")
    - While extracting: spinner "Reading the text…" (files) or "Fetching the page…" (web pages)
    - Failure box. Source-specific failure texts:
      - "No text was found. A scan or a photo has text only once read with OCR."
      - "The file could not be read; it may be damaged. …"
      - "The page could not be reached. Check the address, then try again."
      - "The site answered with an error instead of the page. Check the address."
      - "The address leads to a file, not a web page. Download it and upload it as a file instead."
      - "The page is larger than 5 MB."
      - "The address leads into a local network, which the app never fetches."
      - Web page with no text: "The page has no text until the browser builds it. Print the page to PDF and upload the file, or paste its text below."
    - Result line: "{count} characters read from the file." / "{count} characters read by the assistant." / for pages: "Snapshot taken {date}: {count} characters. The page is not fetched again."
    - Actions:
      - "Show the text" / "Hide the text" (toggles a preformatted box with the extracted text)
      - Link "Open the original" (file) or "Open the page" (URL)
      - "Fetch again" (a page whose snapshot failed)
      - "Read with OCR" (a PDF or image not yet read by OCR, or whose read failed)
    - Checkbox "Visible to students" (saves immediately).
    - Two-step "Remove": "The file and its text will be removed from the course." then a red "Remove for good" and "Cancel".
    - Per-item error: "The change could not be saved."
  - **"Add a source"** form: "File" (PDF, TXT, MD, PNG, JPEG, WebP), checkbox "Read images and scanned PDFs with the assistant (OCR, paid by your AI provider key)", button "Upload".
  - **"Add a web page"** form: note "The page is fetched once; its text stays as it was then, even when the page changes." Fields "Web page address" and "Name (optional)", button "Take a snapshot".
  - **"Paste text"** form: note "For a page whose text the snapshot could not read, or any other text: paste it here." Fields "Name" and "Text" (textarea), button "Add the text".
  - Section errors: "Only PDFs, text files and images (PNG, JPEG, WebP) can be sources." / "The source is larger than 20 MB." / "The file is empty." / "OCR is paid by your AI provider key; add one in Settings first." / "The text is being read already." / "Enter a full web address starting with https://" / "The snapshot of this page is taken already and does not change."
- **Confusing points**:
  - Three separate add-forms are stacked permanently at the bottom of an already long page.
  - The OCR checkbox must be decided before uploading, and it is a cost decision.
  - "Visible to students" has no explanation of where students would see a source; the student UI shows no sources anywhere.
  - Sources are course-wide, but they sit at the bottom of the course page, after Runs and Topics.

## 20. Topic page / "Concept map" (`/courses/:courseId/topics/:topicId`)

The second overloaded page: all content generation happens here.

- **Who**: teacher with access to the course. Editing requires edit rights.
- **How you get here**: the "Concept map" link on a topic row (editors), or the topic-name link (viewers).
- **Purpose**: define what the topic teaches (additions, concept map), then generate reference documents and classroom material from the approved map.
- **Sections in page order**:
  1. Back link showing the **course name** (fallback "Back to the course"). Heading: the **topic name**.
  2. **"Topic interview"** panel (editors; section 16).
  3. **"What this topic adds to the brief"**:
     - Editors: intro "The topic follows the course brief; write here only what is specific to it. The concept map proposal reads both." Four textareas: "Goals of the topic", "What students already know", "What to stress or leave out", "Notes". One button "Save additions". Result: "Saved." / "The change could not be saved."
     - Viewers: a definition list, or "This topic adds nothing to the course brief."
     - Note: this form has one Save button for all fields, unlike the course brief with one button per field.
  4. **"Concepts"**:
     - State note: "This topic has no concepts yet. Let the assistant propose them, or add them by hand." / "Draft: not tracked until you approve it." / "Approved: these concepts are tracked."
     - Job spinner "The assistant is working…" or a failure box.
     - Button "Propose concepts" / "Propose again" (only while the map is a draft that was never approved). Note: "A new proposal replaces the concepts below."
     - **Concept list** (numbered). In an editable draft each concept is a form:
       - Checkbox "Choose {name} to merge"
       - "Name", "Description"
       - Fieldset "Requires" with a checkbox "Requires {other}" for every other concept
       - Buttons "Save", "Split", "Remove". Remove is two-step: red "Remove {name} for good" and "Keep".
       - **Split** opens an inline form with "Name of part 1/2", "Description of part 1/2" and buttons "Add a part", "Split", "Cancel".
     - Read-only view (approved, or viewer): name, description and "Requires: {names}".
     - **Merge form** (appears when 2 or more concepts are ticked): heading "Merge {count} concepts", "Name of the merged concept" (pre-filled "A / B"), "Description of the merged concept", button "Merge".
     - **"New concept"** form: "Name", "Description", button "Add concept".
     - Approve: note "Approving decides exactly which concepts are tracked for every student. You can reopen the map later." and button **"Approve the map"**.
     - When approved: button "Reopen for changes".
     - Errors: "A concept needs a name." / "A map without concepts cannot be approved." / "The prerequisites would go round in a circle." / "The map changed meanwhile and was reloaded. Check it again." / no-key failure box.
  5. **"Diagnostic lesson"** (only when the AI made an offer): the AI's reason text, then buttons "Start with a diagnostic lesson" and "Decline". Results: "Accepted: the topic starts with a diagnostic lesson." / "Declined. You can still ask for a diagnostic lesson among the course's topics." / "The offer changed meanwhile and was reloaded."
  6. **"Reference documents"**:
     - List of document cards. Each card has:
       - Title (or kind name), muted "{kind}, version {n}"
       - Job spinner or failure box
       - Actions: link "Preview and print" (to `/preview/.../documents/:id`), "Try again" (failed generation), "Edit", "Keep as it is", "Discard" (two-step: red "Discard for good" and "Cancel")
       - "Noted: kept as it is." after Keep
       - The **Edit** inline editor: "Title", "Passage 1…n" (Markdown textareas), buttons "Save as a new version" and "Cancel". Conflict: "Someone saved a newer version meanwhile. Your text is kept below: copy what you need, cancel, and edit the newer version."
     - Empty: "No documents yet."
     - Generate form (editors, map approved): "Kind" select ("Vocabulary sheet" / "Grammar cheat sheet" / "Glossary"), button "Generate". If the map is not approved: note "Approve the concept map to generate documents from it."
     - Errors: "The concept map is no longer approved. Approve it, then generate again." / "A citation points at a source that is no longer in the course." / "The document changed meanwhile and was reloaded."
  7. **"Classroom material"**:
     - List of material cards. Each card has:
       - Title (fallback "Classroom material"), muted "Version {n}"
       - Muted history: "Asked for: "{instruction}"" or "Reworked from version {previous}: "{instruction}""
       - Muted audience: "For the whole class" or "For {names}"
       - Job spinner or failure box
       - Actions: link "Preview and print", "Try again" (failed first generation), "Keep as it is", two-step "Discard"
       - "Noted: kept as it is."
       - **Rework** form: "Instruction" textarea (placeholder "For example: fewer exercises, more on irregular verbs."), button "Rework"
     - Empty: "No classroom material yet."
     - Generate form (editors, map approved):
       - Fieldset "For chosen students (optional)" with a checkbox for **every student on the instance**
       - Note "Until students' progress is tracked, material for chosen students is the same as for the whole class."
       - "Instruction (optional)" textarea (placeholder "For example: five exercises, only fill in the gaps.")
       - Button "Generate material"
       - If the map is not approved: "Approve the concept map to generate material from it."
     - Errors: "The concept map is no longer approved. …" / "A chosen student is no longer on the instance." / "The material changed meanwhile and was reloaded."
- **Confusing points**:
  - Seven sections of very different natures share one page: interview, additions, concept editing, diagnostic offer, documents, material. The page title is the topic name but the nav link says "Concept map".
  - The steps are ordered (interview, additions, concepts, approve, generate), but nothing numbers them or shows which step is done.
  - Documents and Material are visible before approval, each with a small muted note. The key action, "Approve the map", sits at the bottom of a potentially long concept list.
  - "Keep as it is" gives no clue what it means or what happens if you do not press it. It appears to acknowledge an AI draft, but the consequence is not explained.
  - Material cards have no Edit (only Rework by instruction). Documents have both Edit and no Rework. The two models are inconsistent.
  - The material "For chosen students" list includes every student on the instance, not the students of a run, and the adjacent note says the choice currently makes no difference.
  - Nothing links from a finished material to "release it": the release happens on a run page reached via Course, then Runs, then a run.
  - The concept editor shows every other concept as a prerequisite checkbox. For 15 concepts that is 14 checkboxes per concept, 210 in total.
  - Merge is triggered by ticking checkboxes whose label reads "Choose X to merge"; the merge form appears below the list, far from the ticks.

## 21. Lesson player (used in previews, student work and teacher review)

- **Where**: sample preview (`/preview/:lessonId`), material preview, student work page (`/work/:id`), and read-only in the teacher's student-results page.
- **Structure** (an `<article>`, grid with large gaps):
  1. Lesson title (h1).
  2. Blocks in order:
     - **Explanation block**: rendered Markdown (no images, no raw HTML).
     - **Passage block**: bordered box with a title (fallback "Text") and Markdown. Exercises about it carry a small link at the top: "About the text: {title}" / "About the text above" (jumps to the passage).
     - **Exercise** (bordered fieldset, `ExerciseFrame`): bold prompt (Markdown), the type-specific body, then:
       - Immediate feedback mode: a per-exercise "Confirm" button (shows "Checking…" while it runs), disabled until the answer is complete and not identical to an earlier wrong try.
       - Error: "The answer could not be checked. Try again."
       - Result area:
         - Verdict "Correct" (green) / "Not quite" (red) / "Not quite. Try once more." (red, retry) / "Awaiting assessment" (muted, open answers)
         - **Hint** box (accent left border, heading "Hint") shown when retrying, or up front for open answers and second-round short answers
         - **Solution** box (heading "Solution" plus the canonical answer and explanation) once the exercise is locked and the release shows solutions
       - Teacher review (after publication): accent-bordered block "**Your teacher's assessment**: {percent} %", then the feedback and "Why: {reason}".
     - **Unsupported type** (dashed box): "**Span highlighting / Table fill / Numeric answer / Listening / Custom exercise**: not supported yet" plus the prompt.
  3. **At-the-end mode**: at the bottom of the round, "{count} unanswered" and a "Submit answers" button (disabled until everything is answered). Error: "The answer could not be checked. Try again."
  4. **Second round**: after the first round is complete with wrong closed answers, the intro "Some exercises were not right on the first try. They come back once more, in a new order." and the button "Start the second round" (error "The second round could not be loaded. Try again."). Then a section "Second round" (h2) with the failed exercises reshuffled, plus its own submit in at-the-end mode.
  5. **Finished** (green box): "Lesson finished", "{correct} of {total} right in the first pass.", "{count} written answers await your teacher."
- **Retry rule**: at most 2 tries per closed exercise in immediate mode. A wrong first try shows "Not quite. Try once more." and the hint. After the second try the exercise locks and the solution shows. Wrong options already tried are disabled.
- **Exercise renderers**:
  - **Multiple choice**: radio-style option rows (large tap targets). They turn green or red for correct and incorrect; already-tried wrong options are disabled.
  - **Short answer**: one text input ("Your answer"). Enter confirms. The input is coloured green or red after assessment.
  - **Cloze**: sentence with inline text inputs ("Gap n"), or with a **"Word bank"**. With a word bank you tap a word, then a gap; tapping a filled gap returns the word. Gaps are dashed buttons. Each gap is coloured correct or incorrect individually.
  - **Matching**: two columns, "Match these" (left, shows the chosen partner beneath in muted text or "…") and "With these" (right, shuffled; paired items turn muted). Tap left, then right; tap a pair to undo.
  - **Token ordering**: a dashed "Your order" area (empty text "Tap the words in order.") and a "Words to place" pool with tokens as buttons, plus an "Undo" text button. Tap a placed token to remove it. Positions are coloured after assessment.
  - **Token selection** ("Tap to select"): each letter, syllable or word is a large toggle button. "Select up to {max}." when there is a limit; with a limit of 1, a tap moves the selection.
  - **Free text**: textarea "Your answer" with the counter "{count} / {max} characters · at least {min}". The hint is shown up front. The answer is sent once, then "Awaiting assessment".
  - **Translation**: like free text, plus the muted "From {source} into {target}" and the source text in a blockquote.
- **Confusing points**:
  - In immediate mode each exercise has its own Confirm, and there is no overall progress indicator (e.g. "3 of 10") or sticky submit.
  - In at-the-end mode the submit button is at the very bottom and stays disabled with only a "{n} unanswered" hint. It does not say which exercises are missing.
  - The second-round intro appears only at the bottom of a long page.
  - There is no explicit "you're done, go back" link after finishing.
  - Colour is the main correctness signal on items: gaps, tokens and matching pairs have no icons.

## 22. Student work page (`/work/:releaseId`)

- **Who**: student.
- **How you get here**: a title link in "Your work" on the student home.
- **Purpose**: do a released lesson. Opening it starts or resumes an attempt; progress (drafts) is saved on the server, so the student can continue on another device.
- **Layout**:
  1. Muted line "{topic} · {run} · Due {date}".
  2. Retraction notice (alert): "Your teacher withdrew this work: {reason}" / "Your teacher retracted your attempt: {reason} You can start again." / "Your teacher retracted your attempt: {reason}".
  3. "Attempt {n}" (when n > 1) and "Submitted late" (muted).
  4. The **Lesson player** (section 21) in the release's feedback mode, with its title as the page's h1.
  5. Refusal alerts: "The due date has passed and your teacher does not accept late work." / "This work can be done only once." / "The work could not be opened. Try again."
  6. After a completed pass, when repeated attempts are allowed and the due date has not passed: button "Start another attempt".
  7. Loading: "Loading…". Errors: "This work is not for you, or it is no longer available." / "Your work could not be loaded."
- **Confusing points**:
  - There is no back link to Home or "Your work" (only the nav "Home").
  - An attempt starts automatically on opening, with no "Start" screen summarising the rules (feedback mode, attempts, due date, late policy, whether solutions will be shown).
  - After finishing, the student does not see when teacher assessments of open answers will arrive. The page must be reopened to see a published "Your teacher's assessment".
  - "Start another attempt" appears at the very bottom, after the lesson.

## 23. Run page (`/runs/:runId`)

- **Who**: the run's teacher.
- **How you get here**: a run link in the course page's Runs section, or automatically after "Start a run". Also "Back to {run}" from release results.
- **Purpose**: manage who is in the run and what is released to them.
- **Sections in page order**:
  1. "Course: {course name}" (link). Error: "The run could not be loaded."
  2. Heading: the run name. Rename form: "Run name" and "Rename".
  3. **"Releases"** (section 24).
  4. **"Roster"**: note "The students of the run now, from the current members of its classes; deactivated students and minors awaiting consent are left out until they can sign in." Table columns: "Name" (link) | "Email" | "Enrolled through" (class names and/or "directly"). Empty: "No students in this run yet."
  5. **"Enrolled classes"**: table columns "Class name" (link) | "Students" | "Actions" (button "Remove", **no confirmation**). Empty: "No classes enrolled." Form: "Enrol a class" select ("Choose a class…"), button "Enrol class".
  6. **"Enrolled students"** (students enrolled on their own): table columns "Name" | "Email" | "State" | "Actions" ("Remove"). Empty: "No students enrolled on their own." Form: "Enrol a student" select ("Choose a student…"), button "Enrol student".
  7. Error: "The request failed. Try again."
- **Confusing points**:
  - **Releases come before enrolment** on the page, but a new run has nobody in it. The first thing a teacher must do (enrol a class) is at the bottom.
  - Three tables (Roster, Enrolled classes, Enrolled students) describe overlapping sets of people. The difference between "Roster" and "Enrolled students" is subtle.
  - There is no nav entry and no list of all runs across courses. To come back to a run you must go through Courses, the course, then Runs.
  - Removing a class removes its students from the run with one click.

## 24. Releases section (on the run page)

- **Purpose**: list the releases of this run and release a new material version.
- **Releases table** columns: "Material" (link to the results; " · Retracted" when retracted) | "Topic" | "Version" | "For" ("Whole run" or student names) | "Feedback" ("Immediate" / "At the end") | "Due" (date or "None") | "After the due date" ("Accepted, marked late" / "Refused") | "Attempts" ("One" / "Repeated, the last counts") | "Solutions" ("Shown" / "Hidden"). Empty: "Nothing released yet." Error: "The releases could not be loaded."
- **"Release material"** form (h3):
  - If there is no material: "The course has no classroom material to release yet."
  - "Material" select ("Choose a material…"; options "Title (Topic)"). The rest appears after choosing:
    - "Version" select (latest pre-selected)
    - Radios "Whole run, including students who join later" / "Chosen students". Chosen students shows a checkbox per roster student, pre-ticked with the material's target students.
    - "Feedback" select ("Immediate" / "At the end"; default Immediate)
    - "Due" (datetime-local, optional)
    - "After the due date" select ("Accepted, marked late" / "Refused")
    - "Attempts" select ("One" / "Repeated, the last counts")
    - Checkbox "Show solutions after submission" (default on)
  - Button "Release" (disabled until a material is chosen, and at least one student when "Chosen students").
  - Errors: "The material could not be released." / "The material or its version is gone; reload the page." / "Choose students who are in the run now." / "The due date has passed already."
- **Confusing points**:
  - The 9-column table is squeezed into a 42rem column, so it scrolls horizontally.
  - The release defaults ignore the course brief's "Defaults for lessons" (feedback mode). There is no retry-with-hint or second-round option here, although the brief has them.
  - Releasing has no confirmation or summary, although students are notified or affected immediately.
  - Nothing shows how many students have started or submitted a release. You must open each release.

## 25. Release results (`/runs/:runId/releases/:releaseId`)

- **Who**: the run's teacher.
- **How you get here**: a material title in the run's Releases table.
- **Purpose**: see class results per exercise, assess open answers with the AI, publish results, and retract the release.
- **Sections in page order**:
  1. Back link "Back to {run name}". Heading: the release title, then the muted topic.
  2. Status "Retracted: {reason}" if retracted.
  3. **"Open answers"**:
     - Line: "Waiting for assessment: {waiting} · assessed by the assistant: {assessed} · needing your assessment: {flagged}"
     - Buttons "Assess open answers" (disabled when nothing is waiting) and "Publish results" (disabled when nothing is unpublished)
     - Muted: "Not shown to students yet: {count}"
     - Job spinner "The assistant is assessing the answers…" or a failure box
     - Refusals: "Add your key in the settings to assess with the assistant. [Settings]" / "No open answer waits for assessment." / "The answers are being assessed already." / "The answers could not be assessed. Try again." / "The results could not be published. Try again."
     - Result: "Published to students: {count}"
  4. **"Results"** (students × exercises): columns "Student" (link to the student's results; muted "No longer in the run" when unenrolled) | "State" ("Not started" / "In progress" / "Submitted", plus " · Late", " · Attempts: {n}") | one narrow column per exercise, headed "1", "2", … (the prompt is in the hover title). Cells hold marks: ✓ Right, ✗ Wrong, … Waiting for assessment, – Not answered. Empty: "Nobody has this release."
  5. **"Exercises"** summary table: "#" | "Prompt" | "Wrong" | "Right" | "Waiting" | "Not answered".
  6. **"Retract the release"** (if not retracted): note "Retracting takes the release from every student and voids their attempts; their answers stay here. Release a corrected material anew.", input "Reason for the students", button "Retract the release". **Single step, same blue style as everything else.** Error: "The retraction failed. Try again."
- **Confusing points**:
  - "Needing your assessment: {flagged}" does not say where to do that. The teacher must open each student's page and find the table under the read-only lesson.
  - "Publish results" publishes everything at once, with no preview of what students will see.
  - Exercise columns are numbers only; the prompt shows only on hover, which does not work on touch devices.
  - The result marks are plain glyphs; `data-state` exists but no colour styling was found.
  - A destructive retraction sits at the bottom with no confirmation and no danger styling.

## 26. Student results (`/runs/:runId/releases/:releaseId/students/:studentId`)

- **Who**: the run's teacher.
- **How you get here**: a student name in the release results table.
- **Purpose**: see one student's attempts in detail, override the AI scores and retract an attempt.
- **Sections in page order**:
  1. Back link "Back to the results". Heading: the student name. Muted "No longer in the run" if applicable.
  2. **Retract attempt** form (when any attempt is not retracted): note "Retracting voids the attempt being worked on, or else the one that counts; the answers stay here and the student can start again.", "Reason for the students", button "Retract the attempt". **Single step.**
  3. For each attempt (latest first) a section:
     - "Attempt {n}" (h2), muted "Started {date} · Submitted {date}" (or "Not submitted yet") " · Late"
     - "This attempt counts." when applicable
     - "Retracted: {reason}" when applicable
     - The **read-only Lesson player** with the student's answers, verdicts, solutions and published reviews
     - **Assessments table** (only when there are assessed open answers): "Exercise" (number) | "Score" ("{n} %" or "–") | "Assessment" (text lines: "The assistant could not assess it; score it yourself." / "Waiting for the assistant." / the AI justification / "For the student: {feedback}" / "Your reason: {reason}" / muted "Not published yet") | "Your score" (inline form: "Score (%)" number 0–100, "Reason" (required), button "Save"; or "Not submitted yet" for unsubmitted attempts). Error: "The score could not be saved."
  4. Empty: "No attempt yet."
- **Confusing points**:
  - The override table sits **below** a full read-only lesson. To connect "Exercise 4" in the table with the answer, the teacher scrolls up and counts exercises; the player has no exercise numbers.
  - The retraction form is at the top, the most prominent spot, above the attempts, with the same styling as a harmless action.
  - After saving overrides there is no "Publish" here. The teacher must go back to the release results and press "Publish results".
  - There is no next/previous student navigation, so assessing a class means back, next name, back, and so on.

## 27. Reference document preview (`/preview/courses/:courseId/topics/:topicId/documents/:documentId`)

- **Who**: teacher (API access). Outside the Shell.
- **How you get here**: "Preview and print" on a document card (same tab).
- **Layout**:
  - Header: caption "DOCUMENT PREVIEW" and the "Language" select. Toolbar: button "Print".
  - The document: title (h1); red note if some passages lack sources ("1 passage rests on no source. Check it before you print." / "{count} passages rest on no source. …"); passages (Markdown) with superscript citation numbers, or a red "Unsourced" tag and a red left border; footnotes list ("Sources"): "{source name}, {location}" or "A removed source, {location}".
  - Errors: "No document to preview here." / "The documents could not be loaded." Loading: "Loading the lesson…" (lesson wording reused).
- **Confusing**: no back link or nav. The only way back is the browser Back button.

## 28. Classroom material preview (`/preview/courses/:courseId/topics/:topicId/materials/:materialId`)

- **Who**: teacher. Outside the Shell.
- **How you get here**: "Preview and print" on a material card.
- **Layout**:
  - Header: caption "CLASSROOM MATERIAL" and the "Language" select. Toolbar: button "Print".
  - The Lesson player (interactive, fixed seed), then the **Answer key** section (always shown here, printed on its own page). Each entry shows the prompt (and, for translations, the source text), then either the solution in bold plus the explanation, or for open answers "Model answer: **…**", "Assessed against:" and the rubric criteria with "({points} pt)", or "No answer key for this exercise type yet."
  - Errors: "No classroom material here." / "The classroom material could not be loaded."
- **Print styling**: buttons, radios, feedback, hints, the second round and the finished box are hidden. Inputs become underlines and tokens become outlined boxes. MC options get "○" bullets. The answer key starts on a new page.
- **Confusing**: no way back. The answer key is always shown on screen, unlike the sample preview, which has an "Include answer key" toggle. The preview is interactive, so a teacher can "answer" exercises by accident while previewing.

---

# Part 2: Navigation map

## Top navigation per role

| Role | Nav items (in order) |
|---|---|
| Anonymous | none. Sign-in page links to "Forgot your password?" |
| Student | Home, Settings |
| Teacher | Home, Courses, Students, Classes, Settings |
| Admin (teacher + admin role) | Home, Courses, Students, Classes, Settings, Administration |

The header on every Shell page also holds: "Signed in as", role chips, the Language select and "Sign out".

## Screen link tree

```
/sign-in ──"Forgot your password?"──> /forgot-password ──"Back to sign-in"──> /sign-in
(email) /invitation#token ──submit──> /   (invalid link: "Go to sign-in")
(email) /reset-password#token ──submit──> /   (invalid link: "Ask for a new link" -> /forgot-password)

Shell (nav on every page)
├── / Home
│   ├── teacher/admin: "Open the sample lesson" ──> /preview/es-ser-estar   (no way back)
│   └── student: "Your work" list ──> /work/:releaseId
│                                      └── (no back link; nav "Home")
├── /settings
│   └── (AI error messages everywhere link here: "Settings")
├── /admin  (admin)
│   └── Teachers | Email (SMTP) | Erasure of a student   (no outgoing links)
├── /students
│   └── name ──> /students/:id
│                 ├── "All students" ──> /students
│                 └── class name ──> /classes/:id
├── /classes
│   ├── "Create class" ──> /classes/:id (new)
│   └── name ──> /classes/:id
│                 ├── "All classes" ──> /classes
│                 └── member name ──> /students/:id
└── /courses
    ├── "Create course" ──> /courses/:id (new)
    └── name ──> /courses/:id
                  ├── "All courses" ──> /courses
                  ├── "Make my own copy" ──> /courses/:copyId
                  ├── "Export the course" ──> file download
                  ├── "Share the course" ──> inline Course access panel
                  │                           └── transfer with no right kept ──> /courses
                  ├── Runs: run name / "Start a run" ──> /runs/:runId
                  │     ├── "Course: X" ──> /courses/:id
                  │     ├── roster / enrolled student names ──> /students/:id
                  │     ├── enrolled class names ──> /classes/:id
                  │     └── Releases: material title ──> /runs/:runId/releases/:releaseId
                  │           ├── "Back to {run}" ──> /runs/:runId
                  │           ├── "Settings" (no key) ──> /settings
                  │           └── student name ──> /runs/:runId/releases/:releaseId/students/:studentId
                  │                 └── "Back to the results" ──> release results
                  ├── Topics: "Concept map" (or topic name) ──> /courses/:id/topics/:topicId
                  │     ├── course name ──> /courses/:id
                  │     ├── document "Preview and print" ──> /preview/courses/:id/topics/:t/documents/:d  (no way back)
                  │     └── material "Preview and print" ──> /preview/courses/:id/topics/:t/materials/:m  (no way back)
                  └── Sources: "Open the original" / "Open the page" ──> new tab
```

Structural observations:

- The **run** (where delivery and results live) is three levels deep: Courses, then the course, then Runs, then the run. Runs have no top-level entry or overview.
- **Material** is created at Course, then Topic ("Concept map"), then Classroom material. It is **released** at Course, then Runs, then Run, then Releases. The two places never link to each other.
- The teacher home has no links into work in progress.
- The three preview pages are dead ends.

---

# Part 3: End-to-end flows as the UI makes them today

⚠ marks a step where the UI gives no hint of what comes next, or where the next step lives somewhere else.

## Flow 1: Admin sets up email and invites a teacher

1. Admin signs in on `/sign-in` and lands on Home: heading "Myteacher" plus the sample-lesson link. ⚠ Nothing points to Administration or says that email is not configured.
2. Click nav **"Administration"**.
3. ⚠ The first section is "Teachers" with the invite form, but email must be set up first. Scroll past it to **"Email (SMTP)"**.
4. Fill in "Server", "Port", "Security", "Username", "Password", "Sender address" and click **"Save settings"**. The result "Settings saved." appears below both forms.
5. Optionally keep or change "Send a test email to" and click **"Send test email"**. Result: "The test email was sent to …" or "The test email was not sent: {error}".
6. Scroll back up to **"Teachers"**. Enter "Email of the new teacher", pick "Their language", click **"Invite teacher"**.
7. Result "Invitation sent to {email}." The table shows the row with state "Invited".
   - If SMTP was not configured: "The account was created, but the invitation was not sent: {error}". ⚠ The admin must fix SMTP and then press "Resend invitation" in the row.
8. The teacher gets the email, opens `/invitation#…`, sets a password (at least 12 characters, revealed only on error) with **"Set password and sign in"**, and lands on the teacher Home. ⚠ There is no onboarding.

## Flow 2: Teacher adds their AI key

1. ⚠ Nothing on Home mentions an AI key. The teacher typically discovers it when an AI action fails with "Add an AI provider key in Settings first. [Settings]", or by exploring.
2. Click nav **"Settings"** and scroll past "Interface language" and "Daily digest at" to **"AI providers"**.
3. In "Add a provider": choose "Provider", paste the "API key", leave "Strong model" and "Fast model" as recommended, click **"Add key"**.
4. A card appears with "Stored key: …xxxx". ⚠ The key is not tested automatically, so click **"Test key"** and expect "The key works."
5. ⚠ Nothing says "you can now go create a course".

## Flow 3: Teacher builds a course up to printable material

1. Nav **"Courses"**, then in "New course" fill in "Course name", "Subject", "Language taught", "Language of explanations" and click **"Create course"**. The app navigates to the course page.
2. ⚠ The course page shows many sections at once, with no numbered steps. From the top: fork/export, "Share the course", basics, **"Teacher interview"**, "Course brief", "Runs", "Topics", "Sources".
3. ⚠ Sources are the last section, but the interview asks about them. A teacher who wants grounded content should first scroll to the bottom, **"Sources"**:
   - "Add a source": choose a "File", optionally tick the OCR checkbox, click **"Upload"**. The item shows "Reading the text…", then "{n} characters read from the file." Use "Show the text" to check it.
   - Or "Add a web page": "Web page address", "Name (optional)", **"Take a snapshot"**.
   - Or "Paste text": "Name", "Text", **"Add the text"**.
4. Scroll back up to **"Teacher interview"** and click **"Start the interview"**. Spinner "The assistant is working…".
5. "Round 1" appears. For each question type an answer or click "Use the recommendation", then click **"Send answers"**. Repeat for an unknown number of rounds. ⚠ There is no progress indicator.
6. The result "The interview is finished and the brief was filled in. You can still edit every field." The "Course brief" below is refreshed. ⚠ Nothing highlights what changed.
7. Optionally edit the brief fields (a separate **"Save"** per text field) and the type checkboxes and lesson defaults (these save instantly).
8. ⚠ Scroll past "Runs" to **"Topics"**. Type "New topic", click **"Add topic"**, and repeat. Reorder with "Move up" / "Move down".
9. Get concept maps, either:
   - ⚠ **"Prepare all topics"** below the list: "Proposing concepts for {n} topics; {m} skipped." Each topic row shows "The assistant is proposing concepts…", then "Draft concept map with {n} concepts."; or
   - per topic, click the **"Concept map"** link.
10. On the topic page (`/courses/:id/topics/:topicId`):
    - Optionally **"Start the topic interview"**, answer the rounds; when it finishes it auto-proposes concepts. ⚠ It does not say so.
    - Optionally fill in "What this topic adds to the brief" and click **"Save additions"**.
    - In "Concepts": click **"Propose concepts"** if none exist, and wait for the spinner.
    - Edit concepts (a separate "Save" per concept), "Split", "Remove" (then "Remove {name} for good"), tick 2 or more and use "Merge", or add via "New concept" and **"Add concept"**.
    - ⚠ Scroll to the end of the list and click **"Approve the map"**. The note changes to "Approved: these concepts are tracked."
    - If a "Diagnostic lesson" section appears: **"Start with a diagnostic lesson"** or **"Decline"**.
11. Still on the topic page, ⚠ scroll further to **"Reference documents"**: choose "Kind" (e.g. "Grammar cheat sheet") and click **"Generate"**. The card shows the spinner, then "{kind}, version 1".
    - "Preview and print" opens the document preview. Click **"Print"**. ⚠ Come back with the browser Back button.
    - Optionally "Edit" (then "Save as a new version") or "Keep as it is". ⚠ The meaning of "Keep" is unclear.
12. Further down, **"Classroom material"**: optionally tick students (from the whole instance) and type an "Instruction (optional)", then click **"Generate material"**. The card shows the spinner, then "Version 1".
    - "Preview and print" opens the material preview: the interactive lesson plus the Answer key. Click **"Print"**. ⚠ Use the browser Back button to return.
    - Optionally type an "Instruction" and click **"Rework"** (creates the next version), or "Keep as it is", or "Discard".
13. ⚠ There is no "Release this material" link. The teacher must know to go to a run (Flow 4).
14. Repeat steps 10–12 for each topic, going back via the course-name link each time.

## Flow 4: Teacher creates a class, invites students, starts a run, enrols the class, releases material

1. Nav **"Students"**. In "New student" fill in "Name", "Email", "Their language" and optionally "Minor…", then click **"Create and invite"**. Result "Invitation sent to {email}." Repeat per student. ⚠ There is no bulk entry.
   - For a minor: "The student was created. As a minor, they get no invitation until you record a guardian's consent and activate the account." ⚠ Open the student by name. In "Guardian consent" tick the attestation and click **"Record consent"** ("Consent recorded. You can activate the account now."), then click **"Activate"** at the bottom.
2. Nav **"Classes"**. Enter "Class name" and click **"Create class"**. The app navigates to the class.
3. In "Add a student" choose a student and click **"Add to class"**. Repeat per student. ⚠ This is one at a time from a dropdown of the whole instance.
4. ⚠ Nav **"Courses"**, open the course, and scroll to **"Runs"** (there is no nav entry for runs). Enter "Run name" and click **"Start a run"**. The app navigates to the run page.
5. ⚠ The run page shows "Releases" first, but nobody is enrolled yet. Scroll down to **"Enrolled classes"**, choose in "Enrol a class", and click **"Enrol class"**. The "Roster" table fills in (only active, invitation-accepted students count, per the note). Optionally use "Enrol a student" for individuals.
6. Scroll back up to **"Releases"**, then "Release material":
   - "Material": choose "Title (Topic)"
   - "Version": latest by default
   - "Whole run, including students who join later" or "Chosen students" (then tick students)
   - "Feedback": "Immediate" or "At the end"
   - "Due": optional date and time
   - "After the due date": "Accepted, marked late" or "Refused"
   - "Attempts": "One" or "Repeated, the last counts"
   - "Show solutions after submission": on by default
   - Click **"Release"**. ⚠ There is no confirmation. The new row appears in the Releases table.
7. ⚠ There is no indication of whether students were notified, or of how many have opened the release.

## Flow 5: Student accepts the invitation and completes work

1. The student receives the invitation email and opens `/invitation#…`. The page says "You were invited to Myteacher as **email**". Fill in "New password" and "Repeat the password", then click **"Set password and sign in"**.
2. The student lands on Home: "Hello, {name}" and **"Your work"**. If nothing has been released: "Your lessons will appear here once your teacher sends you the first one."
3. Click a release title, which opens `/work/:releaseId`. ⚠ The attempt starts immediately, with no intro screen explaining the feedback mode, attempts, due date or solutions.
4. **Immediate feedback mode**:
   - For each exercise, answer it and click **"Confirm"** ("Checking…").
   - Right answer: "Correct", the exercise locks, and the "Solution" shows if the release shows solutions.
   - Wrong answer: "Not quite. Try once more." plus the "Hint". The wrong option or answer cannot be resubmitted. On the second try the exercise locks: "Not quite" plus the solution.
   - Free text and translation: the hint is shown up front. **"Confirm"** once, then "Awaiting assessment".
   - ⚠ There is no overall progress indicator. The student scrolls through the whole lesson.
5. **At-the-end mode**: answer all exercises (there is no per-exercise Confirm). At the bottom "{n} unanswered" is shown next to a disabled **"Submit answers"**. ⚠ Nothing says which exercises are missing. When all are answered, click **"Submit answers"**. All verdicts and solutions appear at once.
6. **Second round** (when some closed exercises were wrong): ⚠ at the very bottom, "Some exercises were not right on the first try. They come back once more, in a new order." and the button **"Start the second round"**. The "Second round" section appears with the failed exercises reshuffled. Answer them (Confirm, or "Submit answers" in at-the-end mode).
7. The green "Lesson finished" box: "{correct} of {total} right in the first pass." and "{count} written answers await your teacher."
8. When the release allows repeated attempts and the due date has not passed: **"Start another attempt"** appears at the bottom.
9. ⚠ There is no link back to "Your work" (use nav "Home"). Later, the teacher's published assessment appears only when the student reopens the work, as "Your teacher's assessment: {n} %" under the exercise. Nothing in "Your work" signals that new feedback has arrived.
10. If the teacher retracts: the work page shows "Your teacher retracted your attempt: {reason} You can start again." or "Your teacher withdrew this work: {reason}".

## Flow 6: Teacher views results, assesses open answers, overrides, publishes, retracts

1. ⚠ Home gives no signal that answers are waiting. Go to nav **"Courses"**, open the course, then in "Runs" open the run, then in "Releases" click the material title.
2. The release results page shows "Open answers": "Waiting for assessment: {w} · assessed by the assistant: {a} · needing your assessment: {f}".
3. Click **"Assess open answers"**. Spinner "The assistant is assessing the answers…". When it finishes the counts refresh.
   - Without a key: "Add your key in the settings to assess with the assistant. [Settings]".
4. Review the "Results" matrix (✓ ✗ … –) and the "Exercises" summary (Wrong, Right, Waiting, Not answered per exercise).
5. ⚠ To handle "needing your assessment" or to check the AI scores, click a **student name**. There is no indication which students have flagged answers.
6. On the student results page, scroll past the read-only lesson to the **assessments table** under each attempt. For a row: enter "Score (%)" and "Reason" and click **"Save"**. The row then shows "Your reason: …" and "Not published yet".
   - ⚠ Matching table rows ("Exercise" number) to the exercises in the lesson above requires counting.
7. ⚠ Click "Back to the results" and repeat step 6 for each student. There is no next-student navigation.
8. Back on the release results page, "Not shown to students yet: {n}". Click **"Publish results"**. Result "Published to students: {n}". ⚠ There is no preview of what students will see and no confirmation.
9. **Retract one attempt**: on a student results page, the top form "Reason for the students", then **"Retract the attempt"**. It happens immediately with no second confirmation, and the attempt shows "Retracted: {reason}".
10. **Retract the whole release**: at the bottom of the release results page, "Retract the release" section, fill in "Reason for the students" and click **"Retract the release"**. It happens immediately; the page shows "Retracted: {reason}" and the run's Releases table shows " · Retracted". ⚠ The note says "Release a corrected material anew", but nothing links to the topic page (to rework) or to the release form.

---

# Part 4: Design tokens, global styles and component vocabulary

## Tokens (`src/styles/tokens.css`)

The token file is the only place where colours, fonts and spacing are defined; a test enforces that components use only these properties. A future per-teacher theme ("slice 6") is meant to override these values.

**Typography**
- `--font-body`: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif (system stack, no web font)
- `--font-size-small` 0.875rem · `--font-size-body` 1rem · `--font-size-title` 1.5rem (only three sizes; h1/h2/h3 elsewhere use browser defaults)
- `--line-height-body` 1.55 · `--letter-spacing-caption` 0.05em (the uppercase "MYTEACHER" caption)

**Spacing** (4px based): `--space-1` 0.25rem, `--space-2` 0.5rem, `--space-3` 0.75rem, `--space-4` 1rem, `--space-6` 1.5rem, `--space-8` 2rem.

**Shape and layout**: `--radius` 0.5rem · `--border-width` 1px · `--content-width` 42rem.

**Colours** (light / dark):

| Token | Light | Dark |
|---|---|---|
| `--color-background` | #fbfaf7 (warm off-white) | #16181c |
| `--color-surface` | #ffffff | #1f2227 |
| `--color-text` | #1d1f23 | #e8e6e1 |
| `--color-text-muted` | #5b6069 | #a3a8b0 |
| `--color-border` | #d9d6cf | #3a3e45 |
| `--color-accent` | #2f5fd0 (blue) | #8fb0ff |
| `--color-accent-text` | #ffffff | #0f1a33 |
| `--color-focus` | #2f5fd0 | #8fb0ff |
| `--color-correct` | #1f7a45 | #7fd3a1 |
| `--color-correct-surface` | #e6f4ec | #1c3326 |
| `--color-incorrect` | #b3261e | #f2a39d |
| `--color-incorrect-surface` | #fbeaea | #3a1f1d |

- **Dark mode** follows `prefers-color-scheme: dark` unless `data-theme="light"` is set on `<html>`, and is forced with `data-theme="dark"`. No UI control sets `data-theme` today.
- **Print** always uses light colours (white background, black text, #444 muted, #bbb border).
- There are no warning, info or success-neutral colours. "Danger" reuses `--color-incorrect`, and "success" states reuse `--color-correct-surface` (e.g. the "Lesson finished" box).

## Global styles (`src/styles/base.css`)

- `box-sizing: border-box` everywhere. The body uses the background, text, font and line-height tokens with no margin.
- Focus ring: a 2px `--color-focus` outline with a 2px offset on `:focus-visible`.
- **`button`**: a single global style. Filled accent background, accent-text colour, 1px accent border, radius, padding `space-2 × space-4`. `:disabled` uses opacity 0.5 and a not-allowed cursor. Feature CSS restyles buttons as surface-coloured "chips" for exercise tokens, word-bank words, matching items and cloze gaps. `button.danger` gets an incorrect-colour border and text (still on the accent fill).
- `.visually-hidden`: content for screen readers only.
- Links, inputs, headings, tables and paragraphs have no global styling. Links are browser-default blue and underlined; headings use browser default sizes and margins.

## Page and layout classes

- `.page` (preview.css, used by the Shell and previews): centred column, max 42rem, padding `space-4`, grid gap `space-6`.
- `.page-header`: flex row, muted small text. `.page-caption`: uppercase caption.
- `.auth-page`: half the content width (21rem).
- `.shell-nav`: a row of links with a `space-4` gap; the active link is bold. `.shell-roles li`: bordered pill.

## Component vocabulary (as used across the app)

| Component | Implementation / class | Where |
|---|---|---|
| Primary button | global `button` (all buttons look like this) | everywhere |
| Danger button | `button.danger` (red outline/text) | second step of Remove / Discard / Erase / Transfer |
| Inline two-step confirm | first button swapped for "… for good" + "Keep"/"Cancel" | topics, concepts, sources, documents, materials, ownership transfer |
| Link-as-action | plain `<a>` | "Preview and print", "Concept map", "Export the course", back links |
| Section | `.admin-section` (grid, gap space-4) / `.settings-form` (grid, gap space-3; consecutive forms separated by a top border) | all pages |
| Form field | `<label>` wrapping text + `input`/`select`/`textarea` (stacked, bordered, radius, surface bg) | all forms |
| Checkbox row | `.settings-check` (inline flex) | all checkboxes and radios |
| Button row | `.settings-actions` (flex wrap, gap space-2) | all action groups |
| Muted note / help text | `.settings-note` (small, muted) | intros, hints, statuses |
| Status message | `<p role="status">` (unstyled) | success results |
| Alert message | `<p role="alert">` (unstyled; red only on auth pages) | errors |
| Data table | `.table-scroll` + `.admin-table` (full width, row borders, no header styling, no zebra, no sorting) | teachers, students, classes, courses, runs, releases, results, assessments, access |
| Bordered card | `.provider-card` fieldset; `.brief-types`, `.interview-question`, `.concept-prerequisites`, `.concept-split` | settings, brief, interview, concepts |
| List-item card | `.topic`, `.concept`, `.source`, `.document-card` (grid with a bottom border) | topics, concepts, sources, documents, materials |
| Inline "dialog" | `.erasure-dialog` (red-bordered box in the flow; not modal) | erasure, course access |
| Job indicator | `.job-status` + `.job-spinner` (CSS spinner, respects reduced motion) | all AI work |
| Job failure box | `.job-failure` (red border, red surface) + `<details>` with `.job-raw-output` | all AI work |
| Collapsible | native `<details><summary>` | raw AI output only |
| Text viewer | `.source-text` (pre-wrap, bordered) | extracted source text |
| Definition list | `.topic-additions` | read-only topic additions |
| Result mark | `ResultMark` glyph ✓ ✗ … – with a hidden label (no colour) | release results |
| Exercise card | `.exercise` fieldset (surface, border, radius) with `.exercise-prompt`, `.exercise-result[data-verdict]`, `.exercise-hint` (accent left bar), `.exercise-solution` | lesson player |
| Choice rows | `.exercise-option[data-state=correct/incorrect]` | multiple choice |
| Tap chips | `.cloze-word`, `.cloze-gap` (dashed), `.matching-item`, `.ordering-token`, `.selection-token` (min 44px), `aria-pressed` = accent fill | cloze, matching, ordering, selection |
| Counter | `.exercise-counter` (small, muted) | open text, selection limit |
| Passage box | `.passage` (bordered surface box in lessons; in documents a left-bar block, red when unsourced) | lessons, reference documents |
| Unsourced tag | `.unsourced-mark` (red outlined pill) + `.unsourced-note` | reference documents |
| Footnotes | `.footnotes` (small, top border) | reference documents |
| Teacher review | `.lesson-review` (accent left bar) | lesson player after publication |
| Finished box | `.lesson-finished` (green surface) | lesson player |
| Print toolbar | `.print-toolbar` + `print.css` (hides controls, turns inputs into underlines, answer key on a new page) | previews |

Observed gaps in the vocabulary that a redesign will probably need: a secondary or ghost button style; styled status and alert banners (success, error, warning, info) placed near their trigger; badges for states (Invited, Active, Draft, Approved, Retracted, Late); real modal dialogs; page-level headers with breadcrumbs; step or progress indicators (course setup, topic pipeline, lesson progress); empty-state components with a call to action; loading skeletons; and table styling (header row, compact numeric columns, sticky first column for the results matrix).
