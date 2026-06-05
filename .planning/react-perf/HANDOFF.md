# React Performance Optimization — Handoff

Self-driving audit loop against Vercel's `react-best-practices` skill. Full record
in `.planning/react-perf/LEDGER.md`; reusable workflow in
`.planning/react-perf/audit-workflow.mjs`.

## What's done (committed on local main, NOT pushed)
Five commits, 21 verified behavior-preserving wins across two audit passes:
- Pass 1 (37a194d1): 12 wins — hoisted inline components, lazy state init,
  Math.min, parallel PDF parse, passive listeners, svg-wrapper animation, hoisted SVGs.
- Pass 2 (171e8997): 3 wins — narrowed effect/callback deps to user?.id, parallel usage reads.
- Pass 2b (68bade35): SVG-layer hot-loop Sets + single-pass centroid, PAL Set lookup,
  exceljs lazy-load (own ~270KB-gzip chunk), parallel doc/collaborator reads.
  (Protected files edited under standing waiver — minimal, tested.)
- Viewer lazy-load (745fe58b): initial JS dropped ~4,662KB→~817KB gzip; viewer is
  its own chunk fetched on first PDF open. User-approved.
- Thumbnail list content-visibility (d108f97d).

Verified live: newest app run after these changes booted clean and the user
opened a PDF + zoomed 64× + paged 9× with no errors. 888 node tests pass + build OK
after every commit.

## Uncommitted in working tree
- `src/sidebar/SearchTextPanel.jsx`: my content-visibility tweak on the search-results
  list IS applied, but the file ALSO carries the user's pre-existing local WIP
  (an Esc-to-clear-search feature). Left uncommitted on purpose — user commits together.

## Remaining held items (NOT done — need a careful fresh session + live test each)
1. **Survey-rail marker matching** — replace per-marker `Object.values(items).find(...)`
   with one component-level `useMemo` lookup Map keyed `name \0 itemType`. MUST preserve
   FIRST-match semantics (only set key if unseen) and use a `\0` delimiter (names contain
   spaces). 4 call sites; one is in an event handler (not render). Corrected diff in pass-2
   output / LEDGER.
2. **Region cursor smoothness** — drive the +/- draw-cursor position via a ref + direct
   style write instead of per-move setState. Keep BOTH conditional indicator divs and their
   exact `isCursorOverCanvas && tool && selectionMode` gating; seed initial position from a
   cursorPosRef to avoid a first-frame flash at 0,0. NOT high-risk file but real visual nuance.

## How to resume
Run another sweep: `Workflow({scriptPath: ".planning/react-perf/audit-workflow.mjs",
args: { exclude: "<everything in LEDGER passes 1+2+3>" }})`. Apply safe findings in small
batches, gate each on `node scripts/run-node-tests.mjs` + `npx vite build`, commit on local
main, surface anything touching the protected files or with behavioral nuance.

Protected/load-bearing files (standing waiver allows minimal edits + tests, never refactor):
PDFViewer.jsx, PageAnnotationLayer.jsx, SVGAnnotationLayer.jsx, viewerShared.js, the three
Fabric canvases, package.json, vite.config.js.
