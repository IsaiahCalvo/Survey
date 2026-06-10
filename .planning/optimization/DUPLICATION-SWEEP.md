# General Duplication Sweep (BL-19)

_2026-06-10, overnight loop. Audit-only. Tool: `npm run audit:dupes` (fallow 2.91, mild
mode) + manual identification of every product-code clone region. Codex fact-check
applied. Per the standing fallow rules: findings validated by reading the code — fallow
itself is never trusted blind, and NOTHING is deleted/refactored in this audit._

## Raw numbers, then the honest filter

Fallow reports **23,045 duplicated lines (10.9%) across 271 files, 783 clone groups** —
but the overwhelming majority is DISPOSABLE TOOLING: one-off probes in `agent-cli/`
(test-cdp-vs-console twins, logging-buffer probes), `debug/` scenario scaffolds, and
fallow's own validation scripts. Those are write-once diagnostic scripts; deduplicating
them buys nothing (several are also protected fixtures). **Product-vs-product code
(`src/` on both sides) has 8 clone families, ~1,203 redundant lines** — small for an
app this size. Mixed src-vs-tooling families (e.g. `agent-cli/bench-hydrate.mjs`
mirroring hydrate logic from `useAnnotationCloudSync.js`) are ignored on purpose:
the benchmarks deliberately copy app logic to time it in isolation.

## The 8 product-code families, identified

| Family | What it actually is | Disposition |
|---|---|---|
| `PDFViewer.jsx` 13420-13597 vs 14035-14210 (178 ln) + 13598-13705 vs 14221-14338 (118 ln) + 13815-13998 vs 14437-14620 (184 ln) + 14936-15065 vs 15159-15284 (130 ln) — **~610 lines** | The MANUAL vs AUTO/LIVE Excel-import pipelines are near-twins: Row-ID identity-plan application, per-scope deletion detection, confirm/cancel messaging (alert vs status-message variants), and the workbook parse phases are duplicated between `executeExcelImport` and the auto-import path | **Defer, deliberately.** This is governed Excel-sync territory (PLAN.md amendments) inside the highest-risk file; the right home for the extraction is the viewer breakup (KAL-127) or a dedicated Excel-import-core slice with its own plan + review. Noted there; do NOT chip at it piecemeal. |
| `PageAnnotationLayer.jsx` 1888-2068 vs 2184-2407 (224 ln: midpoint-handle math per shape family) + 1030-1126 vs 1254-1433 (180 ln: control-render + imported-callout builders) — **~404 lines** | Internal duplication in the LEGACY Fabric annotation layer | **Skip permanently.** Per KAL-85's map this file is live only under the `?renderer=canvas` escape hatch and is headed for retirement — refactoring it now is wasted risk (and the file is touch-only-when-needed per CLAUDE.md). |
| `documentAnnotationService.js` 25-124 vs 512-595 (**100 ln**) | `classifyAnnotationSyncError` vs `classifyPresenceError` — two near-identical Supabase error classifiers (message/code/status sniffing) | **Tractable slice D1**: one shared classifier parameterized by source label. Service-level, well-tested area (documentAnnotationService.test.mjs exists), automatable verification. |
| `SpaceRegionOverlay.jsx` 15-103 vs `utils/regionMath.js` 186-259 (**89 ln**) — AND `RegionSelectionTool.jsx` (~:660) carries a THIRD copy of the same region↔polygon converters while already importing `regionMath` | Region→polygon conversion + martinez overlap helpers re-implemented in two consumers of the util that owns them | **Tractable slice D2 (now 3-way)**: point both the overlay and the selection tool at `regionMath.js`. Drift check DONE during review: no behavior drift, comments differ only — pure consolidation. |

## Cross-references (no double-booking)

- Callout-vs-annotation model duplication → BL-16 (dedicated migration, per the
  annotation contract; explicitly NOT part of this sweep).
- Drag-and-drop + select-mode + UI-system duplication → covered tonight by BL-18 /
  BL-17 and the standing KAL-56/62-65 unification tickets.
- The Excel import-pipeline twins → flagged on Linear KAL-127 (the viewer break-up
  tracking ticket — lives in Linear, not in-repo) as the natural extraction
  beneficiary; also relevant to the Excel-sync workstream\'s future slices.
- Dead-code-flavored "duplication" (legacy selection mode etc.) → already deleted
  tonight (KAL-82 slice 1) or queued on KAL-82.

## Slice plan

1. **D1 — unify the two error classifiers** — DONE 2026-06-10, commit `5a9eced6` (41 lines removed, behavior-identical, Codex-approved).
2. **D2 — region-math consolidation** — DONE 2026-06-10 (three copies → one
   exported pair in regionMath.js; behavior-identical; Codex-approved).
3. **Non-goals:** tooling/debug dupes; the legacy layer; the Excel pipeline twins
   (KAL-127 / dedicated slice); anything in the protected prototypes.

## Decision for Isaiah
None required — D1/D2 are unambiguous cleanups; they\'ll ride future loop capacity
(each with its own Codex-reviewed plan), or say the word and they get done next.
