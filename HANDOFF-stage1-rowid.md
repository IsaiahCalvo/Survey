# Handoff — Stage 1 Row ID identity: engine built, NOT yet wired into live import

**Created:** 2026-06-08. **Branch:** `main` (local, unpushed; direct-to-main, user tests on their dev server, push only on say-so). **Read first:** this file, then `STAGE1-IDENTITY-PLAN.md` (the approved design), `STAGE1-IDENTITY-REVIEW-LOG.md` (the 8-round Codex argument), and `PLAN.md` "Product Decision Amendments" (Amendment #10 = **hidden, signed (not locked) Row ID** is primary identity; GOVERNS).

---

## TL;DR for next session
The three-layer identity primitives are built and unit-proven. Survey mode works again (a template-select regression was fixed). Export now writes the **hidden, signed Row ID** column (sort/filter/edit all work). **The import side still uses the OLD name matcher** — the new Row ID matcher engine exists but is not connected. The user's successful export→add-row→auto-import test therefore exercised the **legacy** path, not the new identity logic. **Next session's job: wire the matcher into both live import paths + persist the per-scope identity records on export, then the user can really test Row ID matching.** Also fix a file-watcher permission error surfaced in the logs.

---

## What shipped this session (all on local `main`, latest first)
- `127a3fc7` **fix(survey): selecting a template no longer wipes survey mode (REGRESSION FIX).** Root cause: the "reset everything when the PDF changes" effect depended on `clearExcelSyncCheckpoint`, whose identity changed on every `selectedTemplate` change. Selecting a template re-fired the full reset → cleared template, closed survey panel, reverted tool to pan, re-triggered the load ("loading screen"). Fixed by making `clearExcelSyncCheckpoint` identity-stable via `pdfIdRef`/`selectedTemplateRef` + empty deps. Proven headlessly: picking a template now emits only `tool-changed→survey-marker` and stays. **This unblocked survey mode.**
- `2858da5d` / `86013e2d` **debug instrumentation.** `86013e2d` = always-on document-open trace (`loadTrace.js` + perf-logger fan-out): every open step prints `[LOAD-TRACE …]`, persists to localStorage, console helpers `__loadTrace()` / `__lastLoadTrace()`. **KEEP** — it's how we proved the doc loads fine. `2858da5d` = a TEMP `[DEBUG-toolrevert]` probe that pinned the regression; **already removed** in `127a3fc7`.
- `4a83ff7e` **Row ID import matcher ENGINE** (`src/services/rowImportMatcher.js`, 10 tests). Pure async `buildImportPlan({rows, stored, documentId, scopeId, resolveSecret})` → per-row decisions: `match`/`new-row`/`missing-rowid`(recovered)/`duplicate-rowid`/`unknown-rowid`/`foreign-rowid`/`wrong-scope-rowid`/`malformed-rowid`/`rowid-key-unavailable`/`ambiguous-identity` + `candidateDeletes` (review-only). **NOT imported by any app code yet.**
- `aea3c735` → `7fa0b951` → `64ecfe24` **Export writes the `Row ID` column** (`src/PDFViewer.jsx`). First column on every survey sheet; each marker's signed token; all column-position references shifted +1; `Row ID` added to the 4 import skip-lists. **Final state: HIDDEN + text-formatted, NOT locked, sheet NOT protected.** (`7fa0b951` added lock+protection; `64ecfe24` reverted it because real desktop Excel blocked sorting/filtering on the locked column — "you do not have sufficient permissions to change those cells". Identity is protected by being hidden + HMAC-signed: any edit breaks the signature → `malformed-rowid` → review. **DO NOT re-add cell locking / sheet protection.**) Round-trip + hidden proven (`tests/excelRowIdRoundtrip.test.mjs`).
- `f128cb56` **Per-document signing-secret store** (`src/services/rowIdSecretStore.js`, 7 tests).
- `2aac66a9` **Full-row fingerprint value-check layer** (`src/services/rowFingerprint.js`, 14 tests). Canonical serializer (plain + ExcelJS shapes), full-row + identity-vector fingerprints, per-field diff for conflict detection.
- `65eac28f` **Row ID token primitive** (`src/services/rowIdToken.js`, 15 tests). `v1.<keyId>.<b32(documentId)>.<b32(scopeId)>.<b32(markerId)>.<b32(hmac)>`, Web Crypto HMAC, classify with parse→documentId(before HMAC)→verify→scope order.

Baseline: `node scripts/run-node-tests.mjs` = **1031 pass / 0 fail / 6 skipped**; `npx vite build` clean.

---

## What the 2026-06-08 logs actually show (newest folder `19-02-46`)
- **Survey mode works now.** `[PreviewDiag] survey-marker-draw … 1 commit on release` at 19:00–19:02 — the user drew + committed markers. The earlier `LOAD-TRACE` runs all end in `✅ LOAD COMPLETE` — the document was never actually stuck; that symptom was the template-select reset, now fixed.
- **The new matcher never ran.** `grep buildImportPlan|rowImportMatcher|classifyRowIdToken` over the logs = **0**. The auto-import used the legacy name matcher in `executeAutoExcelImport`. So the user's round-trip looked correct via the OLD path; **Row ID matching was not exercised.**
- **File-watcher permission error.** Repeated `File watcher error: EPERM: operation not permitted, watch '/Users/isaiahcalvo/Desktop/Security_export.xlsx'` (×5). Auto-import still happened, but the watch-the-linked-xlsx mechanism is erroring — investigate next session (Desktop sandbox/permissions on macOS, or the watcher needs a different path/retry).

**Answer to "am I testing it right?":** Export side = yes (Row ID column is written). Import side = not yet — the new identity engine must be wired before the Row ID round-trip can be tested for real.

---

## Next session — build order (small tested slices; tests + build green each; commit per slice; high-risk file `PDFViewer.jsx` = minimum-viable diff)
1. **Persist the per-scope identity records on export.** At export, write to the durable app record (and `_SurveyMetadata`) the per-scope `excelScopeSync` (schema version, exportId/clock, columnSchema, systemColumns, recordCount) + per-marker `excelSync` (markerId, lastExportId, identityVectorFingerprint, fullRowFingerprint, fieldFingerprints, wasWrittenAsRow). This is the `stored` input the matcher needs. Stamp `exportedAt`/fingerprints ONLY on markers actually written as rows.
2. **Wire `buildImportPlan` into both live import paths** (`executeExcelImport` ~13217 and `executeAutoExcelImport` ~13669 in `PDFViewer.jsx`), replacing the `annName === itemName` name match. Read each row's Row ID cell + visible values, build `stored` from the app record, call `buildImportPlan`, then apply: `match`/`missing-rowid`→write attributes to that markerId; `new-row`→unplaced Survey-panel item (orange locate, Amendment #2); everything else→review (no write).
3. **Surface review / "Needs your choice"** — the per-row red circled-exclamation icon (Amendment #7, asset at `/Users/isaiahcalvo/Downloads/exclamation-circle-svgrepo-com.svg`) on affected Survey-panel rows for `duplicate-rowid`/`unknown-rowid`/`foreign-rowid`/`wrong-scope-rowid`/`malformed-rowid`/`ambiguous-identity`/`rowid-key-unavailable`. Hover tooltip per reason.
4. **Stale gate + suspicious-mismatch guard** (Step 0 of the plan): causal export-clock comparison → `stale-workbook`/`incomparable-export` review-only; valid Row ID whose fingerprint seriously conflicts with metadata → ask, don't apply.
5. **Fix the file-watcher EPERM** so auto-import-on-save is reliable (or document the limitation + a manual-import fallback).
6. **Decide on the load-trace** — keep it (useful, low noise) or gate behind a flag once stable.

## Invariants that still bind (every slice)
- **Excel-driven deletion of a placed marker stays OFF** until Row ID import + duplicate/unknown/broken detection + fingerprint change-detection + ambiguity review are all built AND tested (owner's explicit gate). A stored marker with no row = review-only `candidate-delete`, never a delete.
- Excel is attribute-only (never place/move/delete geometry). Received-only delete guard stays ON. Manual export works; automatic whole-file writeback stays OFF (Stage 0 switch).
- Contract correctness invariants untouched: container-aware canvas sizing, single-name fontFamily, the `zoomGeneration` signal, no JS zoom coordination in `SVGAnnotationLayer.jsx`.

## Tests / harnesses
- Gate: `node scripts/run-node-tests.mjs` (1031 pass) + `npx vite build`.
- New unit suites: `rowIdToken`, `rowFingerprint`, `rowIdSecretStore`, `rowImportMatcher` (in `src/services/__tests__/`), `tests/excelRowIdRoundtrip.test.mjs`.
- Headless app driving (real backend) is viable in the browser at `http://localhost:5173` (`npm run dev:ui` + Playwright) — the document + survey panel + template selection all work there; use it for proof when wiring import. The Electron app load path differs.
