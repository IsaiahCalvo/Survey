# Export / print scale leftovers — polyline/polygon + circle

**Date:** 2026-08-21  
**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Goal:** stays open

Did **not** retry leftover 18. No prod SQL. No budget loosen. No secrets.  
Did **not** invent an ink print-flatten affine refactor.

Read `fix-logs/export-flatten-siblings.md` and P1-04 receipts
(`.planning/logic-audit-2026-08-20/FIX-LOG.md` remaining risk;
`COMPLETION-AUDIT.md` P1-04 width/height multiply).

## Verdicts

| Item | Verdict | Why |
|---|---|---|
| Polyline / polygon **move** (`left+point.x`) | **Already correct** | Importer `toRelativeFabricPoints` is min-relative; `pathOffset` typically 0. Scale=1 export/print unchanged. |
| Polyline / polygon **scale** | **Real remaining product bug** — **fixed** | Resize (`useSVGInteraction` points-shape commit) writes `scaleX`/`scaleY` and leaves `points` unbaked. Screen (`renderPolygon` / `getPointsBBox`) uses `left + scaleX*point.x`. Export + print wrote raw vertices. |
| Circle **export** scale | **Real remaining product bug** — **fixed** | P1-04 remaining risk: `createCircleAnnotation` used raw `radius`. Screen (`renderEllipse`) uses `radius*\|scaleX\|` / `radius*\|scaleY\|`. Importer stores axis-aligned ovals as `radius=min/2` + `scaleX`/`scaleY`. Individual resize commits `scaleX`/`scaleY` (does not bake radius). Counter metadata already scaled; `/Rect` did not. |
| Circle **print** flatten scale | **Real leftover of the same P1-04 hole** — **fixed** | P1-04 multiplied `width*\|scaleX\|` for rects and claimed print was done. The circle/ellipse branch preferred raw `radius`/`rx`/`ry`, so the scaled-width fallback never ran. |
| Ink print flatten raw path | **Not invented** | Different class (no `x1`/`left+x1`, no radius/vertices scale). Affine already applied on ink **export**. No user-visible export/print miss confirmed this pass. |

High-risk files **not** edited. Invariants held: `zoomGeneration`, SVG `viewBox`, container-aware canvas sizing, single-name `fontFamily`, CORS `*`.

## Min-diff (`src/utils/pdfAnnotationsPdfLib.js`)

- `createCircleAnnotation`: `/Rect` = `radius * \|scaleX\|` × `radius * \|scaleY\|`. Skip non-finite / non-positive box. Counter AP still uses circular `radius = raw*scaleX` (same as `renderCounter` / `serializePdfCounterMetadata`).
- `polygonWorldPoint`: `left + \|scaleX\|*point.x` (same for y). Used by polygon/polyline export and `drawFlattenedPolygon`.
- `drawFlattenedObject` circle/ellipse: `rx`/`radius` × `scaleX`, `ry`/`radius` × `scaleY`. Does not reuse already-scaled `width`/`height` as a radius fallback.

`pathOffset` not folded in (product path is min-relative / 0; sibling hunt already accepted move). Polygon `angle` not invented.

## Intended / break / edge

`node --test tests/exportScaleLeftovers.test.mjs tests/printFlattenOnPage.test.mjs tests/lineArrowEndingExport.test.mjs tests/legacyArrowGroupExportPosition.test.mjs` → **23 / 23**

- **Intended (circle export):** radius 10 at `(20,30)` `scale=2` → `/Rect [20, 130, 60, 170]` on a 200pt page (screen diameter 40).
- **Break (circle):** unscaled `/Rect [20, 150, 40, 170]` is not written.
- **Edge (circle):** scale default 1 unchanged; imported oval `radius=10 scaleX=2 scaleY=1` → `/Rect` 40×20.
- **Intended (polygon export+print):** `left=10 top=20` points `(0,0)(20,0)(20,10)` `scale=2` → world `(10,20)(50,20)(50,40)`.
- **Break (polygon):** `left+point.x` vertices are not written when `scaleX=2`.
- **Edge (polyline):** scale 1 stays `left+point.x`; `scaleX=2 scaleY=3` stretches independently.
- **Intended (circle print):** flattened ellipse device span ≈ 40pt, not 20pt.

## Leftover 18 — unchanged

Not replayed. Still open: `X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

Crossing-cuts allocation leftover unchanged. Cap not loosened.

## Goal

Stays **open**.
