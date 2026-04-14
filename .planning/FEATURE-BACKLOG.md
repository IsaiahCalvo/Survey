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

- [ ] **Shift+rotate snaps to 45° increments** — hold Shift during rotation handle drag to snap to 0°/45°/90°/135°/etc. Needs both SVG rotation path (`useSVGInteraction.js` ~line 391, check `e.shiftKey` + `Math.round(angle/45)*45`) and Fabric edit path (toggle `obj.snapAngle=45` via keydown/keyup listeners in `FabricEditCanvas.jsx` shape loading). ~10 lines total.
- [ ] **Zoom floor at 10%** — change `MIN_SCALE` from `0.5` to `0.1` in `src/utils/zoomController.js`. Every zoom path goes through `clampScale()` so this is a single constant change. Prevents unusably small annotations at extreme zoom-out.

### Rotation handle relocates to opposite side when off-screen

**Source:** 12-02-UAT Test 14 user feedback, captured as Gap 2 (status: feature_request)
**Priority:** v2.2+
**Context:** When user places a shape near the page edge and rotates it, the mtr rotation handle can go off-screen. Currently the user must move the shape away from the edge to re-grab the handle. Desired flow: place shape near edge → rotate → if handle would be off-screen, it relocates to the opposite side of the shape (or nearest visible side) so the user can re-grab it without moving the shape first. Pill follows the new handle position.
**Scope:** SVGSelectionOverlay (handle placement logic), not RotationInputField (pill already clamps correctly).

### Rotation pill reappears on hover after returning from edit mode via click-off

**Source:** 12-02-UAT Gap 3 (discovered during 12-03 UAT re-run, 2026-04-14)
**Priority:** v2.2+ polish (minor severity — workaround exists)
**Symptom:** Double-click shape → enter edit mode → click off shape → mini toolbar dismisses → user back in select mode → hover rotation handle → pill does NOT appear. Workaround: fully deselect + reselect shape.
**Log evidence:** `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/1.log` — hover-intent effect RUN selectedIds.size=1 → attaching listeners to handleEl, but NO subsequent pointerenter on mtr fires on hover until after the deselect/reselect cycle.
**Suspected root cause:** mtr handle DOM element stale after React reconciles overlay post-edit-commit. Hover-intent effect in `SVGAnnotationLayer.jsx` attaches listeners on a handle ref that no longer corresponds to the visible element. Likely the dep array needs to re-run after edit-commit triggers an `annotations` identity change, or the ref resolution needs a tick delay.
**Scope:** `src/components/SVGAnnotationLayer.jsx` hover-intent effect only. Out of scope for 12-03 (strictly commit-path fix). Filed from Phase 12 close as carry-forward.

### Rotation handle fully visible when rotated shape enters edit mode

**Source:** 12-02-UAT Gap 4 (discovered during 12-03 UAT re-run, 2026-04-14)
**Priority:** v2.2+ polish (minor severity)
**Symptom:** Rotate shape to non-zero angle → double-click to enter edit mode → mini toolbar renders correctly on top → BUT mtr rotation handle is partially clipped by an invisible boundary. Does NOT happen at 0° rotation — only when shape is pre-rotated.
**Suspected root cause:** `FabricEditCanvas` or its wrapper container has `overflow: hidden` / tight clip-path boundary that crops content outside the shape's local bounding box. When shape is rotated, rotation handle geometry extends into the clipped region.
**Scope:** `src/components/FabricEditCanvas.jsx` container CSS/overflow rules, and SVGSelectionOverlay render-order + z-index during edit mode. Out of scope for 12-03. Filed from Phase 12 close as carry-forward.

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
- [ ] **Print button** — flip `enablePrint={true}` in the viewer (or wire Electron `win.webContents.print()`) `[PDF-App]`
- [ ] **Clickable PDF link annotations** — flip `enableHyperlink={true}`; IPC `shell:openExternal` handler is already in `electron-main.js` `[PDF2]`
- [ ] **Fillable form fields** — flip `enableFormFields={true}`; Syncfusion renders and collects field values natively `[PDF2][PDF-App]`
- [ ] **Form designer** — flip `enableFormDesigner={true}`; creates/edits form fields in-app `[PDF2][PDF-App]`
- [ ] **"Open PDF..." native menu** — `dialog:openFile` IPC handler already exists; just add the File menu item in `electron-main.js` `[PDF-App]`
- [ ] **"Export Annotated PDF" native menu** — `dialog:saveFile` IPC + export function already exist; add Cmd+Shift+E menu item `[PDF-App]`

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

- [ ] **"Loading document..." state** — spinner/message while a PDF is opening `[PDF2]`
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

## How to use this file

When the user says "what's next to work on" or "what else do we have to add",
read this file and present the next unchecked items, grouped by stage, with
their codebase tags and the effort notes above. Update the status marks as items
ship.


---
*Related (graphify):* [[CC-Architecture Overview]] · [[Competitive Intelligence]] · [[Missing Features]]