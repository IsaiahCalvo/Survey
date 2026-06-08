# Impact & Preservation Addendum — Excel-Sync Plan

*Companion to PLAN.md. Two audiences: the **Plain** blocks speak to the product owner; the **Precise** blocks speak to the engineer. Produced 2026-06-07 via the `excel-sync-impact-analysis` workflow (4 parallel auditors + synthesis), all line references verified against source.*

> ⚠️ **Amended 2026-06-08 — PLAN.md "Product Decision Amendments" GOVERN this doc.** Where this file still describes hidden ID columns on the visible sheets, a separate import inbox for all new rows, or "Excel can never delete a placed marker," it is superseded: (#5) identity metadata lives only in the very-hidden `_SurveyMetadata` sheet + the app sync record — **no new hidden columns/rows on visible sheets**; (#4) every row carries a full visible-value fingerprint; (#2) clean new rows go **straight to the Survey panel** as unplaced items (only ambiguous rows get a review surface); (#1) Excel **may** delete, but only items it previously received/acknowledged, recoverably; (#3) duplicate names are fine, only broken identity asks "Needs your choice"; (#6) conflict = same field changed both sides before sync; (#7) per-row red exclamation icon, not global warnings; (#8) prove each Excel setup before promising live sync. Treat the tables below as the file-level impact map, but apply the amended behavior.

---

## 1. Straight answer on the sheet-building code

**Plain:** Your Excel sheet-building code — the part that creates the tabs, lays out the columns, paints the green/red/grey Y/N/N/A coloring, the entity colors, the duplicate-name highlighting, the dropdown menus, the column widths, the hidden tracking sheet — is **kept, intact, untouched in behavior**. None of it is being rewritten or thrown away. The first time the app builds a workbook for a survey, it uses the exact same builder it uses today, and the file comes out looking exactly the same.

The only thing that changes is **how later updates get written**. Today, every single save, sync, or delete rebuilds the entire workbook from scratch and re-uploads the whole file — even if one checklist answer changed. That "blow it all away and re-upload" behavior is the part being replaced. After the change, the first export still builds the full formatted file; subsequent edits write only the specific cells that changed, into the rows the app owns. The formatting, colors, dropdowns, and widths are not re-sent on those small writes — and they don't need to be, because they survive untouched.

**Precise — the three buckets:**

**PRESERVED untouched (`PDFViewer.jsx:11782–12229`).** The whole creation + formatting block is preserved verbatim:
- `_SurveyMetadata` very-hidden sheet (`11782`), name reserved at `11796`.
- Header row construction (`11865`: `['Changed By', 'Changed Date', 'Item', ...]`).
- Header cell styling, data-row borders/alignment, the three conditional-formatting rule sets (Y/N/N/A, entity colors, duplicate names), both data-validation dropdowns (checklist + entity), and column widths.
- `createSheetName` dedup helper and the `schemaMappings` tracking object.

In Stage 3 this block is **extracted, not rewritten**, into a pure `buildWorkbookSchema(workbook, selectedTemplate, surveyMarkers, items)` helper (cut-and-lift, no logic change). It remains the code path for: (1) first-time export to a new file, (2) adding a category/module sheet that doesn't yet exist, (3) any "export a clean copy" action.

**REUSED inside the new write path** (carried forward, not duplicated-with-drift):
- The per-row value assembly (`11904–11980`) — the patch writer needs the same column-order knowledge to address the right cells.
- `ensureSurveyMarkerMetadata` (`11748–11757`) — the `changedBy`/`changedDate` stamping stays in the patch-write path.

**ACTUALLY CHANGES (`PDFViewer.jsx:12230–12393`).** The tail — `await workbook.xlsx.writeBuffer()` → `uploadFileContentById` / `writeFile` / full-sheet `updateCellRange` — is the blow-away-and-reupload path. For *updates only*, it is replaced by `excelPatchWriter.patchMarkerRows(...)`, which reads the live workbook, merges against the queued op's base, and patches only app-owned ranges.

**Honest risk + mitigation.** The one real way to lose formatting: if a sheet were ever *created for the first time* via a patch write instead of the builder, it would come out with no colors, no dropdowns, no widths. Mitigation (hard rule): **the full builder is always used for first-time creation; patch-only writes are used only against a workbook the builder already created.** Column-scoped formatting lives in OOXML parts (`<conditionalFormatting>`, `<dataValidation>`, `<sheetView>`) that a Graph `range` PATCH does not touch, so a once-built workbook stays formatted through unlimited patches. Second, smaller risk: re-applying formatting/validation on every patch would duplicate OOXML rules — so the patch path must **not** re-apply them.

**Bottom line:** the appearance and structure of your Excel files do not change. What changes is that small edits stop rewriting the whole file — which is also what stops concurrent editors from clobbering each other.

---

## 2. The new-checklist-item modal

**Plain:** The pop-up that appears when the Excel file has a new checklist item (a new column) the template doesn't know about — the one offering "Create New Template" or "Modify this template" — is **KEPT, exactly as it works today.** Nothing in the plan removes it, changes its buttons, or changes when it appears for real schema changes. The one thing we must get right: the new *hidden* tracking columns (invisible IDs) must be on its "ignore" list so they're never mistaken for a new checklist item. Small fix, spelled out below.

**Precise — how it works today:**
- The modal (`NewColumnsModal`, imported `PDFViewer.jsx:29`, rendered `33123`) fires only on **header-row schema differences**: a header matching no checklist item by `.text` (added), a template item absent from the header (removed), or reordering of surviving columns.
- Detection lives in `handleSyncFromExcel` / `handleAutoSyncFromExcel`; triggers `setShowNewColumnsModal(true)` (`14314` manual, `14482` auto with `isAutoSync:true`). Import is **paused** (`return`) until resolved via `handleNewColumnsDecision`.
- It does **not** fire for data-row changes (new/updated/removed Survey Markers); those are a separate path in `executeExcelImport`/`executeAutoExcelImport`.
- "Modify this template" is disabled when other surveys share the template (`getOtherSurveysUsingTemplate`). This cross-survey protection must be preserved.

**The one integration rule (exact edit).** The skip-list is hardcoded at four sites — `PDFViewer.jsx:13070, 13487, 14244, 14412` — each the literal `['Changed By','Changed Date','Item','Entity','Notes'].includes(colText)`. Stage 1's reserved hidden columns are not in that list, so they would spuriously trigger the modal. Fix: replace all four literals with a single shared `SYSTEM_COLUMNS` constant exported from `src/viewerShared.js` (the five existing system columns **plus** every reserved column name). No change to `NewColumnsModal` or its trigger logic.

---

## 3. What each stage touches (Stage → Files)

Legend: **NEW** create · **MODIFY** surgical · **REPLACE** torn out & replaced · **DELETE** removed.

### Stage 0 — Stop the bleeding + safety contract
| File | Site | Touch | Change |
|---|---|---|---|
| `src/services/annotationDocSync.js` | `applySurveyMarkers` (~`363`) | MODIFY | Thread `origin` instead of hard-coded `'local'` |
| `src/services/annotationDocStore.js` | `syncSurveyMarkersToDoc` (`92–105`) | MODIFY | `toDelete` skips `origin='excel-import'` app-created-unexported; delete only via tombstone |
| `src/services/annotationDocStore.js` | marker writes | MODIFY | Add `createdByApp`, `exportedAt`, `exportAckEtag`, `pendingOpId` |
| `src/hooks/useAnnotationDoc.js` | capture effect (`168–172`) | MODIFY | Pass `origin` into `applySurveyMarkers` |
| `src/PDFViewer.jsx` | `executeExcelImport` (`13046–13459`) | MODIFY | Route through import-transaction; disable hard-delete (`13247–13382`) → quarantine |
| `src/PDFViewer.jsx` | `executeAutoExcelImport` (`13462–13933`) | MODIFY | Same; delete path `13685–13757` |
| `src/PDFViewer.jsx` | `loadLatestSurveyData` (`12677–12727`) | MODIFY | Gate silent import on `!hasPendingExcelSyncChanges`; eTag+hash anchor |
| `src/PDFViewer.jsx` | dirty-fingerprint effect (`9470–9484`) | MODIFY | Replace `updatedAt` anchor with eTag + content hash |
| `src/PDFViewer.jsx` | checkpoint fns (`9451–9468`) | MODIFY | Persist baseline durably (survives reload) |
| `src/PDFViewer.jsx` | `handleSyncFromExcel` (`14154–14326`) | MODIFY | No durable baseline → fail closed to "review required" |
| `src/utils/excelSyncDirtyState.js` | fingerprint fns | MODIFY | Drop `updatedAt`; fold eTag + hash in |
| `src/services/surveyMarkerSyncDiff.js` | `diffDeletedSurveyMarkerIds` | MODIFY | Accept protected set; exclude app-created-unexported |
| `src/services/excelSyncJournal.js` | — | NEW | Structured sync journal → Supabase |
| `src/services/importTransaction.js` | — | NEW | Attribute-patch-only API; no whole-map reconciliation |
| Supabase `excel_sync_journal` | schema | NEW | Audit rows |

### Stage 1 — Identity & schema integrity
| File | Site | Touch | Change |
|---|---|---|---|
| `src/PDFViewer.jsx` | name-match loop (`13107–13115`) | REPLACE | Match by stable `markerId` from hidden ID column |
| `src/PDFViewer.jsx` | builder (`11777–12393`) | MODIFY | Store `_markerId`/`_checklistItemId`/`_entityId` in the very-hidden `_SurveyMetadata` sheet + app record — **NOT** as hidden columns on visible sheets (Amendment #5) |
| `src/PDFViewer.jsx` | column parser (`13069–13078`) | MODIFY | Match by stored identity + full-row fingerprint (Amendment #4); visible header unchanged |
| `src/PDFViewer.jsx` | new-row creation (`13224–13241`) | MODIFY | Clean new rows → unplaced Survey-panel items w/ orange locate (Amendment #2); only ambiguous rows flagged for review |
| `src/viewerShared.js` | `SYSTEM_COLUMNS` | NEW | Shared skip-list de-dup of the existing reserved headers; consumed at all four parser sites |
| `src/services/excelRowFingerprint.js` | — | NEW | Full visible-value row fingerprint (Changed By, Changed Date, Item, every answer, Entity, full Notes) |
| `src/services/excelSchemaParser.js` | — | NEW | Parser w/ `_SurveyMetadata` identity + fingerprint matching + "Needs your choice" rules |
| `src/services/idStampingMigration.js` | — | NEW | One-time identity backfill on fingerprint-unambiguous rows; rest get per-row "Needs your choice" |
| `src/services/annotationDocStore.js` | store/read | MODIFY | Store the three stable IDs + row fingerprint as first-class fields |
| `src/components/` (Survey-panel row) | — | MODIFY | Per-row red exclamation icon + tooltip for sync problems (Amendment #7); no separate inbox panel |

### Stage 2 — Tombstones, trash, history
| File | Site | Touch | Change |
|---|---|---|---|
| `src/PDFViewer.jsx` | `handleSurveyMarkerDeleted` (`22397–22636`) | REPLACE | Hard-delete → canonical tombstone (trash) |
| `src/PDFViewer.jsx` | post-delete sync (`22627–22636`) | REPLACE | Write `_isDeleted` soft-delete to owned range; queue flush |
| `src/PDFViewer.jsx` | ownership gate (`22443–22455`) | MODIFY | Relax — only in same commit as trash + audit |
| `src/services/annotationDocStore.js` | store | MODIFY | Support `{_deleted,_deletedAt,_deletedBy}` vs key removal |
| `src/services/surveyMarkerTrash.js` | — | NEW | 30-day recoverable trash |
| `src/services/surveyMarkerHistory.js` | — | NEW | Field-level history |
| `src/components/TrashPanel.jsx` / `MarkerHistoryPanel.jsx` | — | NEW | Trash + history UI |
| Supabase `survey_marker_tombstones`, `survey_marker_history` | schema | NEW | Recovery + audit |

### Stage 3 — Outbound write safety + durable queue
| File | Site | Touch | Change |
|---|---|---|---|
| `src/PDFViewer.jsx` | builder (`11777–12393`) | REPLACE *(tail only)* | Extract `11782–12229` → `buildWorkbookSchema()` unchanged; replace only `12230–12393` with `excelPatchWriter`. First-export still builds full file. |
| `src/PDFViewer.jsx` | `pushToExcelWithRetry` (`12764–12787`) | REPLACE | Enqueue outbound op; async flush |
| `src/PDFViewer.jsx` | live-sync push (`14760–14797`) | MODIFY | Route to queue flush |
| `src/PDFViewer.jsx` | session lifecycle (`14554–14667`) | MODIFY | Per-flush session; handle `accessConflict`/`invalidSessionAccessConflict`/`Retry-After` |
| `src/services/excelSessionService.js` | session + write | MODIFY | Normalize Graph error codes; invalid session → recreate |
| `src/services/excelOutboundQueue.js` | — | NEW | Durable per-doc queue |
| `src/services/excelSyncLease.js` | — | NEW | Per-workbook sync lease |
| `src/services/excelPatchWriter.js` | — | NEW | Read-latest → merge → patch owned ranges only |
| Supabase `excel_outbound_queue` | schema | NEW | Durable queue store |
| **SPIKE** | session-id/lease/eTag on real endpoints; Electron local-lock feasibility | NEW | Gates Stage 3 coding |
| `src/components/SyncStatusChip.jsx` | — | MODIFY | Surface queue depth / "file open elsewhere" |

### Stage 4 — Conflict model
| File | Site | Touch | Change |
|---|---|---|---|
| `src/services/importTransaction.js` | `applyAttributePatch` | MODIFY | Per-field revision clocks (app store, not Excel `Changed Date`); LWW |
| `src/services/surveyMarkerHistory.js` | `recordFieldChange` | MODIFY | Preserve losing value w/ `superseded_by` |
| `src/services/conflictResolver.js` | — | NEW | LWW per field; never clobber an open editor mid-edit |
| `src/PDFViewer.jsx` | answer handlers (`15151/15182/15211`) | MODIFY | Tag writes w/ per-field revision timestamp |

### Stage 5 — Quiet collaboration surfaces
| File | Site | Touch | Change |
|---|---|---|---|
| `src/components/collab/ExcelChangeToast.jsx` / `AwayChangePill.jsx` | — | NEW | Non-blocking surfaces |
| `src/services/surveyMarkerHistory.js` | `getChangesSince` | MODIFY | Away summary |
| `src/PDFViewer.jsx` | import path | MODIFY | Remote changes apply live + silent; visible deletes toast |

### Stage 6 — Live feel
| File | Site | Touch | Change |
|---|---|---|---|
| `src/PDFViewer.jsx` | live-sync poll (`14673–14754`) | MODIFY | Tune cadence (15–30s); row+field diff |
| `src/components/collab/PresenceAttributionChips.jsx` | — | NEW | Soft presence/attribution chips |
| **SPIKE** | real Graph throttling vs poll target | NEW | Gates cadence |

### Migration Preflight (one-time, before any new logic runs against a doc)
| File | Site | Touch | Change |
|---|---|---|---|
| `src/services/excelSyncMigrationPreflight.js` | — | NEW | Snapshot all sources; restore unambiguous; quarantine ambiguous |
| `src/PDFViewer.jsx` | doc-open (`~16856`/`~16888`) | MODIFY | Gate open on preflight before any import can fire |

**High-risk file note:** `src/PDFViewer.jsx` carries ~14 edit sites under the standing waiver. Every edit is minimum-viable-diff, `npm test` after, baseline reported before declaring done. The Stage 3 `PDFViewer.jsx` edit is an extraction-then-tail-swap, not a rewrite — preserve every line of `11782–12229`.

---

## 4. Preserve / Do-Not-Break list

These must keep working **identically**.

**Sheet building & formatting (the owner's investment):**
1. `handleExportSurveyToExcel` full builder (`11759–12393`). Used unmodified for first-time creation; extracted to `buildWorkbookSchema()` in Stage 3, never rewritten.
2. `createSheetName` (`11799–11815`). Import reconstructs sheet names with the identical formula; changing it makes existing workbooks unreadable.
3. `_SurveyMetadata` very-hidden sheet (`11782–11793`). `getTemplateIdFromExcel` reads `B1`/`B2`; cell addresses + sheet name are a hard contract.
4. Header row layout (`11865–11870`). Import does `headerRow.indexOf('Item'|'Entity'|'Notes')`; any reorder/rename breaks inbound sync.
5. The three conditional-formatting rule sets (`12077–12202`). Apply once on creation; never re-apply on patch.
6. Both data-validation dropdowns (`12036–12075`). Set once on creation; never re-applied on patch.
7. Column widths (`12204–12224`). Set on creation; patch must not reset.
8. `ensureSurveyMarkerMetadata` (`11748–11757`). `changedBy`/`changedDate` stay in the patch-write path.

**Upload primitives (hard-won binary correctness):**
9. `uploadExcelFile`, `uploadFileContentById`, `uploadFileToDrive` — preserve the Uint8Array normalization + explicit-MIME Blob; ID-based path stays preferred.
10. `getTemplateIdFromExcel`, `getFileETag` — keep as-is.

**Session lifecycle:**
11. `createWorkbookSession` / `refreshWorkbookSession` / `closeWorkbookSession` — keep the 3-min refresh; always close sessions.

**Dirty-state contract:**
12. `computeExcelSyncFingerprint` / `computeHasPendingExcelSyncChanges` — keep the hash module; Stage 0 *extends* checkpointing to persist the baseline, does not replace it.

**The modal:**
13. `NewColumnsModal` + trigger + the shared-template "Modify disabled" protection — kept exactly; only the four skip-list sites change.

**Contract correctness invariants (bind regardless of waiver):**
14. Container-aware canvas sizing, single-name `fontFamily`, the `zoomGeneration` signal, no JS zoom coordination in `SVGAnnotationLayer.jsx`. No Excel-sync edit may touch these.

---

## 5. How we prove nothing broke

**Standing gate — every stage, before merge:** `npx vite build` then `node scripts/run-node-tests.mjs` (must be green).

**Existing harnesses that must keep passing (run manually each stage):** `node agent-cli/yjs-roundtrip.mjs` (Survey Marker save/reopen/delete), `node agent-cli/survey-roundtrip.mjs <doc-id>`, `node agent-cli/import-once-roundtrip.mjs`.

**Stage 0 — add before any Stage 0 code ships:**
1. Origin-guard test — Y.Doc `{sm1,sm2}`, import dict only `{sm1}`: `origin='excel-import'` does NOT delete `sm2`; `origin='local'` does.
2. Never-delete-placed-marker test — a placed marker absent from Excel with `hasPendingExcelSyncChanges=true` is never queued for deletion; with `=false` deletion needs an explicit tombstone.
3. Durable-baseline test — fresh handle with no in-memory baseline → `computeHasPendingExcelSyncChanges` returns `true`.
4. Auto-save-never-pushes-Excel test — silent save never reaches `pushToExcelWithRetry`.

**Stage 1:** stable-ID row matcher test (rename-with-ID preserves geometry; no-ID name-match → quarantine); reserved-columns test (hidden columns skipped; **no spurious `NewColumnsModal`** — the modal regression guard).

**Stage 2:** tombstone test (local delete → recoverable; excel-import delete → no-op pending confirm; restore reinstates geometry).

**Stage 3 — the key pre-cutover artifact:** a builder-output **snapshot test** that freezes today's sheet names, header/column order, `_SurveyMetadata` cells, column widths, and ARGB color codes — run against a fixture **before** the patch writer exists, so any drift fails immediately. Plus patch-writer test (touches only owned ranges; user columns untouched), outbound-queue test (423 keeps ops queued; success drains + updates baseline), and a live OneDrive import harness.

---

## 6. Plan edits applied (so preservation + the kept modal are contractual)

1. Added a **Preserve / Do-Not-Break** subsection (Section 4 verbatim).
2. Stage 3: "keep the builder for creation" note (extract `11782–12229` unchanged; replace only the `12230–12393` tail).
3. Stage 3: formatting-idempotency rule (never re-apply conditional formatting / validation on patch).
4. Stage 1: "reserved columns don't trigger the modal" rule + `NewColumnsModal` kept exactly via the shared `SYSTEM_COLUMNS` constant.
5. Stage 0: the three origin/delete-guard tests are pre-Stage-0 gates; the builder snapshot test is a pre-Stage-3 gate.
6. Cross-cutting invariant: no Excel-sync edit may touch the contract correctness invariants.

---

*Net assurance: the Excel files keep looking and behaving exactly as they do today; the new-checklist-item modal stays; the only deliberate behavior change is that small edits stop rewriting the whole workbook — the safety win, not a formatting risk.*
