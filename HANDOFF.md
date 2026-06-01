# Handoff — Renderer spike round 3 (2026-05-31)

**Branch**: `main`, local-only (direct-to-main; nothing pushed). Two spike commits
landed this session: `fdbf63a3` (real two-arm mini-viewer) and `54ea7478` (EmbedPDF
zoom-feel match + comparison logger). Build + `npm test` green (840 pass / 0 fail /
6 skip). Dev server runs on **5173** (Isaiah's) and **5199** (the one I used);
open the spike at `…:5199/?spike=renderer`.

**The spike** is a throwaway two-arm PDF mini-viewer at `?spike=renderer`
(`src/prototype/` — RendererSpike, PdfjsArm, EmbedpdfArm, InteractiveOverlay,
spikeMetrics, spikeLogger). Arm A = pdf.js we own; Arm B = EmbedPDF plugins. Both
do continuous virtualized scroll, cursor-anchored zoom (matched gains), a shared
interactive overlay, live metrics, and a "Save log" button that downloads
`PDF render comparison <timestamp>.log`.

## Read these first (researched this session — concrete facts)
- `.planning/spike-pdf-analysis.md` — the real file's exact page geometry + annotations.
- `.planning/spike-walkthrough-study.md` — how Isaiah's **`IsaiahCalvo/Walkthrough`**
  repo (PRIVATE; **already cloned locally at `/Users/isaiahcalvo/Projects/Walkthru`** —
  read it there, do NOT re-clone; an UNauthenticated existence check 404s, which earlier
  misled me) renders rotation + pins
  overlays + imports annotations. Key facts from it: production renders with **pdf.js
  (react-pdf)**, NOT EmbedPDF (EmbedPDF is a dev-only bake-off there too). It gets
  rotation right by **letting pdf.js bake each page's intrinsic `/Rotate`** (no rotation
  passed to getViewport; `onLoadSuccess` reports already-rotated dims; pages self-size,
  centered flex column). Pinning = ONE outer `transform: translate() scale()` zoom layer
  (origin 0 0); pages stay at scale 1; overlays live INSIDE each page wrapper positioned
  by PERCENT; screen↔page mapping uses the wrapper's `getBoundingClientRect()`, NEVER
  `pageSize*scale`. Its EmbedPDF prototype sizes the overlay to the engine's
  `rotatedWidth/rotatedHeight` and feeds rotation into `renderPage({options:{rotation}})`.
  Annotation import = `getAnnotations({intent:'display'})` mapped via
  `viewport.convertToViewportRectangle/Point` (pdf.js does the y-flip + rotation), Ink →
  non-scaling-stroke SVG polylines, each subtype an editable overlay object.

## The 3 tasks Isaiah asked for (this is the next session's work)

### 1. Pages must render at the CORRECT orientation + size on real imports (root cause found)
The real file (`…/PDFs from Desktop/Package 2 - Rev 4 -- IC.pdf`) is **36 pages, 3
geometry combos**: 28 landscape `1224×792` /Rotate 0; **6 pages (indices 5–10) are
`792×1224` /Rotate 270** (display landscape); 2 portrait `612×792` /Rotate 0. The 6
rotated pages are the ONLY non-zero rotation **and they carry ALL 3056 annotations.**

Our pdf.js arm assumes rotation 0 — it sizes layout from `pageSizes` measured at
`getViewport({ scale:1, rotation:0 })` and only swaps dims for the manual Rotate
button. So pages 5–10 come in mis-oriented. **Fix (per the `takeoff` repo): let
pdf.js bake each page's intrinsic `/Rotate` — call `page.getViewport({ scale })`
WITHOUT forcing rotation:0, and size the canvas + CSS box + overlay `viewBox` from
that rotation-corrected viewport (its width/height are already swapped).** Keep the
manual Rotate button as an *additional* user rotation layered on top. EmbedPDF/PDFium
already honors `/Rotate` for the page image — but see task 2.

### 2. EmbedPDF annotations not staying pinned on zoom (likely the SAME rotation issue)
On the uniform test fixture the EmbedPDF overlay is **perfectly pinned** (I measured
overlay-vs-render = 0px at rest, mid-zoom, and after — so it's not a general bug).
The drift Isaiah sees is almost certainly on the **rotated pages of his real file**:
our overlay takes EmbedPDF's `renderPage` width/height (the *displayed*, rotated dims)
and treats them as the `viewBox` page space. For /Rotate 270 pages the true annotation/
page space is the UNROTATED `792×1224` box, so the overlay's coordinate basis is rotated
relative to the page → annotations land wrong and mis-track on zoom. **Reproduce with
the real file on Arm B, then make the overlay use unrotated page-point dims and apply
the page rotation consistently for both arms.** (Annotation coords in the PDF are in
unrotated page space — confirmed.)

### 3. Import the PDF's real annotations as interactive (new feature)
Currently the overlay only shows synthetic seed shapes. Import the file's actual
annotations: **3049 Ink, 6 Square, 1 FreeText**, all on pages 5–10. Approach (from the
`Survey` repo): `page.getAnnotations()` (pdf.js) for geometry + types, map PDF
bottom-left coords via `viewport.convertToViewportRectangle` (handles rotation + y-flip),
render each in the overlay in page space, make them selectable/movable like the seed
shapes. **Gotchas:** the 6 Square annotations have NO `/AP` appearance stream (3050/3056
do) — render them from geometry, not by replaying /AP, or they vanish; and Square `/Rect`
values are stored un-normalized (x0 > x1) — normalize first.

## Warnings / what NOT to re-derive
- Don't re-investigate the EmbedPDF overlay on the *test fixture* — it's provably pinned
  there. The bug is real-file + rotation. Test with the real file.
- The `IsaiahCalvo/Walkthrough` repo IS real (private) and is **already cloned locally
  at `/Users/isaiahcalvo/Projects/Walkthru`** — read it there, do NOT re-clone, and do
  NOT trust an unauthenticated existence check (it 404s and misled me this session). It's
  the authoritative reference for all three tasks; the study doc summarizes it but read
  the repo's `apps/web/src/components/viewer/pdf-renderer.tsx`,
  `.../viewer/pin-layer/pin-coords.ts`, `.../dev/embedpdf-prototype.tsx`, and
  `packages/shared/src/coords.ts` directly.
- Keep changes inside `src/prototype/` — this is throwaway and must not touch the real
  viewer (`PDFViewer.jsx`) or the v2.0 invariants.
- Run `npm run build` + `npm test` after changes (baseline 840/0/6). Direct-to-main; don't
  push without Isaiah's say-so.

## Resume
1. Read the two `.planning/spike-*.md` docs + `src/prototype/NOTES.md`.
2. Open `…:5199/?spike=renderer`, load the real file on BOTH arms, reproduce the rotated-page
   mis-orientation + annotation drift (use the Save-log button to capture a baseline).
3. Fix orientation first (task 1) on both arms — that likely fixes most of task 2 — then
   verify the overlay basis on rotated pages, then build annotation import (task 3).
