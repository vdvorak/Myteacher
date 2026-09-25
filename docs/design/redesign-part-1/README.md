# Handoff: Myteacher – information architecture, navigation and new tokens

## Overview
Part 1 of the Myteacher UI redesign. It defines where everything lives for the three roles (teacher, student, admin), the new app shell, how the course and topic pages become numbered steps, how material links to releases, the student phone home, the admin order, the skeleton of the guided setup, and the Czech UI terms. It also ships the new colour/typography tokens (palette "Korálová") as a drop-in replacement for `src/styles/tokens.css`.

Detailed screens (dashboard, course steps, run, release results, student player) and the full guided setup come in parts 2–3 and are **not** in this bundle.

## About the design files
`Struktura a navigace.dc.html` is a **design reference built in HTML**, not production code. Open it in a browser (keep `support.js` next to it). Recreate the structure in the existing SolidJS + plain CSS frontend, using its patterns. The one file meant to be used directly is `tokens.css`.

## Fidelity
- **Tokens (`tokens.css`)**: high fidelity. Final values.
- **Structure, routes, nav order, tab order, step logic**: final for approval.
- **Sketches of the shell, course page and phone home**: low/mid fidelity. Use them for layout and hierarchy, not pixel measurements. The styling in the sketches does follow the tokens.

## Principles
1. Preparation (Course) and teaching (Course Run) are separate top-level sections, grouped in the nav as *Příprava* and *Výuka*.
2. Every workspace shows the next step: numbered steps with state, plus a "Další krok" bar (one sentence, one button) that may point into another section.
3. One thing per screen: long pages become tabs; add-forms open on demand (dialog or side panel), never permanently under a list.
4. Assistant work is visible: a job indicator in the top bar; finished jobs announce themselves with a toast linking to the result; failures link to the fix.

## App shell (teacher, admin)
Two-column grid: sidebar 232px (`--color-surface-sunken`, right border) + content (`minmax(0,1fr)`). Tablet: sidebar collapses to icons with labels; narrow: to a menu button.

**Sidebar, top to bottom**
- Brand "Myteacher" (uppercase caption)
- `Přehled` (`/`)
- group label `PŘÍPRAVA`: `Kurzy` (`/kurzy`)
- group label `VÝUKA`: `Běhy kurzů` (`/behy`, count badge) · reserved, dashed, "později": `Ke kontrole` (review queue), `Dotazy žáků` (student questions)
- group label `LIDÉ`: `Třídy a žáci` (`/tridy`, `/zaci`)
- bottom, above a top border: `Nastavení`, `Administrace` (admin only)

Active item: `--color-accent-surface` background, `--color-accent` text, weight 600, radius `--radius`. Group labels: 0.75rem, uppercase, `--letter-spacing-caption`, muted.

**Top bar** (bottom border, padding `--space-3 --space-6`, small text): breadcrumbs left (replace all ad-hoc "Back to…" links, including on preview/print pages); right: assistant pill ("Asistent pracuje · 1", dot in accent, pill radius, opens a job list: running / done / failed) and account avatar (language, theme, sign out). The language select is removed from the header; it stays in Settings › Účet and on the sign-in page.

**Page header**: title (`--font-size-title`, 650), muted meta line (object type · state), one primary button on the right, rare actions in a "Další akce ▾" menu (edit basics, fork, export, share).

**Shared patterns**
- Result messages appear next to the control that triggered them.
- Destructive actions (retraction, erasure, ownership transfer, deactivation, removing a class from a run) always use a confirmation dialog, red styling, placed apart from routine actions.
- Status badges: pill, 2px 8px padding. Approved/done = correct colours; draft/needs attention = warning colours; overdue = incorrect.

## Sitemap and routes

```
/                              Přehled (dashboard)
/kurzy                         Kurzy – mine + shared with me
/kurzy/:id                     Kurz, tabs: 1 Zadání · 2 Zdroje · 3 Témata │ Běhy · Přístup
/kurzy/:id/temata/:t           Téma, tabs: 1 Doplnění · 2 Mapa konceptů · 3 Referenční dokumenty · 4 Materiály do výuky
  …/dokumenty/:d/nahled        preview + print (inside shell, breadcrumbs)
  …/materialy/:m/nahled
/behy                          Běhy kurzů – all my runs across courses (incl. as co-teacher)
/behy/:id                      Běh kurzu, tabs: Přehled · Vydání · Žáci · Nastavení  (+ Lekce, later)
/behy/:id/vydani/:v            Vydání, tabs: Výsledky · Otevřené odpovědi · Nastavení
/behy/:id/vydani/:v/zaci/:z    Žák ve vydání (prev/next student)
/tridy, /tridy/:id             Třídy a žáci › Třídy (default tab)
/zaci, /zaci/:id               Třídy a žáci › Žáci
/nastaveni                     tabs: Asistent (first) · Účet · Denní souhrn
/administrace                  tabs: 1 E-mail (SMTP) · 2 Učitelé │ Výmaz údajů žáka (separate, danger)
/kontrola, /dotazy             reserved (later)
Student: / (home), /prace/:releaseId (intro → exercises → second round → result)
```
Route slugs are a proposal; keep the existing ones if preferred, the hierarchy is what matters.

## Přehled (teacher home) – contents in order
1. **Začínáme** checklist (until the first release) – see Guided setup.
2. **Vyžaduje pozornost**: open answers to assess, finished assistant work to review, students awaiting guardian consent, due dates approaching.
3. **Moje běhy kurzů**: latest release per run with submitted / total.
4. **Rozpracované kurzy**: setup state.
Admin additionally sees an **Instance** card until SMTP works and a teacher is invited.

## Course (`/kurzy/:id`) – tabs
Numbered step tabs show a state circle: done = `--color-correct-surface` bg + ✓ in `--color-correct`; current = accent circle with number; plus a muted progress note (e.g. "2 z 6 připraveno"). A vertical divider separates the non-step tabs.
1. **Zadání** – teacher interview next to the course brief, which fills live and highlights changed fields. All fields autosave (one save model). Lesson defaults here. Done: interview finished or brief confirmed by hand.
2. **Zdroje** – list + one "Přidat zdroj" button (file / web page / pasted text in one dialog). The interview can add sources inline. Done: ≥1 read source, or "Pokračovat bez zdrojů".
3. **Témata** – ordered list (drag to reorder) with columns #, Téma, Mapa konceptů (badge), Dokumenty (count), Materiály (count). "Připravit všechna témata" at the top. The row opens the topic. Ready to run: ≥1 topic has classroom material.
- **Běhy** – runs of this course + "Spustit běh kurzu" (also the page's primary button).
- **Přístup** – course access; ownership transfer separately at the bottom as a danger action.

"Další krok" bar under the tabs: `--color-accent-surface`, radius, small text, bold "Další krok:" + sentence, small primary button on the right.

## Topic (`/kurzy/:id/temata/:t`) – tabs
1. **Doplnění** – topic interview + additions (optional). After it, the panel says the assistant is now proposing concepts.
2. **Mapa konceptů** – propose, edit, merge, split. "Schválit mapu" is the primary button in the step header, not at the end of the list. The diagnostic lesson offer appears here. Unlocks 3 and 4.
3. **Referenční dokumenty** – locked until approval, with a sentence explaining why.
4. **Materiály do výuky** – generate, rework by instruction, preview/print. Every material has **"Vydat v běhu…"** and shows which runs it is already released in.
Replace "Ponechat, jak je" with an explicit state on assistant drafts: *Nový* → *Zkontrolováno*. Documents and materials get the same actions: Upravit, Přepracovat pokynem, Zahodit.

## Course run and release
Flow: Materiál do výuky → **Vydat v běhu…** (dialog: run, audience, feedback mode, due date, late work, attempts, solutions) → **summary + confirm** ("28 žáků uvidí materiál hned") → Vydání (opened / submitted) → Výsledky.

Run tabs:
- **Přehled** – current topic, latest releases with progress, who is behind. A new run shows steps "Zapište třídu" → "Vydejte první materiál" instead.
- **Vydání** – list with counts (submitted, waiting for assessment) + "Vydat materiál". Settings shown in the detail, not in 9 columns.
- **Žáci** – ONE list of all students with an "Zapsán přes" column (class / directly); enrolled classes as chips above; "Zapsat třídu nebo žáka" dialog. Replaces Roster + Enrolled classes + Enrolled students.
- **Nastavení** – name, co-teachers, release defaults (inherited from the course brief).

Release tabs:
- **Výsledky** – students × exercises matrix; colour AND symbol per cell; sticky first column; exercise prompt visible in the header (not hover-only); click a cell to open the answer.
- **Otevřené odpovědi** – one answer at a time: answer, assistant assessment, teacher override, "Další". Flagged first. "Zveřejnit výsledky" with a preview of what students will see.
- **Nastavení** – release settings, link to the material and version; "Stáhnout vydání" at the bottom with confirmation.
Student-in-release: attempts listed, assessment inline at each exercise (no number lookup), prev/next student, "Stáhnout průchod" in a menu with confirmation.

## Student (phone)
No menu. Header: "Ahoj, {jméno}" (1.25rem, 650) + 40px avatar (language, theme, sign out).
- **Na řadě**: overdue first, then by due date, then new. Card: course (0.75rem muted) + due label (overdue = incorrect, due soon = warning), title (bold), one full-width button "Začít" (outlined accent) / "Pokračovat · 4 z 10" (filled accent). Overdue card has an incorrect-coloured border.
- **Hotovo**: title + score, badge "Nové hodnocení" (accent-surface/accent) when results are published. Older items collapsed.
- Retracted work stays in the list with the teacher's reason.
- Empty: "Až ti učitel pošle první práci, objeví se tady."
- One piece of work: 1 Úvod (feedback mode, attempts, due date, whether solutions show) → 2 Exercises with progress indicator → 3 Second round → 4 Result (says when written answers will be assessed) → back to the list.
- Later: individual lessons join the same list; "Nerozumím / Zeptat se" in lessons; only then a 2-item bottom bar.
All tap targets ≥ 44px.

## Admin
Admin = teacher + role. Tabs in this order: **1 E-mail (SMTP)** (saving sends a test email) → **2 Učitelé** (state badges; "Pozvat učitele" disabled with a link to E-mail until SMTP works; role and deactivation confirm). **Výmaz údajů žáka** on its own page, red-bordered, explains the difference from deactivation, confirm by typing the name.

## Guided setup (skeleton – detailed in part 2)
1 Připojte asistenta (Nastavení › Asistent; key tested on save) · 2 Založte kurz a projděte rozhovor (Kurz › Zadání) · 3 Přidejte zdroje (Kurz › Zdroje) · 4 Témata a schválená mapa konceptů · 5 Vytvořte materiál do výuky · 6 Založte třídu a pozvěte žáky (can run in parallel with 5) · 7 Spusťte běh a vydejte materiál.
It lives in three places: the "Začínáme" checklist on Přehled, the "Další krok" bar in course/topic/run, and empty states with one button to the right step.

## Czech terms
Kurz = Course · Téma = Topic · Mapa konceptů = Concept Map · Koncept = Concept · Zdroj = Source · Referenční dokument = Reference Document · Materiál do výuky = Classroom Material · Běh kurzu = Course Run · Zápis = Enrolment · Průchod = Attempt · Hodnocení = Assessment · Režim zpětné vazby = Feedback Mode · Třída = Class · Žák = Student · Asistent = Assistant · Přístup ke kurzu = Course Access · Souhlas zákonného zástupce = Guardian Consent · Deaktivace = Deactivation · Výmaz = Erasure · Dotaz žáka = Student Question.
**Still to be confirmed by the owner:** Zadání kurzu (Course Brief), Úvodní rozhovor (Teacher Interview), Vydání (Release), Stažení (Retraction), Spoluvyučující (Co-teacher), Vlastní kopie (Fork), Ke kontrole (Review Queue).

## Design tokens
See `tokens.css` (drop-in for `src/styles/tokens.css`, same structure, same names; new tokens marked `NEW`).
- Font: **Onest** (self-host; 400–800, latin-ext for Czech). Sizes: small 0.875rem, body 1rem, title 1.625rem, display 3rem (h1 weight 750, letter-spacing −0.03em). Line-height 1.55.
- Spacing: unchanged 4px scale (1, 2, 3, 4, 6, 8).
- Radius 0.75rem; pills 999px.
- Light: bg #ece7e3, surface #f6f2ef, sunken #e2dbd6, text #1a1614, muted #5f5651, border #d9d0ca, accent #c13a1f / text #ffffff / surface #f3dcd3, correct #1f6e45 / #dbe9df, incorrect #a8322c / #f1dcd9, warning #7d5300 / #efe3c8. The light surfaces are deliberately off-white to avoid glare.
- Dark: bg #110e0d, surface #1c1816, sunken #161211, text #f3eeeb, muted #a8a09b, border #322a27, accent #ff8a6b / text #2a0c04 / surface #3b1e16, correct #6fd69c / #13291d, incorrect #ff9b93 / #3a1c1b, warning #f2c46a / #33280f.
- Shadow: light `0 1px 2px rgb(40 30 40 / 0.05)`; dark `0 0 0 1px rgb(255 255 255 / 0.02), 0 2px 8px rgb(0 0 0 / 0.35)`.
- Note: the coral accent is close to the error red. Never signal correctness by colour alone: pair verdicts with icons/text (also required for WCAG). A theme control (Světlý / Tmavý / Podle systému) in Settings › Účet sets `data-theme` on `<html>`.

## Assets
None. No images or icons; ✓ is a text glyph.

## Files
- `Struktura a navigace.dc.html` – the reference document (open in a browser; palette and theme switchers at the top – use "Korálová").
- `support.js` – runtime needed to open the reference file.
- `tokens.css` – final tokens.
