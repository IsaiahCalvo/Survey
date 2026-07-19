# Handoff — Match/beat the pdf.js demo eraser smoothness
Written: 2026-07-19 (rewritten after worktree recycle; original 2026-07-17). Self-contained brief. Repo: /Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2.

## The goal
Our eraser is functionally correct but feels laggier than the pdf.js reference demo (demo source in-repo: `src/prototype/CanvasAnnotationLayer.jsx`; launcher `/Users/isaiahcalvo/Desktop/PDF.js Demo.command`). Make our eraser's live drag feel as smooth as the demo's **without losing any features**. Target: match or beat the demo.

## Root cause (verified by audit 2026-07-17 — re-verify cites, don't re-derive)
The carve GEOMETRY is the **same shared code** in both (`paperAnnotationGeometry.eraseAnnotations`, same coalesced-pointer sampling, same 0.2px min-distance, same round-cap painter). The demo is NOT smoother because it carves better. The entire difference is per-pointer-move work during the drag:
- **Demo:** snapshots the page on pointerdown, then each move is ONE cheap `destination-out` round-stroke punch. O(1) per move. `src/prototype/CanvasAnnotationLayer.jsx:682-707` (punch), `:848` (copyStatic on down), `:908` (per-move), `:725-729` (single-surface commit at release).
- **Ours:** every pointer-move runs `planPageEraserPreview` (boolean-erase plan) AND `ghostAtomicNonPathHits` (per-object hit-test over ALL non-path objects) — even mid-carve. `src/components/FabricEraserCanvas.jsx:469-490` (ghost check every move), `:492-561` (per-move plan). That per-move O(objects) work is the lag. First visible carve is also gated behind `previewHasPartial` (`:515-547`) — first touch feels less instant.

Ours does more because it HAS to: stamps/text/callouts/text-markup whole-delete, permission gating (`getEraseBlockReason`/`canErase` `:432-461`), space-scoping, zoom-mid-stroke auto-commit (`zoomGeneration` `:794-803`). The demo has none of that.

## Approach (recommended — confirm in code)
Adopt the demo's **"punch-first, identify-at-release"** model for the whole drag:
1. Pointer-down: snapshot/prepare the preview surface (like the demo's copyStatic).
2. During drag: ONLY punch transparent holes following the cursor (the app already does this cheap punch once ink-carving is active — `FabricEraserCanvas.jsx:498` — extend to the pre-carve phase and whole-delete objects). Stop running `planPageEraserPreview` + `ghostAtomicNonPathHits` per move.
3. Defer ALL object identification (which stamps/text/callouts/markup were hit, permission checks, actual carve commit) to pointer-UP. Run the plan/hit-test ONCE at release, then commit.
4. Permission correctness: non-owners still must not erase others' marks. With identification at release, apply `canErase` at release — decide whether blocked marks simply reappear on release (demo-style, punch was cosmetic) or add a cheap up-front signal. Decide and document with a UX comment.

## Secondary win (optional, same session)
Mixed strokes crossing callouts/text-markup fragment undo into 2-3 steps (separate callbacks `FabricEraserCanvas.jsx:624`, `:641`, `:647`) vs the demo's single commit. Unify: one stroke = one undo step.

## Hard constraints
- Locked zoom convention: SVG viewBox owns scaling; page-unit annotation scaling; NO JS zoom coordination; `zoomGeneration` contract stays — eraser still auto-commits on zoom.
- Partial ink carve stays pixel-identical (shared engine — don't fork).
- Cross-author rules hold (own-marks-only erase is deliberate; no confirm modal in the eraser).
- All types still erase (ink carve, stamp/rect/text whole-delete, callouts, text-markup).
- Your files: `src/components/FabricEraserCanvas.jsx`, `src/utils/pageSpaceEraser.js`, eraser preview painter. `src/PDFViewer.jsx` = high-risk, minimal scoped edits only.

## Verification
- `node scripts/run-node-tests.mjs` 0 fail + `npx vite build` green after each change.
- `agent-cli/callout-interaction-e2e.mjs` 6/6.
- Real app (own vite, FREE port — check with lsof first): erase big ink stroke / stamp / text / callout / mixed sweep — all still erase; drag visibly smooth (no per-move stutter); one undo restores a mixed stroke; non-owner can't erase others' marks; zoom mid-stroke keeps the erase. Screenshots.
- Side-by-side feel vs the demo; final trackpad feel-check is the OWNER's (hand it off explicitly).

## Linear
KAL-366 carries the audit finding.
