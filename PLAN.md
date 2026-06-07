# Plan: Redesign the Excel ↔ Survey Marker sync so it never silently loses data
_Locked via grill — by Claude + Isaiah (2026-06-07). Revised after Codex review round 1._

> Companion docs: `.planning/optimization/EXCEL-SYNC-MAP.md` (how it works today, with file:line) and `.planning/optimization/EXCEL-SYNC-UX-PLAYBOOK.md` (collaboration UX, proven by Figma/Google/Linear/Notion/Bluebeam/MS 365). This plan is the build contract; the two companions are the evidence.

## Goal

Make the linked-Excel survey workflow trustworthy and collaborative. The app's own store (durable Y.Doc + Supabase) is the **sole authority** for a Survey Marker's existence and on-page geometry. Excel is an **asynchronous attribute mirror** (answers, name, note, entity) — it may edit attributes of existing markers and may *propose* new rows into an import inbox, but it can **never** create a placed marker, delete a placed marker, or touch geometry. We cannot write into a workbook a user has open; persistent-style workbook sessions are available on OneDrive-for-Business/SharePoint but not on consumer/personal OneDrive (local files use the main-process lock/write contract in Stage 3, not Graph sessions); and there is no real-time co-author hook — so "live" means fast polling with patch-only writes to owned ranges, guarded by an app-side lease + a per-flush workbook session + read-latest → merge → write (not a range-level eTag), backed by a **durable per-document outbound queue** (the queue is the durable thing; workbook sessions are created/refreshed per flush, not assumed durable).

## Core safety invariants (hold from the first commit, every stage)

1. **No Excel-origin deletion of a placed Survey Marker, ever.** A row missing from Excel means "row absent upstream" (a signal surfaced for review) — it is NOT a delete instruction and NEVER removes a marker or its geometry.
2. **Excel import is patch-only and additive.** Imports apply allowed attribute patches through a dedicated import transaction; they never run whole-map reconciliation and never delete Y.Map keys, `annotationsByPage` entries, or canvas objects (the geometry path that today gets captured via `applyByPage`).
3. **Excel can never trigger a deletion** (invariant 1). App-origin deletes become recoverable **canonical tombstones** in Stage 2 (never a hard delete, never a "delete-the-row-then-its-status-cell-too" scheme); until Stage 2 lands, *unintended* loss is already closed by invariant 1 + the Stage 0 writeback kill-switch, so no stage widens the risk.
4. **No name-string matching of a placed marker.** Identity is a stable owned ID. Legacy/no-ID/ambiguous rows are quarantined for review, never name-guessed back onto a placed marker. **Until stable IDs exist (Stage 1), inbound import is review-only for placed markers** — no attribute is written onto a placed marker without a trusted ID match.
5. **Outbound writes patch only app-owned ranges/tables** — never a whole-workbook rebuild that can stomp user formatting, extra sheets, comments, filters, or a concurrent editor. Concurrency is guarded by an **app-side per-workbook sync lease + a workbook session + read-latest → merge → write**, NOT by an `If-Match` precondition on range writes (Graph's range-update endpoint does not honor `If-Match`; eTag/`If-Match` is used only for file-content–level operations where Graph documents it).
6. **Every sync action is journaled** (attempt id, origin, workbook id + eTag, baseline hash, rows changed/missing/quarantined, prevented deletions, queue depth, retry cause, recovery action).
7. **No Excel-sync edit may touch the contract-mandated correctness invariants** — container-aware canvas sizing, single-name `fontFamily`, the `zoomGeneration` signal, and no JS zoom coordination in `SVGAnnotationLayer.jsx`. A diff that strays near them is a boundary violation.
8. **The VISIBLE Excel workbook contract is frozen** (sheet names, header/column order, formatting, validations, widths) — guarded by the builder-output snapshot test. The builder is the only path that creates a workbook; patch writes run only against a workbook it already created. Stage 1 may add *hidden* reserved ID/metadata columns as snapshot-approved additive drift — the visible contract still must not change.

## Approach (staged; each stage is independently shippable and never widens the data-loss risk — Stage 0 closes it, later stages add recovery)

**Stage 0 — Stop the bleeding + the safety contract.**
- Add a dedicated **import transaction API**: imports apply attribute patches only; remove the import path's ability to call whole-map reconciliation or to delete keys/geometry. **Whitelist the fields an import may write** (answers / name / note / entity) so an import can never set geometry (`pageNumber`/`bounds`) or introduce a placed marker, and treat `protectedIds` as write-protected for imports (not delete-protected only). Plumb a real `origin='excel-import'` through `useAnnotationDoc` → `applySurveyMarkers` (today it passes no origin) and `annotationDocSync` (today hardcodes `origin:'local'`).
- **Kill-switch automatic Excel writeback.** Until Stage 3's safe patch-writer + durable queue land, disable automatic full-file re-upload and live-sync writeback (the current whole-workbook rebuild path); leave only an explicit manual export-to-a-clean-copy. This closes the window where Stages 0–2 could otherwise still fire the old rebuild and stomp a concurrent editor's file.
- Make `syncSurveyMarkersToDoc` additive for imports (it currently deletes missing keys *before* setting changed keys — a crash mid-way leaves a partial durable deletion). Excel imports never delete keys; app-origin hard deletes are left as-is (not expanded) in Stage 0 and become recoverable tombstones in Stage 2.
- Disable **all** Excel-origin deletes of placed markers and **all** auto-creation of markers into the canonical store (unmatched rows go to an import inbox, Stage 1).
- Persist durable per-marker metadata: `createdByApp`, `exportedAt` / `exportAckEtag`, pending-operation ids — so "app-created and not yet confirmed-exported" is actually knowable.
- Replace the broken watermark: stop using `selectedTemplate.updatedAt`; store and compare workbook **eTag + sheet/content hash** with the last merged baseline.
- Load a **durable baseline** (not the in-memory ref) before any import decision; **fail closed to "review required"** when no baseline exists.
- Block any auto-import until canonical Y.Doc hydration + baseline load + outbound-queue load all complete; cancel a scheduled import if the user makes a local edit first.
- Stand up the **sync journal** now (invariant 6) so every later stage is observable.

*Acceptance:* Given a Survey Marker placed in the app and not yet exported, when the app reopens and Excel looks newer, then the marker remains on the page and in the durable store, and the journal records a prevented deletion. Given no stored baseline, when the app opens, then no automatic import runs. Given **any** inbound path — manual import (`executeExcelImport`), auto import (`executeAutoExcelImport`), file-watch / live polling, or workbook session sync — when it runs, then it routes through the patch-only import transaction API and no direct destructive path remains. Given a sheet without trusted marker IDs, when import runs, then no attribute is written onto a placed marker (review-only) until Stage 1 identity exists.

*Test gates:* before any Stage 0 code ships, three tests must exist and pass — an **origin-guard** test (an `excel-import` write never deletes a Y.Doc marker absent from the import; a `local` write does), a **never-delete-placed-marker** test, and a **durable-baseline** test (a fresh handle with no in-memory baseline is treated as dirty). Before any **Stage 1** builder/parser/schema change (it also guards the Stage 3 cutover), a **builder-output snapshot** test must exist and pass, freezing today's sheet names, header/column order, hidden metadata cells, column widths, and color codes so any unapproved drift fails immediately.

**Stage 1 — Identity & schema integrity.**
- Define **reserved sync columns + a very-hidden metadata sheet**; teach the schema parser to reserve/skip them (today it skips only `Changed By / Changed Date / Item / Entity / Notes`, so new hidden columns would read as a schema change).
- **Keep the new-checklist-item modal exactly as-is.** `NewColumnsModal` (the dialog shown when Excel has a new checklist item / column) is preserved unchanged, including the "Modify disabled when the template is shared" cross-survey protection. The Stage-1 hidden ID/metadata columns and every reserved header go into a single shared `SYSTEM_COLUMNS` constant in `src/viewerShared.js` that replaces the four inline skip-list literals (`PDFViewer.jsx:13070, 13487, 14244, 14412`), so reserved columns never read as a new checklist item. No other change to the modal or its trigger logic is permitted.
- Stable IDs at three levels, stored in column/sheet metadata, not inferred from text: **marker id**, **checklist-item id** (checklist columns are matched by header text today → duplicate/renamed labels map answers to the wrong item), and **entity id** (entity is name-matched today → unknown entity edits silently drop).
- Detect missing / duplicate / moved IDs and **quarantine** rather than guess. No automatic name fallback for a placed marker.
- **One-time controlled ID-stamping migration** for existing linked sheets: stamp IDs only onto rows that are *unambiguous* against the current app baseline; everything else quarantines for manual re-link. No placed marker is name-guessed during backfill.
- **Durable import inbox** for unmatched Excel rows: proposals persist across reload, carry the source workbook eTag/hash + row identity, and are auditable (they are not canonical Survey Markers until a user accepts/places them).

*Acceptance:* Given a row renamed in Excel, when imported, then the marker keeps its geometry and only its name attribute changes. Given a duplicated or unknown checklist header, when imported, then those responses are quarantined, not written to the wrong item. Given IDs are stripped, copied, or duplicated in the sheet, when imported, then affected rows quarantine and require manual re-link — no placed marker is matched by name. Given the app is restarted, when there were pending inbox proposals, then they are still present and attributed to their source workbook revision.

**Stage 2 — Tombstones, trash, and history (before any silent overwrite UX).**
- Replace hard-delete paths (including `deleteAnnotations` for markers) with **canonical tombstones**; build the **recoverable trash** (30-day retention, per-project configurable, restore + filter-by-deleter).
- Ship **field-level activity/history** here — it is the recovery net that *licenses* silent last-writer-wins, so it must exist before silent overwrites are enabled.
- Align the ownership gate (today `PDFViewer.jsx:22443` restricts removal): per the owner's decision anyone may edit/remove, so relax it in the same stage that trash + audit land (never relax destructiveness ahead of recovery).

*Acceptance:* Given any marker deletion (app or via the merge surface), when it happens, then the marker is recoverable from trash for the retention window and the action appears in history with author + time.

**Stage 3 — Outbound write safety + durable queue (before re-enabling automatic Excel writes).**
- Replace the whole-workbook rebuild (`PDFViewer.jsx:11777`) with **patch-only writes to app-owned tables/ranges**. Guard concurrency with an **app-side per-workbook sync lease + a per-flush workbook session + read-latest → merge → write** — do **not** rely on `If-Match` on range PATCH (Graph does not honor it there); use eTag/`If-Match` only at the file-content level where Graph documents it. Sessions are **created/refreshed each flush and not assumed durable** across app quit / token loss / conflicts — a session Graph reports invalid is discarded and recreated; the **outbound queue** (below) is the only thing that must persist. **Spike gate:** before relying on any concurrency primitive, prove on the exact endpoints which of workbook-session-id / app-lease / eTag each actually honors.
- **Keep the sheet builder for creation.** `handleExportSurveyToExcel` (`11782–12229`) is extracted unchanged into a `buildWorkbookSchema()` helper; only the writeBuffer/upload tail (`12230–12393`) is replaced. The builder remains the path for first-time export, new-sheet creation, and "export a clean copy"; patch-only writes run only against a workbook the builder already created.
- **Formatting is applied once, never on patch.** The patch path must NOT re-apply conditional formatting or data-validation dropdowns (they live in OOXML parts a range PATCH doesn't touch); re-applying would duplicate rules over time.
- Add a **per-workbook sync lease** so two clients can't both upload stale snapshots (last-upload-wins across the whole file today).
- Build the **durable per-document outbound queue** that survives app quit, token expiry, network loss, file rename, and multiple devices: idempotency keys, base eTag/hash, operation order, retry state, visible queue depth. On reconnect/flush: **read latest workbook → merge against each queued op's base → write under the workbook session + lease** (never flush blindly, or offline Excel edits get clobbered).
- Normalize Graph errors into the retry policy: `423`, `412`, **`accessConflict`, `invalidSessionAccessConflict`, and `Retry-After`** throttling — not just `423`/`412`.
- **Product-gate by surface:** consumer/personal OneDrive supports sessionless range operations but **not persistent workbook sessions** (`createSession`), so it has weaker concurrency guarantees — keep it **read/import-only** (writeback only export-to-a-copy) until a session-safe, feature-preserving patch path is proven; OneDrive-for-Business / SharePoint = workbook-API patch writes with a per-flush workbook session; local file = a **main-process, platform-specific lock/write contract** (Electron `writeFile` can silently overwrite an open file on POSIX — do not assume a sharing violation). **Spike gate before implementation:** if reliable local-file lock detection proves unachievable in this runtime, local `.xlsx` degrades to manual export/import only. Test each surface separately with Excel actually open.

*Acceptance:* Given a teammate has the workbook open, when I edit in the app, then my change is durable locally, queued with a visible "syncing when free" state, and lands in Excel without overwriting their concurrent edits or their formatting once the file is free.

**Stage 4 — Conflict model.**
- Per-field **revisions sourced from the app store** are the clock (Excel's `Changed Date` is a formatted date, not a durable per-field timestamp); treat an Excel edit as "observed at import time."
- **Last-writer-wins on committed values**, superseded value preserved in history. **No prompt** (owner's explicit choice). The one refinement over raw LWW: an **actively-open edit field is never clobbered mid-edit** — the remote value applies when the user commits/blurs, and newest-wins still decides, with both values in history. This preserves the no-prompt decision while preventing "text yanked out from under me."

*Acceptance:* Given two committed answers to the same item, when reconciled, then the newest wins and the older is in history. Given I am mid-typing an answer when a remote change arrives, when it arrives, then my open field is not overwritten until I commit.

**Stage 5 — Quiet collaboration surfaces** (only once the Stage 0–4 safety contract is testable).
- Remote add/edit/delete applies live + silently; visible deletes show a toast with Undo + activity entry; routine edits are silent-with-log. Reopen-after-away folds changes in then shows a non-blocking "N changes while you were away · Review" pill (upgrade to a one-time dismissible panel above a threshold). No popup is ever broadcast to all clients; the only ever-interruption is the (now prompt-free) draft-preservation in Stage 4.

**Stage 6 — Live feel.** Poll/diff cadence spike against real Graph throttling (target 15–30s when reachable, row+field granularity), plus soft presence/attribution chips.

## Migration preflight (one-time, before the new logic runs against a doc)

Snapshot **all** sources first — legacy Supabase rows, local caches, the Y.Doc, and the current Excel — then restore unambiguous mismatches and **quarantine** the rest. Beyond that, residual data loss for already-corrupted docs is acceptable (owner re-uploads); the point of the preflight is to not throw away anything cheaply recoverable and to never auto-"fix" an ambiguous case.

## Key decisions & tradeoffs

- **App store is the sole authority for existence + geometry; Excel is attribute-only and can never place or destroy a placed marker.** Tradeoff: you can't bulk-clear markers by deleting rows in the sheet.
- **Patch-only owned-range writes, guarded by an app-side lease + workbook session (not a range-level eTag) — no whole-workbook rebuild.** Protects user formatting / extra sheets / concurrent editors. Tradeoff: more Graph plumbing than a blind re-upload.
- **Consumer/personal OneDrive is read/import-only** (writeback only via export-to-a-copy until a session-safe, feature-preserving patch path is proven); the safe two-way workbook sync (workbook sessions) requires OneDrive-for-Business/SharePoint or a local file. Tradeoff: feature availability differs by account type — surfaced honestly, not hidden.
- **Last-writer-wins per field, no prompt, but never clobber an open editor; history is the recovery.** Honors the owner's no-prompt choice; rejects Codex's "require a keep/take/compare prompt." Tradeoff: a committed value can be superseded silently — acceptable because it's always in history.
- **Anyone can edit/remove; ownership is soft attribution** — relaxed only alongside trash + audit.
- **No CRDT** — structured attributes + per-field revisions + durable baseline give a real 3-way merge.
- **Recoverable trash + history replace confirmation dialogs**; a real modal is reserved only for permanent purge.

## Risks / open questions

- **Local-file lock feasibility:** gated by the Stage 3 spike — if reliable lock detection isn't achievable in this runtime, local `.xlsx` falls back to manual export/import only (no silent data loss either way).
- **Graph cadence vs throttling:** the 15–30s target is unproven against real rate limits (Stage 6 spike).
- **Migration preflight scope:** how aggressively to auto-restore vs quarantine when sources disagree.

## Preserve / Do-Not-Break

These must keep working **identically**; breaking any one destroys user data, the sheet's appearance, or the inbound-sync contract. (Full detail + file:line in `.planning/optimization/EXCEL-SYNC-IMPACT.md`.)

- **The sheet builder + all formatting** (`handleExportSurveyToExcel`, `11759–12393`): the `_SurveyMetadata` very-hidden sheet and its `B1`/`B2` cells, `createSheetName`, the header-row layout, the three conditional-formatting sets (Y/N/N-A, entity colors, duplicate names), both data-validation dropdowns, column widths, and `ensureSurveyMarkerMetadata` stamping. Extracted (cut-and-lift) in Stage 3, never rewritten. The *visible* output is frozen by the snapshot test; Stage 1 may add hidden reserved ID/metadata columns (snapshot-approved additive drift) but must not alter the visible contract.
- **The upload primitives' binary correctness** (`uploadExcelFile`, `uploadFileContentById`, `uploadFileToDrive`, `getTemplateIdFromExcel`, `getFileETag`): keep the Uint8Array normalization + explicit-MIME Blob; ID-based upload stays preferred.
- **The workbook session lifecycle** (`createWorkbookSession` / `refresh` / `close`): keep the close/error/header semantics and always close sessions. Refresh only sustains an *active long flush* — Stage 3 creates sessions per flush and does not hold one alive across idle time (no contradiction with "per-flush, not durable").
- **The dirty-state hash module** (`computeExcelSyncFingerprint` / `computeHasPendingExcelSyncChanges`): Stage 0 *extends* checkpointing to persist the baseline durably; it does not replace this module.
- **`NewColumnsModal` + its trigger + the shared-template "Modify disabled" protection** (see Stage 1).
- **The contract correctness invariants** (invariant 7).

## Out of scope

- Renderer / zoom-pan-scroll parity and removing Syncfusion (goal 2).
- The broad unification sweep / folding callouts into the standard annotation path (goal 3).
- Moving undo/redo + presence onto the new engine and retiring the old CRDT layer (adjacent; may inform Stage 5, planned separately).
- True real-time co-authoring written into Excel itself (impossible via Graph; abandoned).
