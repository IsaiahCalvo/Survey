# Full System Audit — Zoom, Eraser, Renderers, Spike Readiness
Date: 2026-07-09 · Branch: claude/pdf-viewer-optimization-8fedf8 · All findings browser-verified on http://localhost:5174

## Executive summary

Owner-reported symptoms, root causes, and status:

| # | Symptom | Root cause | Status |
|---|---------|-----------|--------|
| 1 | Annotations jittery during wheel zoom | Overlay divs were siblings px-copied from *measured* page geometry — landed 1+ frames after the engine's atomic page re-layout at every 110ms settle commit (measure-then-write across two React trees). Official pdf.js viewer never measures: every layer is a CSS function of one `--scale-factor` property. | **FIXED** (c5b5b63b): per-page overlay slot rendered inside each page div; overlay geometry = CSS inheritance (`inset:0`), resizes in the same paint as the page. |
| 2 | Pen ↔ eraser switch lag (~0.7s) | Arming a tool mounted a Fabric canvas on **every** page (36 canvases, one main-thread burst). | **FIXED** (2f779acf): canvases gated to the IntersectionObserver visible-page window. Measured: 666ms → **33ms**, 36 → 7 canvases. |
| 3 | Eraser click "alters line height of nearby strokes" | `FabricEraserCanvas` enliven forced `strokeUniform:true` on every object; leaked into the erase commit; SVG renderer maps it to `vector-effect:non-scaling-stroke` → stroke weight stops tracking zoom (fatter at <100%, thinner at >100%) the instant any erase commits. | **FIXED** (2f779acf): preserve the source object's flag. Verified: zero non-scaling paths after graze-click erase at 114% zoom. |
| 4 | Eraser "wipes out entire strokes / full-width cuts instead of a rounded bite" | `inkEraser.js` erased **centerline intervals** — a 1-D model. Any contact with the stroke's edge removed the full stroke width at that span; it could not represent a partial-width crescent. (Radius/tangency math itself checked out: the visible cursor circle and the bite reach agree.) | **FIXED**: new `crescentErase.js` — centerline capsule test kept as the cheap touch gate; on first contact the stroke lazily converts to its filled outline and the swept eraser capsules boolean-subtract true 2-D geometry (the `geometryEraser.js` machinery, previously gated to legacy shapes). Live per-mousemove; >600-segment imported paths fall back to the old cut (perf guard). Browser-proven: edge graze leaves a rounded partial-width notch with the far edge intact; a crossing drag splits cleanly with rounded cut ends; 6 new geometry unit tests. |
| 5 | Eraser "worked once then never again" (previous session) | Known ribbon/hit-test defect; fixed wholesale by the merged `claude/eraser-live-feedback` rebuild (verified 3 successive bites on one stroke). | **FIXED** (merge 1a1216a4). |
| 6 | Flicker during zoom (previous session) | Committed-annotation surface was `visibility:hidden` for 1400ms on every keyboard/toolbar zoom (Syncfusion snapshot-era gate, nothing rendered in its place) + 1-frame white flash on page remounts. | **FIXED** (91d0c304): gate removed (guarded by source-assertion test), settle constant 1400→250ms, raster-cache blit moved pre-paint. Verified: 321-frame recorder, 0 hidden frames across toolbar+wheel zoom. |
| 7 | Cloudflare blocks sign-in on local/demo | Worktrees missing the gitignored `.env.local` load the real Turnstile widget against the production site key (localhost not allowlisted) → unwinnable "I'm human" loop. Prod Supabase has server-side Turnstile ON; survey-test does not. | **FIXED** for this worktree (`.env.local` copied; auto-login active). Manual sign-in also falls back to the existing dev bootstrap (dev builds only, dev account only). Recurrence risk: every new worktree needs `.env.local` — candidate for a setup script. |

## Zoom architecture verdict (vs official PDF.js viewer)

- Live gesture (ctrl-wheel drag): **already clean** — single CSS transform on one content node, overlays ride it as children; per-frame chase loops were already dead (`KAL-241`), confirmed by frame recorder (no long tasks; overlay/page desync 0 during drag).
- Settle commit: was the jitter source (row 1 above). The official viewer's contract — *no JS ever measures a rendered box to position another box; all layers derive from one scale property in one style pass* — is now matched for overlay geometry.
- Remaining deltas vs official viewer (lower priority):
  - `layerScale` (hit-test math only, not visuals) still re-derived via DOM measurement one effect-hop after commit. Cosmetically irrelevant now; candidate cleanup: pass the engine's committed scale through the zoom-commit payload.
  - Dormant "dual-layer / live-stable-overlay" subsystem (off by default, one handler confirmed dead-unwired) applies its own overlay transforms if ever enabled — deletion candidate; it would fight the new CSS-inheritance model.
  - Deep zoom (>250%): brief soft→sharp catch-up at settle. Identical code + behavior in the reference demo (viewport-slice detail tile re-renders after commit). Parity, not a regression.

## Eraser — mechanics decision (research-backed)

Requirement (owner): true point eraser — edge contact bites a rounded, partial-width crescent out of the stroke's side, altering the real vector shape; only the contacted area erases.

Survey of OSS (fabric @erase2d, tldraw, excalidraw, Paper.js, Clipper2, perfect-freehand, Krita/Inkscape models):
- tldraw + excalidraw: whole-shape deletion only — both have *open issues asking for* what we're building. Not adoptable.
- fabric @erase2d: clip-mask model — visual bite but geometry never changes; PDF export would see the unerased stroke. Codebase already tried and deliberately removed a masking approach ("the ink itself is the preview"). Rejected.
- Professional-tool consensus (Drawboard/Inkscape/Krita): **boolean subtract on the stroke's filled outline**. That exact algorithm already exists in `src/utils/geometryEraser.js` (`strokeToPolygon` round-cap ribbon + martinez `diff`, hole-ring support) — but was gated to re-erasing legacy shapes only; fresh strokes went through the centerline-splitting model that can't do partial-width bites.

Decision (implemented): keep the capsule/centerline test as the cheap *touch gate*; on first real contact, lazily convert the stroke to its filled outline and boolean-subtract the swept eraser capsules (martinez, already a dependency; zero new bundle). Persist in the already-supported outline format. Fallback to the old behavior on very long imported paths (perf guard). New unit tests: edge-graze crescent, full crossing split, repeat erase with holes, no-contact no-op, one-time conversion.

**Companion fix (export gap) — DONE:** both PDF ink exporters wrote `/InkList` from path points unconditionally — erased outlines exported as wrong-width unfilled boundary traces. Now: filled-outline ink emits a filled `/AP /N` appearance stream (even-odd fill matching the SVG renderer, exact Q→C conversion, color from fill, opacity honored) plus the legacy `/InkList` fallback; also fixed a falsy-zero bug that collapsed intentional zero-width borders to 1. Ring+hole outline round-trips through the real importer in tests; plain strokes byte-identical to before (regression-tested).

## Renderer-count answer (owner question)

The reference demo: 2 renderers — pdf.js page canvas + one SVG overlay for annotations.
Production before this session: page canvas + committed-annotation SVG + Fabric Canvas2D surfaces (draw/erase/edit) — and live ink VISIBLY came from a different renderer than released ink (the thick→thin pop).
Production now: the user-visible contract is **two renderers** — page canvas + SVG. Live pen/highlighter ink renders as SVG (same attrs as committed; Fabric's Canvas2D surface is input-capture only, opacity 0); live erase mutates the real geometry ("the ink is the preview"). Fabric remains as input plumbing, not a visible renderer. Remaining visible exception: shape-drag previews (rect/ellipse/line/arrow) still draw on Canvas2D during the drag — same class of fix available if it ever bothers.

## Spike (?spike=features) replacement-readiness

**Verdict: (3) Not a viable replacement** — full evidence report + 17-row parity matrix in `.planning/optimization/spike-replacement-readiness.md`.

- The spike's *rendering engine* is the same lineage production already shipped (production's engine was ported FROM this spike) — zoom smoothness, virtualization, race guards, drift all held on both routes (p95 frame 9.9ms during zoom, zero drift after 20 zoom cycles, zero console errors, no leak after scroll sweeps). The rendering half of "is the demo better" is moot: production already runs it.
- The spike's *annotation layer* is missing, with zero code found: PDF export/write-back (immediate production blocker per directive), any eraser, undo/redo, collaboration. Production has tested pipelines for all four.
- "240,000 virtual annotations": **no such claim exists in the codebase.** Real ceiling: 1,000 synthetic stress shapes/page × 120 pages = 120,000 theoretical; virtualization means only mounted pages have DOM shapes (~1,000 paths measured on a max-density page; ~16,000 simultaneous worst case). The stress shapes are synthetic client-generated marks — a stress harness, not real annotation data.
- Spike text selection is broken on pdf.js 6.1.200 (missing `--total-scale-factor` CSS contract — confirmed by injecting it live and watching selection start working). Don't copy that layer as-is.
- Renderer-count correction from the in-browser count: the live spike route hardcodes edit mode ON, so its visible annotation stack is 1 SVG renderer (page canvas doesn't bake). Production's simultaneous-visible worst case in a draw gesture is page canvas + committed SVG + live SVG preview (Fabric canvas invisible, input-only) — visually consistent (all ink = SVG), architecturally 2 renderer technologies.

## Verification inventory (this session)

- Frame recorder across toolbar + wheel zoom: 0 annotation-hidden frames; path count steady.
- Overlay/page bbox desync recorder during zoom (post-fix): 461 frames across 16 notchy wheel commits (worst case for the old settle pop) — max desync 0.00px in x, y, width, height. Overlay verified living inside the page's own slot.
- Tool switch: 666ms/36 canvases → 33ms/7 (trusted-input measurement).
- Eraser: 3 successive partial erases on one stroke, no errors; graze-click at 114% zoom leaves `vector-effect` untouched doc-wide.
- Live-vs-released pen stroke screenshots: identical weight.
- Suite: 1898 tests / 0 fail; vite build clean. All work committed on this branch (not pushed).
