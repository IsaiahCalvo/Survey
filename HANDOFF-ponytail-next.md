# Handoff — Remaining Ponytail Cleanup (next session)

_Written 2026-06-30. Everything else from this session's work is DONE + pushed to `origin/main` (HEAD `ae773fed`)._

## State: clean, all shipped
- Callout-unification keystone: **complete** — persistence unified, interaction fixed, flag permanent (kill switch retired), 11 prod rows backfilled to `.fabricObject`, dead callout sync deleted (~476 lines). Behavioral guard: `agent-cli/callout-interaction-e2e.mjs` (run it after any callout/SVGAnnotationLayer change).
- Mobile monolith split: **complete** — `mobile-expo-go/App.tsx` 9,319 → 1,816 lines, 25 typed modules.
- Ponytail small-dead-bits + deps: **done** (mostly already-clean from a prior session).
- Sticky-note audit flag: **closed** (no gap — Note tool disabled by design).

## What's LEFT — 2 ponytail batches only
Both live in `debug/ponytail-audit/REMAINING-EXECUTION-PLAN.md` and both touch the **high-risk `src/PDFViewer.jsx`**, so they are **SERIAL (one at a time, not parallel)** and need careful, minimum-diff edits. PDFViewer.jsx is now free (callout work landed).

**FIRST verify the plan isn't stale** — a prior session/loop-fleet already did several ponytail items this session's agents found as no-ops. Grep/check each target still exists before editing.

### 1. stdlib-rewrites — plan §3
- §3a: ~25 hand-rolled ID generators → `crypto.randomUUID()`. **CAREFUL:** some IDs carry a format/prefix (e.g. `callout-…`, `counter-…`) that other code parses or string-matches — only swap generators the plan marks GO, and confirm nothing depends on the old format before changing each one.
- §3b: `JSON.parse(JSON.stringify(x))` → the shared `deepClone` wrapper. Mechanical.
- §3c (hex encode/decode): **HOLD** — needs a polyfill check; skip.

### 2. pdfviewer-deadcode — plan §4
- Dead branches behind the constant-true `usePdfjsRenderer` flag, in **atomic batches 4a–4e** (delete each batch's pieces together).
- §4f (overlay recorder) is **already DONE**.
- **NEVER touch the live KAL-241 perf lines:** `PDFViewer.jsx:5437`, `:5609`, `:1894–1899`.

## Rules (carry forward)
- Validate every deletion against real importers/call sites — the plan's fallow findings are a FLOOR, not ground truth. Never delete something still referenced (incl. string-form references and test imports).
- Gate EVERY batch: `npx vite build` + `node scripts/run-node-tests.mjs` (baseline 1685 pass / 0 fail). For PDFViewer.jsx batches also run `node agent-cli/render-smoke.mjs` (needs the dev server: `npm run dev:ui`, then the smoke + `agent-cli/callout-interaction-e2e.mjs`).
- Commit each batch small + immediately. Land on local `main`, owner tests on dev server, **push only after owner approval**.
- PrintPanel cleanup is parked (Linear KAL-315) — do NOT touch it.
- Mobile split step 12 (`useDocumentState` hook extraction) needs an owner device test — deferred.
