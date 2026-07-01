# Phase A1 — Existing e2e coverage inventory & gate decisions

Ran the existing agent-cli e2e suite against a fresh worktree dev server (port 5186,
real prod backend for the self-cleaning throwaway flows; app is not published, data
disposable per owner directive). Result: 9 green as-invoked, 4 red. Investigated every
red — NONE is a regression from this session's work (A0 only added `.js` import
extensions). Classification below.

## Reliable gates (GREEN — these form the Phase-B per-step net)
1. `render-smoke.mjs` — viewer renders real pixels.
2. `callout-e2e.mjs` — callout draw→render→delete.
3. `callout-interaction-e2e.mjs` — callout live-text/dblclick/select/drag (6/6).
4. `roundtrip-save-reopen.mjs` — PRIMARY GATE: annotation survives save→cloud→reload (real backend).
5. `reupload-survival.mjs` — annotations survive document re-upload (real backend).
6. `yjs-roundtrip.mjs` — durable Yjs sync roundtrip (real backend). Guards B6 cloud sync.
7. `excel-corruption-e2e.mjs` — Excel data-loss guard. Guards B5.
8. `import-once-roundtrip.mjs` — import-once idempotency. Guards B5.
9. `repro-sleep-wake.mjs` — sleep/wake annotation recovery.
10. `lock-document-e2e.mjs` — FIXED this session (see below); lock contract + allowed-actions-while-locked, incl. zoom-scale change. Now fully green.

## Fixed this session
- **lock-document-e2e.mjs** — its `pageWidth()` measured the removed Syncfusion `.e-pv-page-div`
  (returned 0 → the "zoom changes rendered scale while locked" assertion failed 0→0). Swapped to
  the pdf.js page overlay (`[data-svg-annotation-layer]`, falls back to the page canvas). Now the
  full run is green (width 1273 → 1591 on zoom). This is a genuine, in-scope fix — restores a real gate.
- **version-history-e2e.mjs** — its draw target was the same removed `.e-pv-page-div`. Swapped to
  `[data-svg-annotation-layer]`. Drawing now works and scenarios 1–2 + all revision RPC gates
  (create/list/get/restore) pass. BUT see below — it still fails on a separate, deeper feature.

## Pre-existing drift / obsolete — documented, NOT gated (each has overlapping green coverage)
- **version-history-e2e.mjs** — after the draw fix, 19 assertions still fail, ALL about the
  version-history "spotlight glow" visual overlay (`#document-history-spotlight-svg`, glow-path
  alignment across scroll/zoom/pan). The glow SVG the test looks for renders as null — a pdf.js-migration
  drift in a UI-polish overlay, unrelated to the save/history DATA pipeline. That data pipeline is
  covered by the passing revision RPC gates here + roundtrip/reupload/yjs. Fixing the spotlight overlay
  is a separate feature task, out of engine-extraction scope. → NOT a Phase-B gate.
- **survey-roundtrip.mjs** — OBSOLETE. It calls `writeByPageSnapshot(docId, null, null, store, null, sourceMap, surveyMeta)`
  — a 7-arg call to a function whose signature is now `(documentId, byPage, callouts, supabaseClient, meta)`
  (5 args). The extra `sourceMap`/`surveyMeta` are silently dropped, so the reconstruction is empty
  ("NOT LOSSLESS", 4 → 0). Survey markers were refactored OUT of the snapshot store; they now persist as
  `document_annotations` rows (types survey-marker/highlight — the same pipeline roundtrip-save-reopen
  exercises). This test guards a removed code path. → Superseded by the new `survey-marker-crud-e2e.mjs`
  (drives the real app) for B2. NOT a gate; left as-is (a later B2 pass may rewrite it to the new model).
- **regress-idle-disappearance.mjs** — times out waiting for a `button` with text "Select Template",
  which no longer exists anywhere in `src/` (template-selection flow changed post-migration). It DID pass
  its first substantive check (12 fabric annotations render). The idle/recovery behavior it guards
  overlaps `repro-sleep-wake.mjs` (green). → Pre-existing UI-flow drift; NOT a gate.

## Args note (for the runner)
- `survey-roundtrip.mjs` requires `<documentId>` (default doc 00e1cde9-449b-4771-9743-37bd604557a9).
- The mock-harness tests (version-history, lock-document, regress-idle) spin their own network-edge
  Supabase mock; the real-backend node scripts self-load `.env`/`.env.local`.
