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

### Pass 2 — DONE (2026-06-04)
16 candidates → 4 safe applied (one search-list item kept on hold, see below),
3 more applied under the high-risk standing waiver, 5 rejected. Tests 888 pass, build OK.

Applied (safe, non-protected files):
- Narrowed two effect/callback deps to user?.id (auth tier poll, project team).
- Parallelized three independent usage reads (was a 3-round-trip wait).

Applied under standing waiver (protected files, minimal + verified + tests green):
- SVG annotation layer: two per-object render-loop lookups now use module-level
  Sets (zero per-object allocation in the hot zoom/scroll loop); polygon centroid
  computed in a single pass instead of four.
- Page annotation layer: callout-selection scan uses a Set instead of a linear
  scan (both selection handlers).
- Main viewer: the Excel library now loads on demand (split into its own ~270KB
  gzip chunk) instead of riding in the main bundle.
- Owned-docs + collaborator reads run concurrently in the documents query.

Rejected (correctly): focus-effect dep (user ref is already churn-guarded),
search-highlight default array (component never mounts in the empty case),
two save/sync parallelizations (sequential short-circuit is load-bearing).

### Held for sign-off (real, but behavioral/visual nuance)
- [APPLIED 2026-06-04, user-approved] Lazy-load the entire PDF viewer. Initial
  JS chunk dropped from ~14,700 kB (gzip ~4,662) to ~2,884 kB (gzip ~817); the
  viewer is now its own ~10,306 kB (gzip ~3,513) chunk fetched on first PDF open.
  Tests 888 pass, build OK. NEEDS a live open test (Suspense fallback null +
  first-open toolbar-API publish timing) before push.
- Survey-rail marker matching via a lookup map (first-match + key-collision nuance).
- Region cursor glyph driven by a ref instead of state (per-move re-render win,
  but a first-frame position nuance).
- content-visibility on the page-thumbnail and text-search lists (variable row
  heights interact with existing scroll/observer behavior).

### Pass 3 — pending
Safe auto-apply pool is thinning; remaining gains are the held items above.
