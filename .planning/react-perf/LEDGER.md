# React Performance Optimization — Ledger

Self-driving audit loop against Vercel's `react-best-practices` skill.
Workflow: `.planning/react-perf/audit-workflow.mjs`. Re-run with
`{ scope, exclude }` args to converge until a pass finds no new safe wins.

**App shape:** Vite + React 18.3.1 + Electron (NOT Next.js). Server/RSC/hydration/
Activity rules are out of scope by design.

**Baseline (2026-06-04):** 888 node tests pass, 0 fail.

## How a pass works
1. 6 rule lanes grep the tree for anti-pattern signatures, confirm by reading context.
2. Every candidate is adversarially re-verified (rule truly applies + behavior-preserving + no invariant break).
3. Classified: apply-safe / surface-risky / reject.
4. Safe ones applied in small batches, each gated on `vite build` + `node scripts/run-node-tests.mjs`.
5. Risky ones listed below for human sign-off — never auto-applied.

## Passes

### Pass 1 — DONE (2026-06-04)
18 candidates → 12 applied safe, 5 surfaced risky, 1 rejected. Tests 888 pass, build OK (30.5s).

Applied (safe):
- Hoisted inline components out of render bodies (OneDrive folder browser, usage panel,
  sidebar history button) — they were remounting every render instead of updating.
- Dropped a needless memo on two id strings; made the entity list build once instead of every render.
- Replaced a sort-to-get-min with a single-pass min; ran two independent PDF parses in parallel on open.
- Marked two scroll/touch listeners passive so they don't block scrolling.
- Put the survey-rail chevron animation on a wrapper so it can hardware-accelerate.
- Hoisted three static brand logos so they aren't rebuilt each render.

Rejected: colour-picker drag startTransition (would decouple the indicator from the cursor).

Surfaced — RISKY, need sign-off (not applied):
1. Lazy-load the Excel library in the main viewer (only used on export/sync) — high-risk file.
2. Lazy-load the whole PDF viewer so first paint (dashboard) skips fabric/excel/annotation weight.
3. Build a lookup map for survey-marker matching in the rail (first-match + delimiter nuance).
4. content-visibility on the page-thumbnail list (interacts with existing lazy-thumbnail observer).
5. content-visibility on the text-search results list (variable row height).

### Pass 2 — pending
Re-run with the pass-1 findings excluded to surface anything new.
