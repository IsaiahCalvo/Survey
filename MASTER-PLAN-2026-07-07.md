# Master Plan — Survey backlog, post decision-batch (2026-07-07)

Read this file first in the next session. Companion docs: `DECISION-BATCH-2026-07-07.md`
(the questions as asked), `docs/design/design.md` (locked visual spec), this file
(what to actually build, in what order, at what risk tier).

All locked decisions below are FINAL — do not re-ask, do not re-litigate. Execute.

---

## 0. Landed tonight (context, not to-do)

On local `main`, NOT pushed: dev-fixture path-traversal fix, two DB CHECK
constraints (KAL-284 partial), a marker-read index + trimmed project-list query +
bounded upsert concurrency (KAL-285 partial), 12-modal a11y pass (KAL-66 partial),
the durable-sync hydrate/subscribe race fix + hardening (2 commits, KAL-316 — **still
needs Isaiah's realtime-ack before push**), the home design source doc, and deletion
of the dead `persistProjects` function. Full detail in commit messages and Linear/Obsidian
comments dated 2026-07-07. Queue C (13 stale "already done" tickets) verified and closed.

**Outstanding owner action, not code:** ack KAL-316 (commits `846c052e`, `3d7ac395`) so it
can be pushed. Everything else tonight is safe, reviewed, and just waiting in the queue.

---

## 1. Locked decisions (2026-07-07 answers — do not re-ask)

1. **Visual system**: home page (`docs/design/design.md`) is the single source of truth.
   Desktop viewer and mobile app adapt toward it, never the reverse.
2. **Copy tone**: sentence case everywhere.
3. **Feedback system**: one bottom toast (success/info), inline red banner (errors),
   one loading spinner. Replace all `alert()` calls.
4. **Empty states**: icon + one short line + one primary button.
5. **Tooltip/modal**: one custom tooltip style, one shared dim/backdrop.
6. **Duplicate uploads**: content-hash based. Identical bytes → reuse/unarchive
   existing doc. Same name + different content → ask "open existing vs create new
   version." Same content + different name → reuse existing, offer to add the new
   name as an alias. Never silently block, never silently duplicate.
7. **Deletion model** (supersedes the original "archive" default): user-facing action
   is **Delete**. Deleting a document/project/template moves it to Trash for 30 days.
   Emptying Trash (or the 30-day timer) is permanent. Restoring a document brings
   back its highlights/annotations/Survey Markers. Restoring a project brings back
   its internal files, Excel links, and template context. Restoring a template
   brings back structure and sharing context. If the item is shared, show a warning
   modal before delete: deletion affects collaborators and removes it from their side.
8. **Access model**: one canonical effective-access function. Roles are
   viewer/editor/owner; highest role wins across direct-document access and
   project access (no per-file exception mechanism yet). Project access grants
   use-only access to templates needed inside that project. Template management
   stays gated by direct template owner/editor permission. Delete the older/broken
   access-check rivals once the canonical one has regression tests for all four
   cases (owner/editor/viewer/no-access).
9. **Survey Markers**: move onto the shared annotation store (same migration
   pattern as the already-shipped callout unification).
10. **History click**: restore exact page, survey/region mode, selected
    context/category, then spotlight the mark. No half-measure.
11. **Callouts**: must be a normal annotation type — no callout-only create /
    delete / edit / history / sync / Trash / context-menu / permission path.
    Internally may stay a composite (text box + line + arrow), but every
    surrounding system treats it like any other annotation.
    **Companion fix already scoped from tonight's audit**: `createCallout()` and
    `handleCreateCallout()` never stamp `spaceId`/`regionId` at creation (pen
    strokes do). Fix this alongside #11 so callouts respect survey/region mode
    like everything else.

**Email**: switch from Resend to Brevo. Brevo CLI is installed locally
(`brevo login` needed once). Resend is currently wired into 12 files including
two server-side email functions — this is a real migration, not a config flip.

**Cloud sync tier gate**: leave as-is (available to all tiers pre-launch,
already intentional per an in-code comment) — revisit pricing at launch.

---

## 2. Owner-only account tasks (no code, do directly, unblocks the items below)

- Azure app registration + work-account sign-in + verify-live-sync probe +
  scratch-workbook Row-ID drain test, THEN flip the M365 writeback flag.
  Blocks: nothing else in this plan — independent track.
- Brevo: fix sender domain compliance (DKIM + DMARC green), send test mail to
  Gmail / Outlook / Yahoo to confirm real-world delivery. **Blocks the Brevo
  code migration below** — don't build against a non-compliant sender.
- Stripe: flip test → live only after a live smoke test + webhook/subscription
  check. Independent track.

---

## 3. Execution tiers

### Tier A — one big autonomous workflow (well-specified, low product risk, high volume)

Everything here has a locked, unambiguous spec (`docs/design/design.md` plus
decisions 1–5, 10, and the callout companion fix from 11). No taste calls left to
make — just wide, careful application across many files. Good fit for a
Workflow-style fan-out: one agent per surface area, shared design tokens, gated
on build + tests + visual screenshots before commit.

- Bring the PDF viewer's shell/palette/typography/spacing/buttons/panels/modals/
  tooltips in line with `docs/design/design.md` (decisions 1, 5).
- Bring the mobile app in line with the same spec, translated to mobile layout
  per the design doc's own "Adapting Other Surfaces" section (decision 1).
- Sentence-case copy pass, app-wide (decision 2).
- Replace all `alert()` calls with the one toast/banner system; unify the
  loading spinner (decision 3).
- Redesign the three empty states (Documents/Projects/Templates) with
  icon + line + button (decision 4).
- History-click restore-context fix — page + mode + category + spotlight,
  no partial restore (decision 10).
- Callout creation: stamp `spaceId`/`regionId` at creation so callouts respect
  survey/region mode like pen strokes (decision 11 companion fix).

Gate every slice on `npx vite build` + `node scripts/run-node-tests.mjs`, take
before/after screenshots of each changed screen, land on local `main`, do not push.

### Tier B — supervised builds (real product features, need a dedicated session/goal each, NOT bundled into Tier A)

Sequence matters — do in this order:

1. **Content-hash column + duplicate-upload flow** (decision 6). Add
   `documents.content_sha256`, backfill script (dry-run first, report before
   writing), then the upload-time check + the three-way UX (reuse / ask / alias).
   This also unblocks the previously-held content-addressed storage re-keying
   item from the prior audit (KAL-281) — do that re-keying right after, same
   session, since it shares the hash column.
2. **Trash / soft-delete system** (decision 7). Schema for a trash state +
   30-day expiry per entity type, restore logic for documents (annotations
   intact), projects (files + Excel links + template context intact), templates
   (structure + sharing intact), the pre-delete collaborator-impact warning
   modal, and an empty-trash flow. This is the highest blast-radius item in this
   batch (irreversible deletion logic on live user content) — build with the
   same adversarial-review discipline used on tonight's sync fix: two
   independent review passes before it's considered done.
3. **Access-model unification** (decision 8). Inventory the current rival
   access-check functions, design the one canonical viewer/editor/owner +
   project-grants-template-use model, add regression tests for all four access
   cases, then delete the losers. Security-sensitive, touches production RLS —
   treat with the same care as a live database migration, because it is one.
4. **Survey Markers + callouts onto the shared annotation store** (decisions 9
   + 11). This is the same class of migration as the callout-unification work
   already shipped — follow that precedent (flag-gated rollout, parity tests,
   a real backfill plan, explicit go/no-go before flipping the flag live).
5. **Brevo email migration** — only after the owner's DKIM/DMARC/delivery test
   passes. Swap the sender in both edge functions and the ~10 other call sites,
   verify each email type still sends (invite, password reset, profile-change
   notice) against the new provider before removing Resend.

### Tier C — stays parked (already flagged in the original audit, unchanged)

The save-and-restore rebuild epic, the PDF viewer file breakup, and the other
named risky refactors. Still needs a dedicated go/no-go, still not for this
batch of sessions.

---

## 4. Dependency notes

- Tier B item 1 (content-hash) unblocks the held storage re-keying item — do
  them together.
- Tier B item 5 (Brevo) is blocked on the owner's account-side DNS/compliance
  work in section 2 — don't start the code swap early.
- Tier A and Tier B are independent of each other and can run in parallel
  sessions if useful, but each Tier B item should stay its own session — don't
  merge two Tier B items into one sitting.
