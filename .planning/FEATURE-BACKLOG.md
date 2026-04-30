# PDF Annotation App — Feature Backlog

Features identified as present in reference codebases but missing from the current
codebase (`/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2`). Working list for
"what's next" planning sessions.

**Source scans** (2026-04-11, first pass + deep re-scan):
- `/Users/isaiahcalvo/Desktop/Syncfusion-PDF2` → tagged `[PDF2]`
- `/Users/isaiahcalvo/Desktop/Syncfusion-PDF-App` → tagged `[PDF-App]`
- `/Users/isaiahcalvo/Desktop/Survey-Experimental` → no unique features found

**Verified false positive:** Unsupported Annotations Notice component already
exists in this codebase (`src/components/UnsupportedAnnotationsNotice.jsx`,
imported and rendered in `App.jsx`). If it isn't displaying, it's a runtime
detection issue, not a missing feature.

**Status legend:** `[ ]` not started · `[/]` in progress · `[x]` done · `[-]` rejected
*(Obsidian Tasks plugin renders `[/]` as a visual in-progress indicator)*

---

## Momentum Rationale (2026-04-11)

Re-scanned codebase before ordering. Key findings that change the difficulty map:

- **Many Syncfusion features are one prop-flip away** — print,
  clickable links, form fields, form designer are all explicitly set
  to `false` in `SyncfusionPDFContainer.jsx` / `App.jsx`. Enabling them costs
  minutes, not days.
- **Custom thumbnail + search panels exist but need comparison** — `PagesPanel.jsx`
  is a custom thumbnail sidebar; `SearchTextPanel.jsx` + `SearchContext` are a
  custom text search. Both work, but they haven't been audited against Syncfusion's
  built-in equivalents or the reference codebases. Marked `[/]` — needs comparison
  and polish, not a full build.
- **PDF export already built** — `pdfAnnotations.js` (annotpdf) and
  `pdfAnnotationsPdfLib.js` (pdf-lib) both exist with working export functions.
  The "export" items are really about surface-level wiring, not new code.
- **Auth + Supabase are fully integrated** — Microsoft MSAL, Supabase Auth,
  `documentAnnotationService.js`, real-time sync, and row-level security are all
  in place. The "collaboration" tier already has its backend foundation.
- **Electron native menus already have Edit + View** — `electron-main.js` already
  implements standard Edit/View/Window menus. "Standard Edit menu" is done.
- **`BookmarksPanel.jsx` is already built** — Syncfusion `enableBookmark={true}`
  is already on; the sidebar panel exists and works.

**Strategic thread:**
> *Free wins → polish the foundation → extend the annotation pipeline → close
> the export loop → add social features on the existing Supabase backend →
> build the platform layer → layer sharing on top → wire collaboration last.*

Each stage below outputs something concrete and immediately usable before you
start the next stage. Nothing is blocked by a stage you haven't finished yet.

---

## Stage 0 — Shape Edit Polish  *(builds on circle edit fixes landed 2026-04-12)*

Continues the shape editing momentum from the post-v2.0 cleanup branch.
Circle handle alignment, live scaling, and clipping are fixed — these two
items use the same code paths and finish the editing interaction model.

- [x] **Shift+rotate snaps to 45° increments** — done (verified 2026-04-16)
- [x] **Zoom floor at 10%** — done (verified 2026-04-16)
- [x] **Rotation handle relocates to opposite side when off-screen** — done (verified 2026-04-16)
- [x] **Rotation pill reappears on hover after returning from edit mode** — done (verified 2026-04-16)
- [x] **Rotation handle fully visible when rotated shape enters edit mode** — done (verified 2026-04-16)
- [x] **Polygon/polyline rotation offset bug** — fixed (user confirmed 2026-04-17)

**Momentum:** Shape edit handles → rotation precision → zoom range. Each builds
on the same interaction surface. After this, shape editing is feature-complete
and we move to prop-flip wins.

---

## Stage 1 — "Prop-flip" Wins  *(minutes of effort each)*

These are disabled Syncfusion features or IPC handlers that already exist but
aren't exposed. Enable first — they make the app look dramatically more complete
with almost zero risk.

- [/] **Thumbnail panel** — custom `PagesPanel.jsx` exists and works, but needs a side-by-side comparison against Syncfusion's built-in panel and the `[PDF2]`/`[PDF-App]` implementations to identify gaps and polish opportunities `[PDF2][PDF-App]`
- [/] **Full-text PDF search** — custom `SearchTextPanel.jsx` + `SearchContext` exists and works, but needs a side-by-side comparison against Syncfusion's built-in search and the `[PDF2]`/`[PDF-App]` implementations to identify gaps and polish opportunities `[PDF2][PDF-App]`
- [x] **Print button** — DONE (verified 2026-04-30; `enablePrint={true}` active in `SyncfusionPDFContainer.jsx`, Electron Cmd+P + "Print with Markup" wired) `[PDF-App]`
- [x] **Clickable PDF link annotations** — DONE (verified 2026-04-30; `enableHyperlink={true}` active, `hyperlinkClick` routes to `electronAPI.openExternal()`) `[PDF2]`
- [x] **Fillable form fields** — DONE (verified 2026-04-30; `enableFormFields={true}` active, FormFields service injected) `[PDF2][PDF-App]`
- [ ] **Form designer** — flip `enableFormDesigner={true}`; creates/edits form fields in-app `[PDF2][PDF-App]`
- [x] **"Open PDF..." native menu** — DONE (verified 2026-04-30; File menu has "Open PDF…" with Cmd+O sending `menu:open-pdf` IPC) `[PDF-App]`
- [x] **"Export Annotated PDF" native menu** — DONE (verified 2026-04-30; File menu has "Export Annotated PDF…" with Cmd+Shift+E) `[PDF-App]`

---

## Stage 2 — QA Verifications  *(confirm what's already there)*

Before adding anything new, verify the existing features work end-to-end. These
items pay for themselves by catching regressions early.

- [ ] **Unsupported Annotations Notice still fires** — open a PDF with a truly unsupported type (Stamp, FileAttachment, Sound, Movie, 3D, RichMedia, Redact) and confirm the bottom-right banner appears. `SUPPORTED_SUBTYPES` (`src/utils/pdfAnnotationImporter.js:20`) now includes Polygon/PolyLine/Text/Squiggly/Caret — only the truly unsupported list at line 49 should trigger it.
- [ ] **Export round-trip** — annotate a page, export via annotpdf/pdf-lib, re-open the exported PDF and confirm annotations are baked in. Both `pdfAnnotations.js` and `pdfAnnotationsPdfLib.js` exist — verify which one is wired to the UI.

---

## Stage 3 — UX Polish Foundation  *(no backend needed)*

Polish the surfaces that every feature will touch. Build these before adding more
features so new features feel finished from day one.

- [x] **"Loading document..." state** — DONE (verified 2026-04-30; "Loading document…" message + icon spinner in `App.jsx` when `isLoading` is true) `[PDF2]`
- [ ] **"Failed to render PDF" error state** — clean error when a PDF is corrupted `[PDF2]`
- [ ] **Empty dashboard state** — "Upload a PDF to get started" prompt `[PDF-App]`
- [ ] **Empty comments state** — "No comments yet" message `[PDF-App]`
- [ ] **Button loading states** — "Uploading..." / "Creating..." with disabled state `[PDF-App]`
- [ ] **Inline error banners** — red error boxes on upload / share dialogs `[PDF-App]`
- [ ] **Delete confirmation dialogs** — "Delete this document?" before removal `[PDF-App]`
- [ ] **Toolbar tooltips on hover** — every toolbar button shows a tooltip `[PDF-App]`
- [ ] **Dark mode theme** — full dark theme using CSS variables `[PDF-App]`
- [ ] **Preferences → Annotations tab** — eventual settings surface, named "Preferences → Annotations" (matches Adobe Acrobat convention; user confirmed 2026-04-11). First concrete setting: a "Textbox auto-fit on commit" toggle. *Desired behavior:* first commit after a new textbox is created auto-tightens width/height to text content; after the user manually resizes the box, the user-chosen size is locked and no future commit (resize OR re-edit) re-tightens. Setting would expose `autoFitOnCommit: true|false` with a smart default (true until first manual resize). **Rationale:** users who deliberately create an oversized textbox for layout purposes must not be snapped back. (Implemented 2026-04-11: default is now "preserve user size after first commit" for both width and height — see `FabricEditCanvas.jsx` commitAndClose + `useSVGInteraction.js` resize commit. The toggle will flip this back to aggressive auto-fit if desired.)

---

## Stage 4 — PDF Import Robustness  *(extends fresh v2.0 annotation pipeline)*

This stage is the natural continuation of v2.0. The annotation importer
(`pdfAnnotationImporter.js`) was just exercised heavily — the code is fresh,
the failure modes are understood, and the SVG display layer is ready to render
whatever the importer produces. Do this before the export stage so you're
exporting correctly-imported data.

- [ ] **Multi-page annotation extraction** — import annotations from all pages of foreign PDFs, not just the active page `[PDF2]`
- [ ] **Native annotation import** — read embedded pen/shape/text annotations from binary PDF streams `[PDF2][PDF-App]`
- [ ] **Smooth curves for imported ink** — use PDF appearance stream (/AP) for Bézier curves instead of polylines `[PDF2][PDF-App]`
- [ ] **Ink dot detection** — single-tap marks render as circles, not degenerate paths `[PDF-App]`
- [ ] **Rotated page handling** — 90/180/270° rotations land annotations in the correct spot `[PDF2][PDF-App]`
- [ ] **Import statistics logging** — sampled vs fallback vs skipped counts logged for debugging `[PDF2]`

---

## Stage 5 — Export & Native Menu Wiring  *(close the import → annotate → export loop)*

The export functions already exist in `pdfAnnotations.js` and
`pdfAnnotationsPdfLib.js`. This stage is about ensuring the right one is wired to
the UI, exposing it via the Electron menu, and adding the XFDF sidecar option.
Finish after Stage 4 so you're exporting clean, correctly-imported data.

- [ ] **Flattened PDF export** — verify the existing export function is wired to a toolbar button and the Electron menu; bake annotations into a downloadable PDF `[PDF2][PDF-App]`
- [ ] **XFDF sidecar export** — export annotations as a separate standards-compliant sidecar file `[PDF2]`

---

## Stage 6 — Comments & Discussions  *(Supabase backend already wired)*

Supabase auth, `document_annotations` table, and real-time subscription
architecture are already in place. Comments layer directly on top of this
infrastructure — no new backend is needed, only the UI and data model extension.

- [ ] **Comments on annotations** — leave comments attached to any markup `[PDF2][PDF-App]`
- [ ] **Comment author names** — who wrote each comment `[PDF-App]`
- [ ] **Comment timestamps (HH:MM)** — when each comment was posted `[PDF-App]`
- [ ] **Reply / delete buttons per comment** — inline controls on each comment `[PDF-App]`
- [ ] **Ctrl/Cmd+Enter to submit** — keyboard shortcut to post a comment `[PDF-App]`
- [ ] **Escape to cancel reply** — keyboard shortcut to close a reply box `[PDF-App]`
- [ ] **Threaded replies** — reply to comments in nested threads `[PDF2][PDF-App]`

---

## Stage 7 — Platform (Dashboard & Cloud)  *(turn single-file viewer into a real app)*

Currently the app opens one PDF at a time via file picker. This stage adds the
multi-document platform layer. Build after comments so the dashboard can show
comment counts on document cards from day one.

- [ ] **Cloud authentication** — Supabase Auth (email/password or OAuth); `AuthModal.jsx` + `AuthContext.jsx` already exist, verify full flow `[PDF-App]`
- [ ] **PDF cloud upload (Supabase)** — upload PDFs to Supabase Storage; Supabase client already configured `[PDF-App]`
- [ ] **Document dashboard with upload** — home screen to browse/upload/delete PDFs `[PDF2][PDF-App]`
- [ ] **File type validation** — "Only PDF files are supported." `[PDF-App]`
- [ ] **File size validation** — "File too large. Maximum size is X MB." `[PDF-App]`
- [ ] **File size and date on document cards** — metadata display on dashboard tiles `[PDF2]`
- [ ] **Multi-page app routing** — dashboard / viewer / shared / settings routes `[PDF-App]`
- [ ] **Document title + page count in top bar** — shows filename and "12 pages" `[PDF-App]`
- [ ] **Settings page with profile** — account info screen `[PDF-App]`
- [ ] **Sign-out button** — logout from settings `[PDF-App]`
- [ ] **Document access control management** — view/revoke per-user access `[PDF2][PDF-App]`
- [ ] **Organizations with plan tiers** — free / pro / enterprise `[PDF2][PDF-App]`
- [ ] **Role-based permissions** — viewer / annotator / admin `[PDF2][PDF-App]`
- [ ] **Enterprise SSO scaffolding** — SAML/OIDC placeholder `[PDF2][PDF-App]`

---

## Stage 8 — Sharing & Links  *(needs Stage 7 auth + routing to be meaningful)*

Sharing is meaningless without user accounts and multi-doc routing. Build after
Stage 7 so share links can authenticate recipients and route to real documents.

- [ ] **View-only vs annotate access levels** — granular per-link permissions `[PDF2][PDF-App]`
- [ ] **Copy-to-clipboard button on share links** — one-click copy the URL `[PDF2][PDF-App]`
- [ ] **Password-protected share links** — optional password on generated links `[PDF2][PDF-App]`
- [ ] **Share link expiration** — auto-expire after N days `[PDF2][PDF-App]`
- [ ] **"Shared view" badge** — top-bar badge when viewing via share link `[PDF-App]`
- [ ] **Password-protected viewer screen** — password entry page for shared docs `[PDF-App]`
- [ ] **Email invitations with role selection** — invite by email as viewer or annotator `[PDF2][PDF-App]`
- [ ] **Password attempt rate limiting** — "Too many attempts. Try again later." `[PDF2][PDF-App]`
- [ ] **"Document not found or access denied" error page** — clean error for missing docs `[PDF-App]`
- [ ] **"Link not found or expired" error page** — clean error for dead links `[PDF-App]`

---

## Stage 9 — Collaboration Stack  *(biggest lift; needs everything above)*

Real-time collaboration requires accounts (Stage 7), sharing/permissions (Stage 8),
and a solid annotation data model (Stages 4-5). Supabase real-time is already
wired; the remaining work is CRDT merge logic, presence tracking, and UI.

- [ ] **Real-time collaborative annotations** — Yjs CRDT sync across users `[PDF2][PDF-App]`
- [ ] **WebSocket sync server** — backend service keeping everyone in sync `[PDF-App]`
- [ ] **Connection status badge** — Live/Connecting/Offline indicator `[PDF2][PDF-App]`
- [ ] **Offline mode with auto-sync** — save locally offline, sync when reconnected `[PDF2][PDF-App]`
- [ ] **Presence avatars with initials** — colored circles showing active users `[PDF2][PDF-App]`
- [ ] **"+N more" overflow counter** — avatar pill when more than 5 users are present `[PDF-App]`
- [ ] **Avatar hover tooltips** — full user name on hover `[PDF-App]`
- [ ] **Cursor position broadcasting** — see where other users are looking `[PDF2]`
- [ ] **Per-user undo/redo** — undo only your own changes, not teammates' `[PDF-App]`

---

## Line/Arrow Mini-Toolbar *(captured 2026-04-16 — Phase 16 candidate)*

Phase 15 shipped the curvature handle + 6 arrowhead style data model and
renderer, but there's no UI for users to pick an arrowhead style yet (testing
required JSON editing). The line/arrow mini-toolbar appears on select and
exposes style controls inline. Building this first gives the Text Box
Mini-Toolbar (below) a proven pattern to reuse.

- [ ] **Line/arrow mini-toolbar on select** — appears next to the selected
  line or arrow, reuses the shape mini-toolbar positioning infrastructure.
  - [ ] Arrowhead style picker (6 styles: solid triangle, open triangle,
    open circle, filled circle, pipe, none — data model + renderer already
    shipped in Phase 15, just needs the selector UI)
  - [ ] Stroke color
  - [ ] Stroke width
  - [ ] Curvature pill indicator (visual cue that the line is curved;
    shares momentum with the midpoint handle from Phase 15)
  - [ ] Shares component infrastructure with the text box mini-toolbar
    below — building line/arrow first establishes the pattern.

---

## Text Box Mini-Toolbar *(captured 2026-04-15 — Phase 16 candidate)*

Text boxes currently have no edit-mode toolbar. Shapes already get a mini-toolbar
on select/edit. Text boxes should get the same treatment so users can style them
inline without diving into menus.

- [ ] **Text box mini-toolbar on double-click / select** — reuse the shape
  mini-toolbar infrastructure; appears next to the selected textbox.
  - [ ] Fill color (background — currently no background, clear only)
  - [ ] Border / stroke color + width (default is now 1px black after
    2026-04-15 fix; toolbar lets users change or remove it)
  - [ ] Font family picker (respect single-name-font rule from CLAUDE.md
    2026-04-08 cursor-drift gotcha — no CSS fallback stacks)
  - [ ] Font size
  - [ ] Text alignment (left / center / right / justify)
  - [ ] Bold / Italic / Underline / Strikethrough
  - [ ] Belongs with v2.3 Phase 16 (mini-toolbar + curvature pill wave) or a
    dedicated follow-up; shares component infrastructure with the line/arrow
    mini-toolbar, so building in the same phase is cheaper.

---

## v0.2 Cloud Sync + Collaboration Polish (active — 2026-04-25)

Captured from session work to ensure nothing slips. Order is recommended
build order, not strict dependency.

- [x] **Eraser cross-device sync** — DONE (v0.1.24 — delete diff + remote-echo
  loop closure; commits `dc1758bd` + `63479fb1`; user-confirmed in soak) `[PDF-App]`
- [ ] **Windows catch-up on document open** — small race window between
  hydrate and realtime subscribe means recently-pushed Mac marks can fall
  through the gap until the user refreshes. Fix: subscribe first, queue
  events, then hydrate, then drain queued events (or re-hydrate on focus).
  `[PDF-App]`
- [x] **Sync status indicator** — DONE (verified 2026-04-30; `SyncStatusChip.jsx`
  mounted in `PDFSidebar.jsx` bottom-left footer — NOT top-right as originally
  planned; green/orange/red states correct). User moved this to bottom-left
  along with presence avatars. `[PDF-App]`
- [ ] **Survey icon move** — relocate the top-right survey button under
  the left rail divider, beneath Spaces, so the four navigation tabs
  (Pages / Search / Marks / Spaces) stay visually grouped and Survey
  reads as a separate tool. `[PDF-App]`
- [x] **Live presence row (multi-user avatars)** — DONE (verified 2026-04-30;
  `PresenceAvatars.jsx` mounted in `PDFSidebar.jsx` bottom-left footer alongside
  the sync status chip — NOT top-right as originally planned. Stacked overlapping
  circles, ~4 visible cap with "+N" overflow pill, viewers + editors both shown).
  `[PDF-App]`
- [ ] **Cloud sync tier gate** — the auth context already exposes a
  `features.cloudSync` flag for Pro/Enterprise/Developer, but the sync
  feature isn't actually checking it. Wire the gate so free accounts
  can't sync (still get local-only annotations). Pair with an upsell
  hint when a free user opens a doc that has cloud annotations from a
  paid collaborator. `[PDF-App]`
- [ ] **Save Log double-push cleanup** — every press of Save Log
  produces two log files in the GitHub logs branch ~20ms apart.
  Functional but wasteful and confused the user when the first attempt
  felt like it failed. Trace the press → push pipeline and dedupe.
  `[PDF-App]`
- [ ] **Yellow highlighter sync bugs** — highlighter strokes duplicate
  on top of themselves, and partial erases don't propagate cross-device.
  Highlights still ride the legacy single-type sync path; today's all-
  types fixes do not touch them. Bring highlighter onto the new path
  or replicate the diff-and-delete logic on the legacy path.
  `[PDF-App]`
- [ ] **Callout fixes** — user flagged outstanding callout issues
  during cloud sync session; specifics to be enumerated next session.
  Likely candidates: visual selection chrome (no dashed box per
  2026-04-16 feedback), knee handle hit zones, label edit boundary,
  rotation behavior. `[PDF-App]`
- [ ] **Print pipeline (v3.0 milestone)** — the bigger printing
  rewrite was deferred when cloud sync was prioritized. Parent plan
  in `docs/superpowers/plans/2026-04-25-pdf-native-annotations.md`.
  Resume after cloud sync polish lands. `[PDF-App]`
- [ ] **Share PDF with other users (view / edit)** — generate a link
  that another signed-in user can open. Free tier can only share for
  view; Pro and above can share for edit. Pairs with the existing
  share-link infrastructure listed in Stage 7. `[PDF2][PDF-App]`
- [ ] **Sync-fail fallback: local copy + merge resolution** —
  captured 2026-04-30. When the cloud sync fails (network out, RLS
  reject, deadlock, safety-brake-suppressed delete, etc.) the app
  should save a local copy of the user's edits to disk, named like
  `<pdf-name> <date> <time> <user>.local`. On next open, detect the
  divergence between cloud and local copy and offer the user three
  choices: merge changes (need to design merge UX — Excel "compare
  and merge" is one reference), keep local copy and overwrite cloud,
  or discard local copy and pull from cloud. This is the long-term
  answer to "what does the user do when sync fails — just hope?"
  Phase scope: large. Probably belongs near the end of v2.4 or in
  v2.5 alongside the highlight migration. `[PDF-App]`
- [x] **Per-user delete authority + confirm-before-wipe** — SHIPPED
  2026-04-30 as Phase 35. All 6 plans landed across 5 waves; 23/23 unit
  tests green; wipe brake retired; `wouldWipeCloud` grep = 0; production
  bundle clean. Permission gates wired across selection / hover / eraser /
  marquee / bulk-delete; collaborator + owner confirmation modals + 5-6
  second undo toast + one-shot cleanup banner all mounted. Phase closed
  DONE_WITH_CONCERNS — 6 live UAT steps deferred to a 2nd-account session
  (resumption guide in `memory/project_phase35_uat_pending.md`). `[PDF-App]`

---

## Deferred UAT — needs a 2nd account

- [ ] **Phase 35 UAT walkthrough — 6 live tests on a mixed-author PDF.**
  Phase 35 (Per-User Delete Authority + Confirm-Before-Wipe) shipped
  2026-04-30 as DONE_WITH_CONCERNS. Code is structurally verified (23/23
  unit tests, grep + tree-shake checks all green). The 6 deferred tests
  cover marquee scope, eraser scope, click no-chrome, collaborator bulk
  modal, owner cross-author modal, and cleanup banner one-shot. Most need
  at least one foreign-author annotation on the test PDF — likely a 2nd
  Supabase account or a temporary fake-authorId seam. Diag logger and
  role-override seam are pre-wired; resumption guide lives at
  `memory/project_phase35_uat_pending.md` in the auto-memory store. When
  user says "let's test phase 35" or similar, follow that guide step by
  step.

## How to use this file

When the user says "what's next to work on" or "what else do we have to add",
read this file and present the next unchecked items, grouped by stage, with
their codebase tags and the effort notes above. Update the status marks as items
ship.


---
*Related (graphify):* [[CC-Architecture Overview]] · [[Competitive Intelligence]] · [[Missing Features]]