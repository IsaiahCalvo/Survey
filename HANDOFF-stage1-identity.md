# Handoff — Stage 1: Identity & fingerprint matching (the gate before Excel can delete placed markers)

**Created:** 2026-06-08. **Branch:** `main` (local, unpushed — direct-to-main; the user tests on their dev server; push only on their say-so). **Read this, then** `PLAN.md` (the "Product Decision Amendments — 2026-06-08" section GOVERNS), then `HANDOFF-excel-sync.md` (Stage 0 state) and `HANDOFF-stage2-trash.md` (recovery state).

---

## The one hard gate (do not violate)

**Keep the placed-marker Excel-delete guard ON.** Excel must NOT be allowed to remove a *placed* PDF Survey Marker until this Stage 1 identity/fingerprint work is finished and the app can confidently identify the exact row↔marker. Recovery (History → Restore, Stage 2) is a backup, NOT a license for weak matching to make markers disappear. Do not flip that switch in Stage 1. The user will decide when to enable it, after Stage 1 matching is proven.

Concretely, today the import deletion path is guarded so it never deletes a placed marker and never deletes a marker Excel never received (no `exportedAt`). Leave both guards in place. Stage 1 makes *matching* trustworthy; enabling placed-marker deletion is a later, explicit step.

---

## What Stage 1 must deliver (locked by the 2026-06-08 amendments)

1. **Full-row fingerprint for every Excel row** (Amendment #4): a hash of the exact VISIBLE cell values — Changed By, Changed Date, Item/title, **every checklist answer value**, Entity, and the **full Notes text**. Use actual values, not presence/absence. Computed identically on export (stored per marker) and on import (recomputed per row). This is the always-on matching + change-detection + confidence layer.
2. **Durable identity in the app record + the very-hidden `_SurveyMetadata` sheet — NO hidden columns/rows on the visible sheets** (Amendment #5). The marker id / checklist-item id / entity id live in `_SurveyMetadata` (itself a very-hidden sheet — allowed) and/or the app's own durable record. The visible sheets keep exactly today's columns.
3. **Match by identity + fingerprint, never Item name alone** (Amendment #9). Replace the current module/category + Item-name match (the weak matcher) so renamed/duplicate labels never map answers onto the wrong marker.
4. **Duplicate names are allowed; only broken identity asks** (Amendment #3). Two rows with the same visible name is normal — keep both, never merge. Only when tracking identity is broken — two rows claim the same identity, or two rows are truly indistinguishable — surface **"Needs your choice"** (duplicate vs. new item). Never silent-merge, never name-guess a placed marker.

---

## Where the code is today (verified 2026-06-08)

- **Weak name matcher to replace:** `executeExcelImport` and `executeAutoExcelImport` in `src/PDFViewer.jsx` match a row to a marker by `moduleId/categoryId + Item-name` (the loops near `13213` and `13665`, matching on `annName === itemName`). Checklist columns match by header text (`c.text === trimmedText`, `~13182`/`~13634`).
- **Skip-list literals (4 sites)** to fold into one shared `SYSTEM_COLUMNS` constant in `src/viewerShared.js`: `PDFViewer.jsx:13178, 13630, 14422, 14590` — each the literal `['Changed By','Changed Date','Item','Entity','Notes'].includes(colText)`. Since no NEW visible columns are added (Amendment #5), this is just a de-dup so the existing reserved headers stay consistent; it is NOT a place to add hidden IDs.
- **`_SurveyMetadata` builder block:** `PDFViewer.jsx:11876–11890` — a very-hidden sheet currently holding `template_id`/`template_name`/`export_timestamp`/`app_version` in A1–B4. Stage 1 extends THIS sheet (rows below 4, or a second region) with the per-marker identity block. The visible sheets are untouched.
- **Already built and reusable:**
  - `src/services/excelExportAck.js` — `exportedAt` is stamped on every marker at successful export (`markExcelExportSynced` in PDFViewer). Stage 1 should stamp the **last-exported fingerprint** at the same moment.
  - `src/utils/excelSyncDirtyState.js` — has an FNV-1a `hashString`; reuse the same hashing style for the row fingerprint so it's consistent. Ack fields are already excluded from the dirty hash; do the same for any new identity bookkeeping fields.
  - The attribute-only import boundary (`src/services/importFieldWhitelist.js`) and the received-only delete guard (`src/services/surveyMarkerSyncDiff.js`) — keep using them.

---

## Recommended identity architecture (resolve the open question FIRST)

The hard part is tying a stored marker id to a row the user can freely **reorder, insert, or rename** in Excel, without hidden visible-sheet columns. Recommended combination:

1. **App-record fingerprint (primary change-detection):** at export, stamp each marker with `lastExportedFingerprint` (computed from the exact values written to its row) alongside `exportedAt`. At import, recompute each row's fingerprint and match it to the marker with the same `lastExportedFingerprint`. Exact-value rows match cheaply and unambiguously; this also tells you *which* fields changed.
2. **`_SurveyMetadata` identity block (handles rename + reorder):** at export, write an ordered per-row identity list into `_SurveyMetadata` — for each data row, its marker id (+ checklist-item ids + entity id) — so a row whose VALUES changed (e.g. renamed) can still be matched back to its marker by stored id. The open question is the **row key**: position is fragile under reorder/insert. Options to weigh: (a) a stable per-row token also written invisibly into `_SurveyMetadata` and recovered by reading the sheet in order with an anchor, (b) accept position-as-hint + fingerprint as the tie-breaker, (c) match on the combination and route anything ambiguous to "Needs your choice." **Recommendation: run the codex/grill skill on THIS sub-design before coding it** — it's the highest-stakes correctness decision in the project and is exactly what the cross-model review is for. The user is fine continuing in a new session; spend the first part of it locking this design.
3. **Match precedence on import:** stored identity (id) → exact fingerprint → confident single legacy name match → otherwise **quarantine / "Needs your choice."** A placed marker is NEVER matched by name alone.

---

## Build order (small tested slices; `node scripts/run-node-tests.mjs` + `npx vite build` green each time; commit per slice)

1. **Lock the identity design** (codex/grill on the row-key question above). Write the decision into `PLAN.md` / this file before coding.
2. **Pure row-fingerprint module** + tests: `computeRowFingerprint({ changedBy, changedDate, item, answers, entity, notes })` using the existing FNV-1a style. Tests: identical values → identical hash; any single value change → different hash; uses actual values (not presence).
3. **Stamp `lastExportedFingerprint`** on each marker at export (in `markExcelExportSynced` / the builder's per-row assembly) and **exclude it from the dirty fingerprint** (like the ack fields). Tests: export stamps it; stamping doesn't re-dirty a synced survey.
4. **`_SurveyMetadata` identity block** writer + reader (very-hidden sheet only; visible sheets unchanged) + a **builder-output snapshot test** proving the VISIBLE sheets (names, header/column order, widths, colors, validations) are byte-for-byte unchanged and no new hidden column/row appears on a visible sheet. This snapshot is the pre-cutover guard.
5. **New matcher** (pure, tested) consumed by both import paths: identity → fingerprint → confident-name → quarantine. Tests: rename-with-stored-id keeps geometry, only name attribute changes; duplicate names both kept (no merge); two rows sharing an identity → "Needs your choice"; no placed marker matched by name alone; unknown/duplicate checklist header quarantines instead of writing the wrong item.
6. **Shared `SYSTEM_COLUMNS` constant** in `viewerShared.js` replacing the four skip-list literals (de-dup only) + the `NewColumnsModal`-doesn't-spuriously-fire regression test.
7. **"Needs your choice" surface:** the matching produces a per-row "ambiguous identity" state. Wire it to the red circled-exclamation per-row icon (Amendment #7, asset at `/Users/isaiahcalvo/Downloads/exclamation-circle-svgrepo-com.svg`) on the affected Survey-panel row, hover = "Two Excel rows look identical. Choose whether this is a duplicate or a new item." Keep it minimal; this is the only new visible piece.

---

## Tests to keep green / add (per PLAN.md §5 + amendments)

- Standing gate: `node scripts/run-node-tests.mjs` (**982 pass / 0 fail / 6 skipped** at Stage 1 start) + `npx vite build` clean.
- Row-fingerprint exactness; rename-with-id preserves geometry; duplicate names both kept; broken identity → "Needs your choice"; no placed-marker name match; reserved-columns don't trigger `NewColumnsModal`; builder visible-output snapshot unchanged + no new hidden visible-sheet column.
- Keep existing harnesses green: `node agent-cli/yjs-roundtrip.mjs`, `node agent-cli/excel-corruption-e2e.mjs`.

## Invariants that still bind (every slice)

- Placed-marker Excel-delete guard stays ON (the gate above). Received-only delete guard stays ON.
- Manual export works; automatic whole-file writeback stays OFF (Stage 0 switch).
- Excel is attribute-only: never place/move a marker or write geometry.
- No new hidden columns/rows on visible sheets; identity lives in `_SurveyMetadata` + app record.
- Contract correctness invariants untouched: container-aware canvas sizing, single-name fontFamily, the `zoomGeneration` signal, no JS zoom coordination in `SVGAnnotationLayer.jsx`.
- High-risk files (`PDFViewer.jsx`): minimum-viable-diff, `node scripts/run-node-tests.mjs` after, report baseline.

## State at handoff (committed on local `main`, latest first)

`a80c04dd` History-restore MVP for deleted markers · `41efb23c`/`2e14802d`/`db6be9cd` Stage 2 trash+tombstones · `59e19b5a` durable baseline · `372a31b5` received-only delete · `9e62fb52` export-ack · `0eff390e` attribute-only import boundary · `85e9056d` writeback switch · `1fe64524` plan amendments · (earlier) origin guard / placed-marker guard / silent-import gate. Nothing pushed. Stage 0 + Stage 2 recovery are done; **Stage 1 is the next focus and the gate for ever enabling Excel-driven deletion of placed markers.**
