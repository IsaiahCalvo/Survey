# Plan: Redesign the Excel ↔ Survey Marker sync so it never silently loses data
_Locked via grill — by Claude + Isaiah (2026-06-07). Revised after Codex review round 1._
_**Amended 2026-06-08 by Isaiah** — see "Product Decision Amendments" below; those decisions GOVERN where they differ from the original body._

> Companion docs: `.planning/optimization/EXCEL-SYNC-MAP.md` (how it works today, with file:line) and `.planning/optimization/EXCEL-SYNC-UX-PLAYBOOK.md` (collaboration UX, proven by Figma/Google/Linear/Notion/Bluebeam/MS 365). This plan is the build contract; the two companions are the evidence.

## Product Decision Amendments — 2026-06-08 (GOVERNING)

These owner decisions supersede any conflicting text in the original plan body. The
Stage 0 safety fixes already shipped (placed-marker import protection, silent
open-time import gate, additive origin guard) **stay as temporary protection** until
the smarter logic below exists — do not remove them; replace them when the final
behavior lands.

1. **Delete rule — "Excel can only delete what Excel actually received."** Excel *may*
   delete a Survey-panel/PDF item, but **only if that exact item was previously synced
   successfully to Excel** (it carries a confirmed export acknowledgment — `exportedAt` /
   `exportAckEtag`). If the app made a marker and Excel never successfully received it, a
   later missing row can **never** erase it. This **replaces** the original "no
   Excel-origin deletion of a placed marker, ever." Excel-origin deletes still go through
   recoverable tombstones/trash (Stage 2); they are never a hard delete. Until export-ack
   tracking exists, today's temporary "never delete a placed marker on import" guard holds.

2. **New Excel rows go straight to the Survey panel.** A clean new Excel row appears
   directly in the Survey panel as an **unplaced item with the orange search/locate
   button** — it is NOT hidden in an import inbox first. Only genuinely *confusing* rows
   (see #3) need a review step. This **replaces** the original "all unmatched rows go to a
   durable import inbox."

3. **Duplicate names are allowed; only broken identity needs a choice.** Two items with
   the same visible name is fine and normal. The only thing that needs human input is
   **duplicate or broken tracking identity** — two rows carrying the same tracked identity,
   or rows that are truly indistinguishable. Those show **"Needs your choice"** (duplicate
   vs. new item); they are never silently merged.

4. **Every row gets a full visible-value fingerprint.** Independent of any metadata ID,
   every Excel row is fingerprinted from its **exact visible cell values**: Changed By,
   Changed Date, Item/title, **every checklist answer value**, Entity, and the **full
   Notes text**. Use the actual values, not mere presence/absence. This fingerprint is the
   always-on safety/confidence layer for matching, change-detection, and conflict checks.

5. **No user-facing ID columns on the visible sheets.** The durable identity carrier is a
   **hidden, signed (not locked)** `Row ID` column (Amendment #10) — not shown in the normal
   sheet view, so the visible workbook a user reads/edits is unchanged, and sort/filter stay
   free. The very-hidden `_SurveyMetadata` sheet + the app sync record remain the
   secondary/backup store. Row fingerprints (#4) still run for every row as the
   change-detection/fallback layer. See #10.

10. **A hidden `Row ID` (Sync ID) column is the primary identity key (2026-06-08; amended
    same day — the ID column is HIDDEN + signed, NOT locked/sheet-protected).** Add a
    **hidden, text-formatted first column named `Row ID`** to each survey sheet, holding a
    **stable, unique, opaque, HMAC-signed per-Survey-Marker token** — the ID is stable to the
    *marker*, never a positional row number (row positions change). Because it is a real
    (hidden) column, the token **travels with its row** when the user sorts, filters, moves,
    or copies rows. **We do NOT lock the column or protect the sheet:** Excel sort physically
    rewrites every column in a row (including a locked one), so locking Row ID makes Excel
    block sorting AND filtering ("you do not have sufficient permissions to change those
    cells"). Identity is protected instead by being hidden (out of sight) + signed (any edit
    breaks the HMAC → `malformed-rowid` → review). Matching rules: (a) an existing synced
    row whose `Row ID` matches a marker → match by `Row ID`; rename / edited answers / notes /
    entity → **same `Row ID`, update that same marker**. (b) A new row with a **blank** `Row ID`
    → the app assigns a fresh `Row ID` and creates an **unplaced** Survey-panel item
    (Amendment #2). (c) A **duplicate** `Row ID` across rows → **"Needs your choice"**
    (Amendment #3/#7), never a silent merge. (d) An **unknown/edited/tampered** `Row ID` that
    matches no marker → surfaced, never name-guessed. (e) A placed marker whose `Row ID` is
    **missing** from the workbook → never deleted/guessed by name; surfaced for review. Import
    priority is **Row ID first, full-row fingerprint (#4) second, `_SurveyMetadata`/app record
    (#5) third**. **Excel-driven deletion of a placed marker stays OFF until this Row ID system
    is implemented and tested.**

6. **Conflict = both sides changed the same row/field before syncing.** A real conflict
   exists *only* when the same field changed on both sides before a sync reconciled them
   (e.g. app sets an answer to `Y`, can't push yet, then Excel sets that same answer to
   `N`). Merely **placing** a Survey Marker in the app while Excel edits that row's
   answers/notes/entity is **not** a conflict: keep the PDF placement and apply the Excel
   attributes.

7. **Row-level sync problems use a quiet per-row icon, never a global warning.** When a
   single row can't sync, show a **red circled exclamation icon on that Survey-panel row**.
   On hover, explain the issue and the cause/fix when known; if the cause is unknown, say
   only that the item cannot sync yet. Use the exact asset
   `/Users/isaiahcalvo/Downloads/exclamation-circle-svgrepo-com.svg`. Tooltip examples:
   "This item has not synced to Excel yet." · "Excel file is open locally. Close Excel to
   sync this item." · "Two Excel rows look identical. Choose whether this is a duplicate or
   a new item." · "This row cannot sync yet."

8. **Prove each Excel setup before promising live sync.** Before building or promising any
   live-sync behavior, research and prove, per setup, whether the app can push a small
   cell/range change while the workbook is open and whether the open Excel window receives
   it safely: (a) **local `.xlsx` open in desktop Excel**, (b) **personal OneDrive
   workbook**, (c) **Microsoft 365 Business / SharePoint / Teams with AutoSave on**. Work
   toward live sync on every setup where it is technically possible, but do **not** promise
   identical behavior across setups until proven. This hardens the existing Stage 3/6 spike
   gates into a required, written research deliverable.

9. **Identity rewrite must use the full row, not the Item name.** Current export writes
   Changed By, Changed Date, Item, checklist answers, Entity, Notes; current import matches
   mostly by module/category + Item name and deletes by Item-name absence. The rewrite
   fixes this by using the full-row fingerprint (#4) + `_SurveyMetadata`/app-record
   identity (#5) for matching and change-detection — never Item name alone.

## Goal

Make the linked-Excel survey workflow trustworthy and collaborative. The app's own store (durable Y.Doc + Supabase) is the **sole authority** for a Survey Marker's existence and on-page geometry. Excel is an **asynchronous attribute mirror** (answers, name, note, entity) — it may edit attributes of existing markers and a clean new row appears **directly in the Survey panel** as an unplaced item (Amendment #2); it can **never** create a *placed* marker or touch geometry, and may delete only a marker it previously received/acknowledged (Amendment #1), always recoverably. We cannot write into a workbook a user has open; persistent-style workbook sessions are available on OneDrive-for-Business/SharePoint but not on consumer/personal OneDrive (local files use the main-process lock/write contract in Stage 3, not Graph sessions); and there is no real-time co-author hook — so "live" means fast polling with patch-only writes to owned ranges, guarded by an app-side lease + a per-flush workbook session + read-latest → merge → write (not a range-level eTag), backed by a **durable per-document outbound queue** (the queue is the durable thing; workbook sessions are created/refreshed per flush, not assumed durable).

## Core safety invariants (hold from the first commit, every stage)

1. **Excel may delete only items it actually received** *(amended 2026-06-08 — Amendment #1)*. A missing row deletes a marker **only if that marker carries a confirmed export acknowledgment** (`exportedAt`/`exportAckEtag`); a missing row for an app-created marker Excel never received is "row absent upstream" — surfaced for review, never a delete. Excel-origin deletes are always recoverable tombstones (Stage 2), never a hard delete or a geometry wipe. *(Until export-ack tracking ships, the temporary Stage 0 guard deletes no placed marker at all.)*
2. **Excel import is patch-only and additive.** Imports apply allowed attribute patches through a dedicated import transaction; they never run whole-map reconciliation and never delete Y.Map keys, `annotationsByPage` entries, or canvas objects (the geometry path that today gets captured via `applyByPage`).
3. **Excel-origin deletes are recoverable and scoped to received items** (invariant 1 / Amendment #1). Both app-origin and the now-allowed Excel-origin deletes become recoverable **canonical tombstones** in Stage 2 (never a hard delete, never a "delete-the-row-then-its-status-cell-too" scheme); until Stage 2 lands, *unintended* loss is already closed by invariant 1 + the Stage 0 writeback kill-switch, so no stage widens the risk.
4. **No Item-name-only matching of a placed marker.** Identity comes from the full-row fingerprint (Amendment #4) + `_SurveyMetadata`/app-record identity (Amendment #5), never the Item name alone. Duplicate *names* are fine; only broken/duplicate tracking identity needs a "Needs your choice" (Amendment #3). Rows whose identity is genuinely ambiguous are surfaced for review, never name-guessed back onto a placed marker. **Until the identity rewrite exists (Stage 1), inbound import is review-only for placed markers** — no attribute is written onto a placed marker without a confident fingerprint/identity match.
5. **Outbound writes patch only app-owned ranges/tables** — never a whole-workbook rebuild that can stomp user formatting, extra sheets, comments, filters, or a concurrent editor. Concurrency is guarded by an **app-side per-workbook sync lease + a workbook session + read-latest → merge → write**, NOT by an `If-Match` precondition on range writes (Graph's range-update endpoint does not honor `If-Match`; eTag/`If-Match` is used only for file-content–level operations where Graph documents it).
6. **Every sync action is journaled** (attempt id, origin, workbook id + eTag, baseline hash, rows changed/missing/quarantined, prevented deletions, queue depth, retry cause, recovery action).
7. **No Excel-sync edit may touch the contract-mandated correctness invariants** — container-aware canvas sizing, single-name `fontFamily`, the `zoomGeneration` signal, and no JS zoom coordination in `SVGAnnotationLayer.jsx`. A diff that strays near them is a boundary violation.
8. **The VISIBLE Excel workbook contract is frozen** (sheet names, header/column order, formatting, validations, widths) — guarded by the builder-output snapshot test. The builder is the only path that creates a workbook; patch writes run only against a workbook it already created. **No new hidden columns or hidden rows are added to the visible sheets** *(amended 2026-06-08 — Amendment #5)*; durable identity metadata lives only in the very-hidden `_SurveyMetadata` sheet + the app's own sync record. The snapshot test now also fails on any new hidden column/row on a visible sheet.

## Approach (staged; each stage is independently shippable and never widens the data-loss risk — Stage 0 closes it, later stages add recovery)

**Stage 0 — Stop the bleeding + the safety contract.**
- Add a dedicated **import transaction API**: imports apply attribute patches only; remove the import path's ability to call whole-map reconciliation or to delete keys/geometry. **Whitelist the fields an import may write** (answers / name / note / entity) so an import can never set geometry (`pageNumber`/`bounds`) or introduce a placed marker, and treat `protectedIds` as write-protected for imports (not delete-protected only). Plumb a real `origin='excel-import'` through `useAnnotationDoc` → `applySurveyMarkers` (today it passes no origin) and `annotationDocSync` (today hardcodes `origin:'local'`).
- **Kill-switch automatic Excel writeback.** Until Stage 3's safe patch-writer + durable queue land, disable automatic full-file re-upload and live-sync writeback (the current whole-workbook rebuild path); leave only an explicit manual export-to-a-clean-copy. This closes the window where Stages 0–2 could otherwise still fire the old rebuild and stomp a concurrent editor's file.
- Make `syncSurveyMarkersToDoc` additive for imports (it currently deletes missing keys *before* setting changed keys — a crash mid-way leaves a partial durable deletion). Excel imports never delete keys; app-origin hard deletes are left as-is (not expanded) in Stage 0 and become recoverable tombstones in Stage 2.
- Disable **all** Excel-origin deletes of placed markers (the temporary guard; the final received-only rule lands once export-ack tracking exists — Amendment #1). Clean new Excel rows surface as **unplaced Survey-panel items with the orange locate button** (Amendment #2), not in a hidden inbox; only genuinely ambiguous rows get a review surface (Stage 1).
- Persist durable per-marker metadata: `createdByApp`, `exportedAt` / `exportAckEtag`, pending-operation ids — so "app-created and not yet confirmed-exported" is actually knowable.
- Replace the broken watermark: stop using `selectedTemplate.updatedAt`; store and compare workbook **eTag + sheet/content hash** with the last merged baseline.
- Load a **durable baseline** (not the in-memory ref) before any import decision; **fail closed to "review required"** when no baseline exists.
- Block any auto-import until canonical Y.Doc hydration + baseline load + outbound-queue load all complete; cancel a scheduled import if the user makes a local edit first.
- Stand up the **sync journal** now (invariant 6) so every later stage is observable.

*Acceptance:* Given a Survey Marker placed in the app and not yet exported, when the app reopens and Excel looks newer, then the marker remains on the page and in the durable store, and the journal records a prevented deletion. Given no stored baseline, when the app opens, then no automatic import runs. Given **any** inbound path — manual import (`executeExcelImport`), auto import (`executeAutoExcelImport`), file-watch / live polling, or workbook session sync — when it runs, then it routes through the patch-only import transaction API and no direct destructive path remains. Given a sheet without trusted marker IDs, when import runs, then no attribute is written onto a placed marker (review-only) until Stage 1 identity exists.

*Test gates:* before any Stage 0 code ships, three tests must exist and pass — an **origin-guard** test (an `excel-import` write never deletes a Y.Doc marker absent from the import; a `local` write does), a **never-delete-placed-marker** test, and a **durable-baseline** test (a fresh handle with no in-memory baseline is treated as dirty). Before any **Stage 1** builder/parser/schema change (it also guards the Stage 3 cutover), a **builder-output snapshot** test must exist and pass, freezing today's sheet names, header/column order, hidden metadata cells, column widths, and color codes so any unapproved drift fails immediately.

**Stage 1 — Identity & schema integrity.** *(reshaped by the 2026-06-08 amendments)*
- **Full-row fingerprint for every row** (Amendment #4): compute a fingerprint from the exact visible values — Changed By, Changed Date, Item/title, every checklist answer value, Entity, and full Notes text — for *every* Excel row, independent of any metadata ID. This is the always-on matching/change-detection/confidence layer.
- **Durable identity in `_SurveyMetadata` + the app sync record only — no hidden columns/rows on the visible sheets** (Amendment #5). Store marker / checklist-item / entity identity in the very-hidden metadata sheet and the app's own record. Teach the schema parser to read identity there and to treat the visible header exactly as today (skip `Changed By / Changed Date / Item / Entity / Notes`); the parser must never invent or require hidden visible-sheet columns.
- **Keep the new-checklist-item modal exactly as-is.** `NewColumnsModal` (the dialog shown when Excel has a new checklist item / column) is preserved unchanged, including the "Modify disabled when the template is shared" cross-survey protection. The system skip-list goes into a single shared `SYSTEM_COLUMNS` constant in `src/viewerShared.js` that replaces the four inline skip-list literals (`PDFViewer.jsx:13070, 13487, 14244, 14412`); since no new visible columns are added, this is just a de-duplication so the existing reserved headers stay consistent. No other change to the modal or its trigger logic is permitted.
- **Matching uses fingerprint + metadata identity, never Item name alone** (Amendment #9). Checklist columns and entities resolve by stored identity, not header/name text, so renamed/duplicate labels no longer map answers to the wrong item.
- **Clean new rows → straight to the Survey panel** as unplaced items with the orange locate button (Amendment #2). They are real proposed Survey Markers (unplaced), not hidden inbox entries.
- **Duplicate names allowed; only broken identity asks** (Amendment #3). Two rows with the same name is fine. Only duplicate/broken tracking identity — same tracked identity on two rows, or truly indistinguishable rows — shows **"Needs your choice"** (duplicate vs. new item). Never silently merge.
- **One-time controlled identity backfill** for existing linked sheets: assign stored identity only to rows that are *unambiguous* against the current app baseline (by fingerprint); everything ambiguous gets the per-row "Needs your choice" rather than a guess. No placed marker is name-guessed during backfill.

*Acceptance:* Given a row renamed in Excel, when imported, then the marker (matched by fingerprint + stored identity) keeps its geometry and only its name attribute changes. Given a clean new row, when imported, then it appears in the Survey panel as an unplaced item with the orange locate button — not hidden in an inbox. Given two rows with the same name, when imported, then both are kept (no merge). Given two rows that share a tracked identity or are truly indistinguishable, when imported, then the affected row shows the red per-row "Needs your choice" icon and nothing is written onto a placed marker by guess. Given any change, then no new hidden column/row is written to a visible sheet.

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
- **A conflict exists only when the same row/field changed on both sides before a sync reconciled them** (Amendment #6). App sets an answer to `Y`, can't push, then Excel sets that same answer to `N` → conflict. **Placing** a marker in the app while Excel edits that row's answers/notes/entity is **not** a conflict: keep the PDF placement and apply the Excel attributes. The full-row fingerprint + per-field revisions are what detect "both changed."
- Per-field **revisions sourced from the app store** are the clock (Excel's `Changed Date` is a formatted date, not a durable per-field timestamp); treat an Excel edit as "observed at import time."
- **Last-writer-wins on committed values**, superseded value preserved in history. **No prompt** (owner's explicit choice). The one refinement over raw LWW: an **actively-open edit field is never clobbered mid-edit** — the remote value applies when the user commits/blurs, and newest-wins still decides, with both values in history. This preserves the no-prompt decision while preventing "text yanked out from under me."

*Acceptance:* Given two committed answers to the same item, when reconciled, then the newest wins and the older is in history. Given I am mid-typing an answer when a remote change arrives, when it arrives, then my open field is not overwritten until I commit.

**Stage 5 — Quiet collaboration surfaces** (only once the Stage 0–4 safety contract is testable).
- Remote add/edit/delete applies live + silently; visible deletes show a toast with Undo + activity entry; routine edits are silent-with-log. Reopen-after-away folds changes in then shows a non-blocking "N changes while you were away · Review" pill (upgrade to a one-time dismissible panel above a threshold). No popup is ever broadcast to all clients; the only ever-interruption is the (now prompt-free) draft-preservation in Stage 4.
- **Per-row sync-problem icon** (Amendment #7): when an individual row can't sync, render a **red circled exclamation icon on that Survey-panel row** (asset `/Users/isaiahcalvo/Downloads/exclamation-circle-svgrepo-com.svg`) with a hover tooltip explaining the issue + cause/fix when known, or just "This row cannot sync yet." when the cause is unknown. This is the per-row channel for the "Needs your choice" (Amendment #3), "not synced to Excel yet," and "Excel open locally" states — never a global warning banner.

**Stage 6 — Live feel.** Poll/diff cadence spike against real Graph throttling (target 15–30s when reachable, row+field granularity), plus soft presence/attribution chips.

## Migration preflight (one-time, before the new logic runs against a doc)

Snapshot **all** sources first — legacy Supabase rows, local caches, the Y.Doc, and the current Excel — then restore unambiguous mismatches and **quarantine** the rest. Beyond that, residual data loss for already-corrupted docs is acceptable (owner re-uploads); the point of the preflight is to not throw away anything cheaply recoverable and to never auto-"fix" an ambiguous case.

## Key decisions & tradeoffs

- **App store is the sole authority for existence + geometry; Excel is attribute-only and can never *place* a marker.** Excel *may* delete, but only an item it previously received and acknowledged (Amendment #1), always recoverably. Tradeoff: deleting a row only clears markers Excel already had; app-created-but-unexported work is safe from row-absence.
- **Patch-only owned-range writes, guarded by an app-side lease + workbook session (not a range-level eTag) — no whole-workbook rebuild.** Protects user formatting / extra sheets / concurrent editors. Tradeoff: more Graph plumbing than a blind re-upload.
- **Live sync is pursued on every setup where it's technically possible, but proven per setup before promising it** (Amendment #8): local `.xlsx` in desktop Excel, personal OneDrive, and M365 Business/SharePoint/Teams with AutoSave each get a written capability proof (can the app push a small range change while the workbook is open, and does the open window receive it safely). Until a setup is proven session-safe, it stays read/import-only (writeback via export-to-a-copy). Tradeoff: feature availability differs by account type — surfaced honestly, not hidden, and not promised before proof.
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

- **The sheet builder + all formatting** (`handleExportSurveyToExcel`, `11759–12393`): the `_SurveyMetadata` very-hidden sheet and its `B1`/`B2` cells, `createSheetName`, the header-row layout, the three conditional-formatting sets (Y/N/N-A, entity colors, duplicate names), both data-validation dropdowns, column widths, and `ensureSurveyMarkerMetadata` stamping. Extracted (cut-and-lift) in Stage 3, never rewritten. The *visible* output is frozen by the snapshot test; per Amendment #5 **no new hidden columns/rows are added to the visible sheets** — durable identity metadata lives only in the very-hidden `_SurveyMetadata` sheet + the app sync record.
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

---

# Amendment 2026-06-08(b) — Identity assignment, copy/paste, repeated-save dedup, safe writeback, Microsoft auth (GOVERNING)
_Locked via grill — Claude + Isaiah, after live testing of the shipped Row ID matcher (commits `0b995c2a`, `1320015c`) and two research passes (Excel writeback feasibility; Microsoft auth passwordless). These decisions GOVERN where they differ from anything above, including Amendment #3 for the copy case (noted inline)._

## Problems observed live (2026-06-08)
1. **Copying a row in Excel copies the hidden Row ID too** → two rows share one token. Copy/paste must "just work": the copy becomes a brand-new item with its own identity, with no hand-editing of the ID.
2. **Saving the same new row N times creates N duplicate Survey Markers.** The app remembers fingerprints only for rows it *exported*, never for rows it *imported*, so an imported row looks brand-new on every save. (Reproduced: item "3", Cmd-S ×3 → three "3" items.)
3. **"Pull from Excel" is broken** — a file-save auto-import created the new blank-ID row, but the manual "Pull from Excel" action did not; it returned `Updated 2 items, deleted 0 items. 6 row(s) need your choice.` The matcher logs nothing, so the cause is invisible.

## Capability matrix — do NOT treat all Excel setups the same
| Setup | Import / read | Live cell writeback while file is OPEN | ID-writeback policy |
|---|---|---|---|
| **Local file** (`.xlsx` on disk) | Yes | **NO** — macOS Excel autosave silently overwrites a write-under-open (data loss; research-verified). | **Queue** the new Row IDs; flush only when Excel is **closed** (detect the `~$file.xlsx` lock sentinel) or on the next app-initiated export. Never write under an open file. |
| **Personal OneDrive (MSA/consumer)** | Yes | **Do NOT promise** Graph workbook cell/range sync (session APIs are work/school only). Treat like local/sync-folder. | Queue until safe; no live cell PATCH; verify real behavior before enabling anything more. |
| **Business OneDrive / SharePoint / Teams (work/school M365)** | Yes | **YES** — Graph persistent workbook session + cell-range PATCH merges into the live co-authored workbook (app owns column A; user never edits it → non-conflicting). Requires a **new single-cell column-A patch writer** (the existing whole-file/whole-range path is NOT this). | The **only** setup where live cell writeback is enabled — and only after it is tested against a working Business M365 account. |

Live writeback is **capability-gated**: built behind a gate now with automated tests/mocks; **off** until validated on a real Business M365 account. Local + personal use the queue-until-safe path, which is fully testable today.

## Approach
1. **App is the sole identity authority (file-type-independent).** On import, per scope: valid unique in-scope token → match (shipped, rename-safe). **Blank Row ID** → first consult the pending-writeback alias (step 2) and recover by content against leftover exported markers; if still none, it's genuinely new. Either way the app **assigns a fresh signed token** and remembers it (alias + identity record). **Duplicate token (copy/paste with the ID intact)** → resolve by **binding + position, never by content-best-match** (which can steal identity if the user edits the original and leaves the copy unchanged — Codex R1). Rule: the token stays bound to the marker the app's record already maps it to; among the rows carrying that token, the **bound (original) row retains the binding** and the **later duplicates become new items with freshly-minted signed tokens**. The auto-rule fires when the **bound row still holds its baseline relative order/locator and the duplicate is an INSERTED row that appears AFTER it** (the normal copy-paste-below case). It goes to **"needs your choice"** when the duplicate appears **before or displaces** the baseline row, when the order around the bound row can't be trusted, or when the bound marker can't be tied to any carrying row — no positional guess on an untrusted order (Codex R2/R3). This is a **matcher redesign** (today the matcher sends every duplicate to review) built around duplicate *groups* with new tests — not a caller-only change. Foreign/wrong-scope/malformed tokens stay review-only.
2. **Remember imported rows IMMEDIATELY — identity record + durable pending alias.** When the app creates OR updates a marker from an imported row, stamp the marker with the same durable identity record it stamps on export (full-row + identity-vector fingerprints, the assigned token) AND write a durable **pending-writeback alias**: `{ workbookId/path, sheetId/name, scope, assignedMarkerId, assignedToken, rowLocator, expectedOldCellValue, pendingRowIdWriteback:true }`. The matcher consults the alias **before creating any marker**, so (a) a not-yet-written row is never re-created on the next save (fixes problem 2 / repeated-save churn), and (b) a row whose *content* the user edits before writeback can still resolve via the alias. **Alias resolution must identify EXACTLY ONE row** (using sheet + assigned token + expected-old-value + content together, since the sheet does not yet carry the new token and the old value may be blank/shared across duplicates); if zero or more than one candidate, **review** instead of creating or applying (Codex R2). The alias is best-effort; the durable fix is writing the token back ASAP (step 3). **Persist identity/alias stamping even when no user-visible field changed** — do NOT gate it on `updatesCount>0` (Codex R1) — keeping it out of the *content* dirty fingerprint, but a row whose ID is not yet written back is NOT fully synced, so surface a **separate "pending writeback (N)" sync state + queue depth** distinct from content-dirty (Codex R2).
3. **Writeback queue (capability-gated, safe-only, verified, durable).** A **durable queue + alias store**, scoped by file type so a second device can't recreate pending rows (Codex R3): **local files** use a per-device localStorage store (mirroring the existing sync-baseline / secret stores); **cloud workbooks** (business/personal OneDrive) keep the queue + aliases in the **shared app store** (Y.Doc / Supabase). Real schema: `{ workbookId, path, sheetId, sheetName, scope, rowLocator, expectedOldCellValue, newToken, markerId, retryState, lastAttemptAt }`. **Import fails CLOSED until the queue + aliases are hydrated** — no import may race the load and re-create rows that are merely pending (Codex R2). Flush only via a safe path per the capability matrix: **business-Graph → a NEW single-cell column-A patch writer** (the existing whole-workbook/full-file path behind the writeback kill-switch is NOT a cell PATCH and must not be reused — Codex R1); **local/personal → only when Excel is closed, or when an app export wrote the linked workbook through a proven-safe path / relinked to a clean copy** — an export *attempted* to a linked file open in Excel is itself the unsafe path and does NOT clear the queue (Codex R2). **Clear `pendingRowIdWriteback` only after a READ-BACK** of the target cell confirms it now equals the assigned token (Codex R1). "Excel is closed" is judged from **multiple signals** (the `~$file.xlsx` lock sentinel + file-mtime stability + a write/readback probe), failing to manual export when uncertain.
4. **Diagnose & fix "Pull from Excel" (problem 3).** Two parts. (a) **Fix the concrete bug Codex found:** manual pull downloads by *path* (`downloadExcelFileByPath`) while auto-sync prefers *file id*; a SharePoint `oneDriveApiPath` of the form `/drives/{driveId}/items/{id}` is wrapped incorrectly as a root path — so make manual pull **prefer `oneDriveFileId`** and path-fallback only for real root paths. (b) **Logging-first for the local mystery:** the user's failing case was a *local* file where (a) does not apply, so add **privacy-bounded** per-row matcher logging — row number, token *class*, a short token *hash* (never the token), decision, reason, queue state, workbook/sheet ids — reproduce, and fix the real defect. No fix to the local path before the cause is seen.
5. **Microsoft auth via the system browser (root cause confirmed in code).** Today the app runs Microsoft OAuth inside an **embedded Electron `BrowserWindow`** (`oauth:openWindow` loads `login.microsoftonline.com` in a sandboxed Chromium window) using **`@azure/msal-browser`** (Microsoft says it is **not supported in Electron**), and hand-rolls PKCE in the renderer. Microsoft only renders passkeys/FIDO2, Windows Hello, and phone sign-in in a **system browser** with real WebAuthn/platform-authenticator access. **Fix:** move sign-in to **`@azure/msal-node`'s `acquireTokenInteractive`** opening the **system browser** via `shell.openExternal` with a **loopback (`http://localhost`) redirect**. **Keep the MSAL cache + refresh tokens in the MAIN process; expose only narrow IPC (`msgraph:getAccessToken` / status) to the renderer — never hand raw refresh tokens across IPC** (Codex R1). **Decision (no open fork): the main-process MSAL token cache is the source of truth**; the Supabase `connected_services` row is reduced to a "connected" marker, not the refresh-token store. Old rows that still hold a Supabase refresh token get a **one-time reconnect/dual-read migration** (read the legacy token once to seed the MSAL cache, or prompt a single re-sign-in), after which the MSAL cache owns refresh (Codex R2). Graph/Excel **scopes unchanged**. **Azure app-registration change:** add a **"Mobile and desktop applications"** platform with redirect `http://localhost` and enable **allow public client flows**.
6. **Three separate layers, never blurred.** Supabase passkeys log the user into the **Survey app**; they do **not** authenticate Microsoft and do **not** grant OneDrive/Excel Graph access. Graph access needs a Microsoft token from a Microsoft sign-in. Verify nothing in the code conflates them.
7. **Capability gating + tests.** Build/verify everything testable locally now (identity assignment, import memory, dedup, duplicate-token resolution, local "Excel-closed" flush, Pull-from-Excel fix, matcher logging). Cover the business-Graph writeback path with automated tests/mocks; mark it capability-gated. The forgotten-password / passwordless-blocked Microsoft login must NOT stall the local-testable work.

## Key decisions & tradeoffs (bite here)
1. **App is the identity authority, not an Excel formula.** Research is conclusive: no native formula yields a stable, non-volatile, HMAC-signed per-row ID (RAND/RANDARRAY volatile; no UUID; a formula can't HMAC-sign). Formula approach dropped (a non-signed "needs-id" sentinel is the only conceivable formula use; not pursued now).
2. **Live writeback into an OPEN workbook is safe ONLY on the business-Graph session path.** Local write-under-open is overwritten by autosave; personal OneDrive lacks session APIs. So writeback is queue-until-safe for local + personal, live only for business, and capability-gated until tested.
3. **Duplicate token on copy auto-resolves to a new item — by binding + position, NOT content** (supersedes Amendment #3's "duplicate always asks" for the copy case). The token keeps its existing app→marker binding; auto-resolve fires only when the **bound row still holds its baseline order and the duplicate is inserted AFTER it** (normal copy-below) — later duplicates become new items with fresh tokens. A copy placed **before/displacing** the bound row, or any untrusted order, → **review**. Content-best-match is explicitly rejected (it lets an edited original lose its identity to an unchanged copy). This keeps the paste-below UX while closing the identity-theft path.
4. **Remember imported rows immediately via an identity record AND a durable pending-writeback alias** — the linchpin. The alias (consulted before any marker is created) is what actually makes repeated saves idempotent and survives a content edit before the ID is written back; fingerprint memory alone does not.
5. **Live business-Graph writeback is NEW work, not reuse.** The existing "writeback" path rebuilds the whole workbook / full-file uploads behind a kill-switch; the plan adds a dedicated single-cell column-A patch writer, and clears pending state only on read-back verification.
6. **Microsoft auth via system browser with main-process token custody** — full passwordless options, and refresh tokens never cross IPC to the renderer.
7. **Delete guard stays OFF** (placed-marker Excel deletes remain review-only this stage).

## Risks / open questions
- Microsoft auth migration is now scoped (msal-node + system browser + loopback). Residual risks: the Azure app-registration change (Mobile/desktop platform + `http://localhost` + allow-public-client) must land or new sign-ins hit redirect-URI mismatch; msal-node token-cache choice (keep the existing Supabase `connected_services` store vs a persistent cache plugin); and a no-default-browser edge case. The forgotten work-password blocks *live* testing of this path — build it, but it stays unverified until a working Business M365 account is available.
- **Row locator instability:** the pending-writeback alias keys partly on a row locator, but Excel rows move/insert/sort. The alias must therefore lean on the (sheet + assigned token + expected-old-value + content) rather than row number alone, and tolerate the locator going stale. Confirm the alias still resolves after the user sorts the sheet before the ID is written back.
- **Duplicate paste edge:** a copy pasted ABOVE or displacing the original goes to **"needs your choice"** (not auto-resolved), since row order around the bound row can't be trusted there. Confirm that review prompt is acceptable for the less-common paste-above case.
- **Fingerprint stability** for an import-created row edited before writeback — mitigated by the alias + writing back ASAP; quantify residual local/personal risk.
- **Local "Excel is closed" detection** is multi-signal (lock sentinel + mtime + write/readback) and still depends on solving the Desktop **file-watcher EPERM** to trigger the flush; fail to manual export when uncertain.
- **Personal OneDrive behavior unproven** → default to the safe queue path until verified.
- **Writeback-queue + alias durability** across app restarts and across the new vs legacy persistence engines (local: localStorage; cloud: shared app store).
- **Microsoft persistent-cache mechanism** (decided: main-process source of truth) — implement via `@azure/msal-node-extensions` persistent cache, or an encrypted file in Electron `userData` via `safeStorage`; pick during the auth slice.

## Required tests (Codex R4 — implementation gate)
- Copy-below → new item with fresh token; **paste-above → review** (not auto-resolved).
- **Sorted-before-writeback** → duplicate group reviews instead of positional guess.
- **Stale alias** (row moved/edited before writeback) → resolves to exactly one row or reviews; never re-creates.
- **Repeated save ×N** of one imported row → exactly one marker (alias idempotence).
- **Multi-device cloud pending-alias hydration** → second device does not recreate a pending row; import fails closed until queue+aliases load.
- Read-back-verify clears `pendingRowIdWriteback` only on a confirmed cell match; unsafe export does NOT clear the queue.

## Out of scope (this amendment)
- Excel-driven deletion of **placed** markers (still OFF; review-only candidate-deletes).
- An Office.js in-Excel add-in for live local-file writeback (future "premium live" path).
- Whole-file automatic writeback (stays OFF; only targeted, safe, single-cell ID writes).
