# Handoff — Zoom: constant page gap + lock-to-center
Written: 2026-07-19 (rewritten after worktree recycle; original 2026-07-17). Self-contained brief. Repo: /Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2.

## TWO fixes, ONE session — do NOT split
Page-gap and centering both live in the viewer's layout/scroll/zoom code and interact (both change scroll position during zoom). One session, together.

## Problem A — Page gap rides the zoom (REGRESSION — was fixed before)
The white gap between pages grows on zoom-OUT and shrinks on zoom-IN. It must stay CONSTANT regardless of zoom. This worked before and regressed — check git history/blame on the page-container layout + gap value for a prior fix that got reverted (likely a fixed-px gap that became a scaled value).

## Problem B — No lock-to-center once a page fits (ALWAYS been broken — fresh fix, no prior good state)
Cursor-centered zoom is correct and stays. BUT:
- **Horizontal:** once a page fits fully within the viewport width (both edges visible), it must LOCK horizontally centered with ZERO left-right play. Today it drifts off-center during cursor-zoom then snaps back — it should just stay centered, smoothly, no snap.
- **Vertical:** at the very top of a document, hold a steady margin between the first page's top and the top rail instead of snapping after each zoom; same at the bottom.
- **Single-page documents too:** a one-page doc must be centered by the same rule (owner explicitly confirmed this).
- Target: SMOOTHER than the pdf.js reference demo (`src/prototype/` ?spike= demos; launcher on the owner's Desktop) — the demo still snaps; beat it.

## Where to look (starting points, not confirmed root cause)
- `src/components/PdfjsViewerContainer.jsx` + the zoom/scroll handlers and batched page-sizing loop in `src/PDFViewer.jsx` (~19815-19863 area), the cursor-centered zoom handler.
- The page-gap source: whatever sets vertical spacing between page divs (CSS gap/margin or computed layout) — make it constant screen-space across zoom.
- Centering: the horizontal scroll/translate applied during zoom — clamp so page-width ≤ viewport-width forces centered with no play; vertical margin hold at document top/bottom.

## Design intent (bake into UX comments per project rule)
- Page gap = constant screen-space distance, independent of zoom.
- Cursor-centered zoom stays the feel WHILE the page overflows the viewport.
- The moment a page fits on an axis, that axis LOCKS to centered / steady-margin — no drift, no snap-back; smooth transition between overflowing and fits (no jump).
- Applies to single- and multi-page documents alike.

## Hard constraints
- Locked zoom convention: SVG viewBox owns ALL scaling; annotations scale in page units; NO JavaScript zoom coordination in `SVGAnnotationLayer.jsx`; never reintroduce the old 5-timer zoom system; `zoomGeneration` signal contract stays.
- Annotations stay pinned to page content through all changes — verify zero annotation drift at min/max zoom.
- `src/PDFViewer.jsx` high-risk (standing waiver): minimal scoped edits, `npm test` after, report baseline.
- Synthetic wheel events can't drive the real zoom path (known limitation) — build, verify headlessly what you can, hand the trackpad feel-check to the owner explicitly.

## Verification
- `node scripts/run-node-tests.mjs` 0 fail + `npx vite build` green.
- Real app (own vite, FREE port): multi-page doc — zoom in/out: constant gap; zoom until page fits width: locks centered, zero left-right play, no snap; top/bottom: steady margins. Single-page doc: centered at all zooms. Screenshots each. Annotations glued to pages at extremes.
- Flag for owner: trackpad feel needs their hands.

## Linear
KAL-368 carries the spec comment (flagged there that this is partly a new behavior request; owner may split it into its own ticket).
