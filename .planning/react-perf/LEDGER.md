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
- [APPLIED 2026-06-04] content-visibility on the page-thumbnail list and the
  text-search results list so off-screen rows skip layout/paint. Thumbnail row
  height estimated from per-page aspect ratio; search rows use 'auto 56px'.
  Tests pass, build OK. Live-test: scroll big lists + scroll-to-active still land.
- Survey-rail marker matching via a lookup map (first-match + key-collision nuance).
- Region cursor glyph driven by a ref instead of state (per-move re-render win,
  but a first-frame position nuance).
- content-visibility on the page-thumbnail and text-search lists (variable row
  heights interact with existing scroll/observer behavior).

### Pass 3 — pending
Safe auto-apply pool is thinning; remaining gains are the held items above.

### Pass 4 — DONE (2026-06-04, commit 673aea62)
15 candidates → 7 applied safe, 5 surfaced risky, 3 rejected. Tests 888 pass, build OK (17.8s).

Applied (safe):
- AppShell now imports ARROWHEAD_STYLE_LABELS from the fabric-free Callout/types
  leaf instead of PageAnnotationLayer. This was the only first-paint static edge
  into the ~10k-line PAL module + fabric.js. Entry chunk ~2.88MB → ~2.34MB;
  fabric markers in entry chunk now 0 (lives only in the lazy viewer chunk).
  Values byte-identical; PAL and PDFViewer untouched. (biggest win of the pass)
- svgAnnotationRenderers renderPolygon + renderPolyline: single-pass bbox min/max
  instead of two throwaway .map arrays + four spread calls per shape per render
  (kills call-stack-blowup risk on many-vertex cloud polygons too).
- DocumentsLedger: id→name lookup Map for project names (was O(docs×projects) find per row).
- PrintPanel: Math.min over the included-page set instead of Array.from+sort()[0].
- TemplatesEditor: two dismiss-on-scroll capturing listeners marked passive.

Rejected (correctly): Dashboard + PdfPageThumb dynamic pdfjs import (zero benefit —
pdfjs already eager via viewerShared, and the suggested fix referenced a non-existent
worker-config module); pdfHasAnnotations parallel loop (dead code, breaks early-exit).

### Held for sign-off (pass 4 — real, need human call + live test)
1. **[APPLIED 2026-06-04, commit 3855beb7 — NEEDS LIVE TEST before push]** Dropped
   pdfjs out of the first-paint entry chunk. The audit's note was incomplete: there
   were FOUR entry-reachable static pdfjs importers, not one — viewerShared (eager
   worker config), Dashboard + PdfPageThumb (page-count/thumbnail), and PDFSidebar →
   SearchTextPanel (text-layer). New utils/pdfWorkerConfig.loadPdfjs() lazily loads
   pdfjs + sets workerSrc once (idempotent); all four call it / lazy-load instead of
   importing pdfjs at module top. PDFViewer awaits it before getDocument. PDFSidebar
   lazy-loads SearchTextPanel. Entry chunk 2,345KB → 1,576KB (gzip 666 → 467);
   PDFDocumentLoadingTask/AnnotationLayer now 0 in entry; pdfjs ships in its own
   chunk on first open. viewerShared engine-selector WIP left unstaged (partial
   commit). Tests 888/0/6, build clean. Live-test: home loads, thumbnails render,
   upload counts pages, open works, text search works.

   ~~Original held note:~~ viewerShared.js eagerly
   imports the whole pdfjs-dist lib + worker URL just to run one module-level side
   effect (GlobalWorkerOptions.workerSrc=). That keeps ~1MB+ of pdfjs in the entry
   chunk. Fix = move the worker-config side effect into a tiny idempotent leaf module
   and `await import()` it before the first getDocument in EVERY consumer (Dashboard,
   PdfPageThumb, PDFViewer). RISKY: viewerShared.js is protected/load-bearing, the
   side effect is a global singleton multiple getDocument callers depend on by import
   order; must re-home all three or pdf.js silently falls back to a fake worker.
   Full corrected step-by-step in the pass-4 workflow output. The biggest remaining
   bundle win after the fabric one.
2. **PDFViewer scroll listener passive** (LOW). One scroll listener at ~4720 lacks
   {passive:true}; handler only debounces a timeout. Trivially correct but in the
   highest-risk file, so surfaced.
3. **PdfjsViewerContainer startTransition on the virtualized range update** (LOW).
   Wrapping the per-frame setRange in startTransition could defer page mounts under
   fast scroll → blank-frame risk on the core renderer. Behavioral tradeoff on WIP
   cutover code (Phase 37, off by default). Needs measured judgment, not auto-apply.
4. **Parallelize the per-page annotation import** (HIGH). importAnnotationsFromPdf
   imports pages strictly sequentially (~450ms warm on a 36-page doc). Pages are
   independent; a bounded-concurrency rewrite (cap ~8) with careful counter/Set
   folding is the fix. RISKY: non-mechanical, import-coupled to PDFViewer; the naive
   diff drops a Set + 3 counters. Note pdf.js engine already skips the hottest caller.
5. **content-visibility on the documents-ledger rows** (MEDIUM). Additive CSS so
   off-screen rows skip layout/paint; matches the existing pass-3 pattern. Low risk
   but only pays off with large document counts; intrinsic size should be ~50px
   (two-line "last edited" cell), not 42px.

### Pass 5 — pending
Safe auto-apply pool is now essentially dry. Remaining wins are the 5 held items
above (1 and 4 are the high-value ones) plus the still-open pass-2 held items
(survey-rail marker map, region cursor ref). All need a human call / live test.
