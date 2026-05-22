# Survey — End-to-End Annotation Workflow (Product Spec)

**Status:** Draft v1 — KAL-15
**Last updated:** 2026-05-22
**Owner:** Isaiah Calvo
**Author:** Agent (Claude Opus 4.7) per KAL-15

> Source: KAL-15. This spec maps the **target** Survey workflow from the
> surveyor / project lead's point of view, marks what the current code
> supports, and identifies gaps with linked Linear issues. It is intentionally
> plain-English so non-engineers can validate it against their job and so
> future Linear tickets can be tied to a real workflow step instead of
> isolated feature ideas.

---

## 1. Who this is for

**Primary user:** A field surveyor or project lead working off a set of issued
drawing PDFs (architectural / MEP / floor plans). They open the PDF, walk the
site, mark up issues, capture survey data per checklist, and produce
deliverables (an annotated PDF for the contractor / client, plus a structured
survey spreadsheet for the office and per-space exports for handoff).

**Secondary users:**

- **Editor collaborator** — a teammate invited to co-edit the document.
- **Viewer collaborator** — a stakeholder (e.g. client, GC) who only needs to
  read and reference the marked-up drawing.
- **Office / admin** — consumes the Survey Excel and Spaces CSV/PDF rather
  than touching the in-app drawing.

**Goal:** Start with a blank issued PDF. End with (a) an annotated PDF
deliverable, (b) a populated Survey Excel workbook, and (c) per-space
attachments — all consistent and reproducible across reloads, devices, and
collaborators.

**Locked product decisions (do not redebate in follow-up tickets):**

- Roles are **Owner / Editor / Viewer** only. No `Commenter` role. No
  anonymous public links. Sharing covers whole documents / projects /
  whole-template (not partial template fragments). — KAL-31
- **Normal `Export PDF` excludes** survey highlights, region overlays, and
  space overlays by default. Regular app annotations only. — KAL-7
- **Survey data exports via the spreadsheet path** (Survey Excel,
  `handleExportSurveyToExcel`). Survey overlays do not bake into the normal
  PDF.
- **Native / editable PDF export is not yet shipped.**
  `pdfNativeExport.bakeAnnotationsIntoPdf()` is scaffolded-only and throws
  `not-implemented yet`. Treat it as Post-release. — KAL-8

---

## 2. Tier legend

| Tier | Meaning |
| --- | --- |
| **MVP** | Must work for the v1 release. Blocks launch if broken. |
| **Pre-MVP** | Needed before MVP but not yet release-quality; tracked in active backlog. |
| **Post-release** | Acceptable to ship without; v1.1+ improvement. |
| **Future** | Idea-stage; needs more discovery before scheduling. |

| Support | Meaning |
| --- | --- |
| **Implemented** | Code path exists, tested or evidenced. |
| **Partial** | Some pieces exist, but step is incomplete vs. the workflow expectation. |
| **Missing** | No code path; new Linear issue needed (or already filed). |
| **Not verified** | Code exists; this spec did not exercise it live. |

---

## 3. The workflow at a glance

```
1. Sign in / open hub
2. Receive PDF
3. Upload / open PDF (optionally inside a Project)
4. Pick / create a Survey Template (if doing survey work)
5. Navigate & search the drawing
6. Annotate (regular tools)
   6a. Pen / highlighter
   6b. Shapes (rect, ellipse, line, arrow)
   6c. Counter
   6d. Text box
   6e. Callout
   6f. Native text-highlight / underline / strikeout / squiggly
   6g. Eraser
   6h. Survey Marker (special; data-bearing)
7. Organize survey work into Spaces / Modules / Regions
8. Save / sync (autosave + cloud + offline queue)
9. Share with Owner / Editor / Viewer
10. Collaborate live
11. Review & revise (next session, possibly another device)
12. Export deliverables
    12a. Normal annotated PDF
    12b. Survey Excel workbook
    12c. Space CSV + Space PDF Pages
13. Close / hand off / sign-off
```

---

## 4. Step-by-step spec

### Step 1 — Sign in / open the hub

| | |
| --- | --- |
| **User action** | Launches the desktop app (or web) and signs in. |
| **What they see** | Survey Hub: three left-rail tabs (Documents, Projects, Templates), top header, profile menu in the bottom left of the sidebar. |
| **What the app does** | Loads user, documents, projects, templates, members from Supabase. Mounts `<SurveyHub>` (`src/home/SurveyHub.jsx`). |
| **Support** | Implemented |
| **Tier** | MVP |
| **Verification** | Implemented per `src/home/SurveyHub.jsx`, `HubShell.jsx`. `AccountSettings` provides settings overlay. Templates tab is gated by `isPro`. |

### Step 2 — Receive a drawing PDF

| | |
| --- | --- |
| **User action** | Receives a PDF by email / shared link / handoff. May also receive a Survey-app invite link (Owner/Editor/Viewer). |
| **What they see** | A normal email / OS file. If an invite link was sent, an email from Resend (post KAL-31). |
| **What the app does** | Nothing yet, until the user opens or uploads the file. |
| **Support** | Implemented (file receipt is OS-level). Invite-link receipt is **Partial** — `ShareModal` is UI-only stub; real invites land with KAL-31. |
| **Tier** | MVP (invites are Pre-MVP) |
| **Gap link** | KAL-31 (invite link send + email through Supabase + Resend) |

### Step 3 — Upload / open the PDF

| | |
| --- | --- |
| **User action** | Clicks **Upload** (Documents tab) or **Add files** (Projects tab), picks the PDF. Or double-clicks a document already in the ledger. |
| **What they see** | The PDF opens in the viewer; the hub fades out. While Supabase upload runs in the background, the file is already interactive (optimistic upload). |
| **What the app does** | `handleUploadClick` opens an Electron `openFile` dialog (or `<input type="file">` on web), creates a `File` object, optimistically inserts a temp doc into the documents list, calls `onDocumentSelect`, then in the background uploads to Supabase storage via `uploadToStorage` and reads the page count. |
| **Support** | Implemented |
| **Tier** | MVP |
| **Verification** | `src/App.jsx:3414` (`handleUploadClick`), `src/App.jsx:3557` (`handleFileUpload`), `src/App.jsx:4791` (`handleDocumentClick` re-open path). Storage hook in `src/hooks/useDatabase.js`. |
| **Known edge** | Corrupt / non-PDF load failure surface previously used `alert()`. Replaced with a clean render-failure state — KAL-21 Done. |

### Step 4 — Pick / create a Survey Template (Pro only)

| | |
| --- | --- |
| **User action** | Goes to Templates tab, picks an existing template, or clicks **New template**. Defines modules → categories → checklist items → entities (colours). |
| **What they see** | Three-panel template editor (template list / module + category tree / entities panel). |
| **What the app does** | `TemplatesEditor` (`src/home/TemplatesEditor.jsx`) edits a local `rich` mirror of the template; saving routes through `onSaveTemplates`. Stable IDs preserved per KAL-43. |
| **Support** | Implemented |
| **Tier** | MVP (for users who do survey work) |
| **Verification** | `src/home/TemplatesEditor.jsx`. Templates tab is locked for Free per `isPro` gate in `SurveyHub`. KAL-43 (stable IDs for live sharing) and KAL-44 (archive vs delete used checklist items) hardened the data model. |

### Step 5 — Navigate & search the drawing

| | |
| --- | --- |
| **User action** | Scrolls / zooms; opens the left-rail Pages or Search tab; clicks a result. |
| **What they see** | Page thumbnails, text search, bookmarks, Spaces tabs on the left rail. Search highlights jump to the match. |
| **What the app does** | Syncfusion handles native text search; highlights and jumps are stabilized through the SVG layer. |
| **Support** | Implemented |
| **Tier** | MVP |
| **Verification** | `src/PDFSidebar.jsx`, `src/components/SyncfusionPDFContainer.jsx`. KAL-16 (search jump accuracy), KAL-17 (survey-highlight item jump), KAL-40 (expanded rail tabs) all Done. |

### Step 6 — Annotate

The top toolbar exposes the active tool. Common pattern:

1. Pick a tool from the toolbar group (Draw, Shape, Review, Survey).
2. Adjust properties in the right-rail Annotation Properties Panel.
3. Draw on the page; Fabric.js / SVG layer captures the geometry.
4. Save is automatic; cloud sync is debounced + queued.

#### 6a. Pen / Highlighter — MVP — Implemented

| | |
| --- | --- |
| **What the app does** | Freehand stroke captured by `FabricDrawingCanvas`; flattened to SVG layer on commit. `zoomGeneration` signal auto-commits on zoom-start (CLAUDE.md invariant). |
| **Verification** | `src/components/FabricDrawingCanvas.jsx`, `SVGAnnotationLayer.jsx`. KAL-28 (highlighter sync + eraser propagation) Done. |

#### 6b. Shapes — rect / ellipse / line / arrow — MVP — Implemented

| | |
| --- | --- |
| **What the app does** | Drag to draw on a `FabricDrawingCanvas`. Arrow has end-handle / cap fields preserved through export round-trip. |
| **Verification** | Confirmed in `ANNOTATION_LIFECYCLE_MATRIX_2026-05-15.md` rows for rect/circle/line/arrow. Quick edits for line/arrow extended in KAL-33. |

#### 6c. Counter — MVP — Implemented

| | |
| --- | --- |
| **What the app does** | App-specific annotation type. Counter series increments per click. Exports with full app metadata so it does not round-trip as a plain circle. |
| **Verification** | `ANNOTATION_FIX_16_COUNTER_EXPORT_REIMPORT_CONTRACT_LOG.md`. Counter export contract test exists. |

#### 6d. Text box — MVP — Implemented (style extensions Post-release)

| | |
| --- | --- |
| **What the app does** | `FabricEditCanvas` Textbox with single-name fontFamily (CLAUDE.md gotcha — never CSS stack). Edited in-place; properties panel exposes font / size / colour. |
| **Verification** | `src/components/FabricEditCanvas.jsx`. KAL-34 extended properties (Done). |

#### 6e. Callout — MVP — Implemented

| | |
| --- | --- |
| **What the app does** | App callout state with text body + leader line. Distinct from regular text box. Round-trips through export/reimport with full metadata. |
| **Verification** | `ANNOTATION_FIX_2_CALLOUT_CONTRACT_LOG.md`, `ANNOTATION_FIX_3_CALLOUT_RELOAD_YDOC_LOG.md`. |

#### 6f. Native text markup — highlight / underline / strikeout / squiggly — MVP — Implemented

| | |
| --- | --- |
| **What the app does** | `NATIVE_TEXT_MARKUP_TOOLS` in `src/App.jsx:208` routes to Syncfusion's text-markup mode. |

#### 6g. Eraser — MVP — Implemented

| | |
| --- | --- |
| **What the app does** | `FabricEraserCanvas` hit-tests strokes/shapes; ownership-aware deletes. |
| **Verification** | `ANNOTATION_FIX_5_ERASER_HIT_TEST_LOG.md`, `ANNOTATION_FIX_6_ERASER_SAVE_HISTORY_SYNC_LOG.md`. |

#### 6h. Survey Marker — MVP — Implemented (data-bearing, *not* a regular annotation)

| | |
| --- | --- |
| **User action** | Picks the Survey tool, draws a highlight region on the drawing tied to an active Module / Category / Entity. |
| **What they see** | A coloured tint matching the entity, a side-panel row with checklist data and an Excel row index. |
| **What the app does** | `handleSurveyMarkerCreated` (`src/App.jsx:31481`) stores the marker in `surveyMarkers` keyed by annotation id, with `moduleId`, `categoryId`, `bounds`, `excelRowIndex`, and `checklist_responses`. Survey markers are stored as **hidden app-layer metadata** for PDF export (do not bake into regular PDF). |
| **Verification** | `ANNOTATION_FIX_10_SURVEY_REGION_VISIBILITY_LOG.md`, `ANNOTATION_FIX_25_FINAL_BACKEND_ANNOTATION_LIFECYCLE_QA_LOG.md`. |

### Step 7 — Organize survey work into Spaces / Modules / Regions

| | |
| --- | --- |
| **User action** | Opens the Spaces panel; assigns pages or region subsets to named Spaces; binds template modules / categories. |
| **What they see** | Left-rail Spaces tab; right-rail Survey panel grouping markers by module/category. |
| **What the app does** | `spaces` state holds page assignments (`assignedPages` with `wholePageIncluded` / `regions`). Region masks govern Space PDF export. |
| **Support** | Implemented |
| **Tier** | MVP |
| **Verification** | `src/sidebar/SpacesPanel.jsx`, App-level Space export handlers (`handleExportSpaceToCSV` `src/App.jsx:24682`, `handleExportSpaceToPDF` `src/App.jsx:24812`). |

### Step 8 — Save / sync

| | |
| --- | --- |
| **User action** | Keeps working. Cmd/Ctrl+S manual save; otherwise autosave. |
| **What they see** | A sync chip in the chrome: **Up to date / Syncing N changes… / Offline — N changes queued**. Stuck-sync banner appears after the threshold. Deletion-pending warning if a delete fails. |
| **What the app does** | Local-first writes; `cloudSyncQueue.js` + `crdtDualWriteQueue.js` retry in background. CRDT (`YDocProvider`) silently merges on reconnect using per-property last-write-wins. No manual merge dialog. |
| **Support** | Implemented |
| **Tier** | MVP |
| **Verification** | KAL-32 (offline sync recovery + status UI) Done, with verified evidence. `src/components/collab/YDocProvider.jsx`, `src/services/cloudSyncQueue.js`, `src/hooks/useAnnotationCloudSync.js`. |
| **Known race** | KAL-24 (document-open hydrate / realtime catch-up race) currently In Review. Open second client during a write may miss marks until refresh until KAL-24 ships. |

### Step 9 — Share with Owner / Editor / Viewer

| | |
| --- | --- |
| **User action** | Selects a document (or project / template), clicks **Share**. Picks a role (default **Viewer**), enters emails or copies the role-scoped invite link. |
| **What they see (target)** | Teams-style modal: one email box (multi-email), one role selector, one copyable invite link with explicit access text (e.g. "Anyone with this invite link can join as Viewer"). |
| **What they see (today)** | The current `ShareModal` (`src/home/ShareModal.jsx`) is UI-only: link copies a placeholder `survey.app/...` and **Send invite** just closes the modal. No role selector. No invite token. |
| **What the app does (target)** | Creates a durable invite record with token + role + email + expiry, sends email via Supabase Edge Function + Resend, persists `document_collaborators` on accept. Viewer = read-only; Editor = edit if paid tier; Owner = co-owner / admin (not transfer). |
| **Support** | **Partial → Missing** for real behavior |
| **Tier** | Pre-MVP |
| **Gap link** | **KAL-31** (build permissioned invite-link sharing) — In Progress |
| **Verification** | `src/home/ShareModal.jsx` (lines 35–41 confirm placeholder). `src/services/documentAnnotationService.js` already exposes `addDocumentCollaborator`, `updateDocumentCollaboratorRole`, `removeDocumentCollaborator`. Server-side bits depend on KAL-31. |
| **Locked decisions** | Roles = Owner / Editor / Viewer only. No Commenter. No anonymous public link. Whole-template sharing only. Default role = Viewer. Free user invited as Editor is blocked before send. Existing access list visible in modal. |

### Step 10 — Collaborate live

| | |
| --- | --- |
| **User action** | Editor joins from a second browser / device; both edit the same document. |
| **What they see** | Each other's strokes, shapes, callouts, counters, survey markers appear without manual refresh. Presence indicators. Foreign edits/deletes are blocked per role. Owner sees a cross-author delete confirmation. |
| **What the app does** | Yjs + Supabase realtime via `SupabaseYjsProvider` and `YDocProvider`. RLS gates document / storage / annotation access. Permission helpers in `src/lib/collab/permissionScope.js`. |
| **Support** | Implemented |
| **Tier** | MVP |
| **Verification** | KAL-10 (release two-user validation matrix) Done. KAL-29 (mixed-author deletion UAT) Done. `ANNOTATION_FIX_20_MULTI_USER_COLLAB_CONTRACT_LOG.md`. |
| **Known race** | KAL-24 — document-open hydrate / realtime catch-up race; second client opening mid-edit can miss marks until refresh. In Review. |

### Step 11 — Review & revise

| | |
| --- | --- |
| **User action** | Next day / week, reopens the document. Reviews prior work, fixes mistakes, adds more annotations or survey markers. |
| **What they see** | Full state restored from Supabase: regular annotations, callouts, counters, survey markers, spaces, regions. Sync chip = Up to date. |
| **What the app does** | On open, hydrates `annotationsByPage` + `callouts` + `surveyMarkers` + `spaces` from Supabase via cloud-sync; Yjs reconciles deltas. Imported PDF-native annotations honour `pdfImportedEditState`. |
| **Support** | Implemented (with KAL-24 race noted) |
| **Tier** | MVP |
| **Verification** | `ANNOTATION_FIX_25_FINAL_BACKEND_ANNOTATION_LIFECYCLE_QA_LOG.md`, `ANNOTATION_FIX_29_IMPORTED_PDF_EDIT_EXPORT_CONTRACT_LOG.md`. |
| **Gap (workflow)** | No first-class **document revision** concept: there is no `v2`, "duplicate as new revision", or compare-prior-version. Today users either annotate in place or duplicate the file manually. See follow-up issue. |

### Step 12 — Export deliverables

#### 12a. Normal annotated PDF — MVP — Implemented

| | |
| --- | --- |
| **User action** | File menu → **Export annotated PDF** (Electron desktop only). |
| **What they see** | Save dialog; output is `<name>-annotated.pdf`. |
| **What the app does** | `handleExportAnnotatedPDF` (`src/App.jsx:26189`) runs `savePDFWithAnnotationsPdfLib` against the **original PDF bytes** and bakes regular app annotations. **Excludes** survey highlights, region overlays, and space overlays by default (per KAL-7). Unedited imported PDF-native copies are skipped to avoid duplication; edited imported copies are exported from app state. |
| **Verification** | `src/utils/saveAnnotatedPDFFile.js`, `src/utils/pdfAnnotationsPdfLib.js`. KAL-5, KAL-6, KAL-7 Done. |
| **Constraint** | Desktop-only today (depends on `window.electronAPI.saveFile`). Web export = not yet shipped. |

#### 12b. Survey Excel — MVP — Implemented (Pro)

| | |
| --- | --- |
| **User action** | Survey panel → Export → Excel (new file, or push to linked OneDrive workbook). |
| **What they see** | `.xlsx` with hidden `_SurveyMetadata` sheet + one worksheet per module/category, columns: `Changed By`, `Changed Date`, `Item`, [checklist items…], `Entity`, `Notes`. Optional live sync push/pull when OneDrive linked. |
| **What the app does** | `handleExportSurveyToExcel` (`src/App.jsx:20759`) builds ExcelJS workbook, links by Supabase template id, supports linked-file push/pull via `excelGraphService.js` and session-based updates via `excelSessionService.js`. |
| **Verification** | `tests/excelSyncDirtyState.test.mjs`, audit logs. KAL-7 / KAL-8 confirm Survey Excel is the survey data path. |
| **Tier** | MVP (gated to paid) |

#### 12c. Space CSV + Space PDF Pages — Pre-MVP — Implemented (Pro)

| | |
| --- | --- |
| **User action** | Spaces panel → Export → CSV or PDF Pages, per space. |
| **What they see** | CSV with `Space Name, Page, Mode, Region Count, Annotation Type, …, Notes, Checklist Items, Status, Attachments` (`src/App.jsx:24699`). PDF Pages: rasterized base pages, region-masked when `wholePageIncluded === false`. App annotations are **not** baked in. |
| **What the app does** | `handleExportSpaceToCSV` / `handleExportSpaceToPDF`. |
| **Verification** | `src/sidebar/SpacesPanel.jsx`. |
| **Tier** | Pre-MVP — works but tooltip wording about "no annotations embedded" must remain accurate (KAL-8 audit). |

#### 12d. Native / editable PDF export — Post-release — Missing

| | |
| --- | --- |
| **User action** | Would expect "Save as fully editable PDF" so Acrobat / Bluebeam users could edit shapes individually. |
| **Today** | `src/utils/pdfNativeExport/index.js → bakeAnnotationsIntoPdf()` throws **`not-implemented yet`**. No UI advertises this. |
| **Gap link** | New — see §6 below. |
| **Tier** | Post-release |

### Step 13 — Close / hand off / sign-off

| | |
| --- | --- |
| **User action (target)** | Marks the document **Complete** / **Signed off** / **Released**. Optionally locks against further edits, optionally creates a new revision. |
| **What they see (today)** | Nothing. There is no Complete / Sign-off / Lock action in the UI. Documents only exist in `documents` table with `updated_at` timestamps; there is no `status`, `signedOffBy`, `signedOffAt`, or revision counter. `grep` for `signoff|sign-off|signOff|releaseDoc|finalizeDoc` in `src/components` and `src/home` returns zero hits. |
| **Support** | **Missing** |
| **Tier** | Pre-MVP (for surveying use-case — without sign-off, "done" is ambiguous and Excel/PDF deliverables can be edited after handoff). |
| **Gap link** | New — see §6 below. |

---

## 5. Annotation type × export matrix (locked)

| Annotation / data | Normal PDF Export | Survey Excel | Space CSV | Space PDF | Round-trip on reimport |
| --- | --- | --- | --- | --- | --- |
| Pen / highlighter | Yes (visible) | — | If in space scope | — (raster only) | Yes |
| Shapes (rect / ellipse / line / arrow) | Yes (visible) | — | If in space scope | — | Yes |
| Counter | Yes (visible, with app metadata) | — | If in space scope | — | Yes — preserves counter identity |
| Text box | Yes (visible) | — | If in space scope | — | Yes |
| Callout | Yes (visible, app metadata) | — | If in space scope | — | Yes |
| Native text-highlight / underline / strikeout / squiggly | Yes (native PDF markup) | — | — | — | Yes |
| Survey marker | **Excluded** (hidden app metadata only) | **Primary export** | — | — | Yes via hidden metadata |
| Region overlay | **Excluded** | — | Region geometry referenced | Masks page | Yes via hidden metadata |
| Space overlay | **Excluded** | — | Space name + assigned pages | Page set | Yes via hidden metadata |
| Imported PDF-native (unedited) | Original preserved; app copy skipped | — | — | — | Yes |
| Imported PDF-native (edited) | Edited app copy exported; original removed | — | — | — | Yes |

---

## 6. Identified gaps and proposed Linear issues

The two real gaps surfaced by walking this workflow that are **not** already
covered by an open Linear ticket:

### Gap A — No document sign-off / release / lock state

Walking the workflow end to end, the user has no way to declare the document
"complete" or to prevent further edits after handoff. Survey deliverables
(Excel + Space CSV/PDF + annotated PDF) can drift because the source document
remains editable. Proposed acceptance criteria:

- Document carries `status ∈ {draft, in_progress, signed_off, archived}`.
- Owner can transition to `signed_off` from a document-level menu.
- Sign-off captures `signed_off_by`, `signed_off_at`, optional note.
- When signed off, Editors and Viewers see a banner; Editor write actions are
  blocked at the UI + RLS layer until reopened by Owner.
- Survey Excel and Space CSV/PDF exports include the sign-off block in
  header metadata when present.

### Gap B — No first-class document revision / version history

Reviewers (Step 11) currently overwrite in place. There is no "this is v2"
concept and no way to compare "what was there at sign-off" with "what is there
now." Proposed acceptance criteria:

- Sign-off snapshots the annotation set as immutable revision `vN`.
- Owner can create a new revision (`vN+1`) for ongoing edits.
- Revision list visible in document detail; user can open any prior revision
  read-only.
- Exports labeled with the revision name.

### Gap C — Native / editable PDF export not yet shipped

`bakeAnnotationsIntoPdf()` is scaffolded-only and is mentioned in KAL-8 as
out-of-scope for that audit. Worth filing as its own Post-release
implementation issue.

These are filed as new Linear issues in §10.

---

## 7. Cross-cutting workflow concerns

- **Plan gating** — Cloud sync is available to Free users; multi-user editing
  is gated to paid tiers; Templates tab is locked for Free. Confirmed per
  KAL-26 (Done).
- **Offline** — Local-first; queue drains on reconnect; no manual merge
  dialog. KAL-32 Done.
- **Save format guarantee** — All app-specific data (counters, callouts,
  survey markers, spaces, regions) survives an export/reimport round-trip via
  hidden `SurveyAppLayerState` / `SurveyAppAnnotation` metadata. See
  `ANNOTATION_LIFECYCLE_MATRIX_2026-05-15.md`.
- **Render-failure recovery** — Corrupt PDFs land on a clean failure state,
  not `alert()`. KAL-21 Done.

---

## 8. Verification log

Spec walked against current code on 2026-05-22 from the worktree at
`/Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2/.claude/worktrees/agent-ad718f1e98c1c757f/`.

| Step | Method | Result |
| --- | --- | --- |
| 1 | Code read (`src/home/SurveyHub.jsx`, `HubShell.jsx`) | Verified |
| 2 | N/A (external) | N/A |
| 3 | Code read (`src/App.jsx:3414` upload, `:4791` open) | Verified |
| 4 | Code read (`src/home/TemplatesEditor.jsx`); KAL-43 audit confirms stable IDs | Verified |
| 5 | Code read + closed Linear issues KAL-16, KAL-17, KAL-40 | Verified |
| 6a–6g | Code read + audit logs `ANNOTATION_FIX_2/3/5/6/16/29/30` | Verified |
| 6h | Code read `src/App.jsx:31481` (`handleSurveyMarkerCreated`) | Verified |
| 7 | Code read `SpacesPanel.jsx`, `src/App.jsx:24682` / `:24812` | Verified |
| 8 | KAL-32 (Done) + audit log; `cloudSyncQueue.js`, `YDocProvider.jsx` | Verified |
| 9 | Code read `src/home/ShareModal.jsx` lines 35–41 | **Partial — placeholder confirmed; depends on KAL-31** |
| 10 | KAL-10 (Done), `ANNOTATION_FIX_20`, KAL-29 (Done) | Verified, with KAL-24 race in review |
| 11 | Same as Step 10 evidence + audit log 25 | Verified-with-caveat (no revision concept — Gap B) |
| 12a | Code read `src/App.jsx:26189` (`handleExportAnnotatedPDF`); KAL-5, KAL-6, KAL-7 (Done) | Verified |
| 12b | Code read `src/App.jsx:20759`; KAL-8 (open audit) | Verified (audit still open) |
| 12c | Code read `src/App.jsx:24682`/`:24812` | Verified |
| 12d | Code read `src/utils/pdfNativeExport/index.js` — throws | **Missing — Gap C** |
| 13 | `grep -rn 'signoff\|sign-off\|signOff'` in `src/components` `src/home` → 0 hits | **Missing — Gap A** |

A standalone Playwright walk against a live dev server was not run; this spec
relies on code inspection + existing audit logs + closed Linear evidence, per
the comment "the agent should draft the spec and link gaps, not ask for more
direction." All claims above point to a file + line or a closed issue.

---

## 9. Out-of-scope for this spec

- Implementing any of the gaps (Sign-off, Revisions, Native PDF export).
- Redesigning the share modal UI (covered in KAL-31).
- Rewriting tool UX (callout properties, line/arrow quick edits) — covered
  in KAL-33, KAL-34.
- Splitting `App.jsx` — covered in KAL-11.

---

## 10. Follow-up Linear issues filed from this spec

| Local id | Title | Linear id | Tier |
| --- | --- | --- | --- |
| Gap A | Add document sign-off / release / lock state | **KAL-49** | Pre-MVP |
| Gap B | First-class document revision / version history | **KAL-48** | Post-release |
| Gap C | Implement native / editable PDF export (`bakeAnnotationsIntoPdf`) | **KAL-50** | Post-release |

---

## 11. Maintenance

Update this file when:

- A locked product decision changes (roles, export scope, share defaults).
- A new MVP workflow step is added (e.g. a new annotation tool, a new export
  surface, a new collaboration role).
- A gap is closed by a Linear ticket — update the support cell + add the
  closed-issue link as evidence.

Do **not** treat this file as an implementation plan. Per-feature plans live
in `.planning/phases/`. This file is the canonical end-to-end **product**
workflow.
