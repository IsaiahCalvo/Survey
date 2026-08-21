# Export / flatten sibling hunt — Wave 8 `getLineEndpoints`

**Date:** 2026-08-21  
**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Goal:** stays open

Did **not** replay wave8 happy path as the only sibling proof.  
Did **not** retry leftover 18. No prod SQL. No budget loosen. No secrets.

## Sibling found + fixed (1)

**`legacyArrowGroupToLine` in `src/utils/pdfAnnotationsPdfLib.js`**

Wave 8 made `createLineAnnotation` / `drawFlattenedLine` use `getLineEndpoints` (`left+width/2 + x1`). The live export mapper still folded group `left`/`top` into `x1..y2` **and** spread the group bbox (`left: 20`). `getLineEndpoints` then added `left` again.

Pre-fix proof (Node, not the wave8 spec):

| | world | `/L` on 200pt page |
|---|---|---|
| **Intended** | `(20,30)→(70,70)` | `[20, 170, 70, 130]` |
| **Actual (miss)** | `(40,60)→(90,100)` | `[40, 140, 90, 100]` |

That is `left+x1` twice — the Wave 8 sibling, not a double-offset of a fabric-packed line.

**Min-diff:** after folding group origin into world `x1..y2`, zero `left`/`top`/`width`/`height` so `getLineEndpoints` is a no-op. Same contract FIX-LOG P1-01 already named. Callout leaders (world `x1..y2`, no bbox) unchanged.

Print flatten of groups was already correct (P1-01 offsets only child `left`/`top`). This miss is the **export** mapper only.

### Intended / break / edge

`node --test tests/legacyArrowGroupExportPosition.test.mjs tests/pdfAnnotationTextStyleAndArrowExport.test.mjs tests/lineArrowEndingExport.test.mjs tests/calloutArrowheadExport.test.mjs` → **24 / 24**

- **Intended:** export `/L` = world `(20,30)→(70,70)`
- **Break:** mapped bbox is `0`; `getLineEndpoints(mapped)` ≠ `{...mapped, left:20}` double-offset
- **Edge:** source group `width`/`height` does not shift `/L`; callout-style world `x1` stays a no-op

High-risk files **not** edited. Invariants held: `zoomGeneration`, SVG `viewBox`, container-aware canvas sizing, single-name `fontFamily`, CORS `*`.

## Other writers checked — not this class

| Writer | After move/group/scale | Verdict |
|---|---|---|
| Modern line / arrow (`createLineAnnotation`, `drawFlattenedLine`) | Wave 8 `getLineEndpoints` | Already fixed; not replayed as sole proof |
| Callout leaders | World `x1..y2`, no `left`/`width` | Correct no-op |
| Group print flatten | Offset only child `left`/`top` | P1-01 already correct |
| Polyline / polygon export + print | `left + point.x` | **Correct after move** (importer points are min-relative, `pathOffset` typically 0). **Scale** is a P1-04-family size miss (`scaleX=2` still writes unscaled vertices) — not center-relative `x1`/`left+x1`. Not invented here. |
| Rect / cloud Square | `left/top` + `width*scaleX` | Already scaled (P1-04) |
| Ellipse export | `rx/ry * scale` + `/AP` matrix | Already scaled |
| Circle export | `radius` **not** × `scaleX` | Documented P1-04 remaining risk; not `x1`/`y1` |
| Ink export | `createInkPageTransform` | Affine applied once (`tests/pdfInkAffineExport.test.mjs`) |
| Ink print flatten | raw `path` commands | Affine not applied; different class (not `x1`/`y1`). Not invented here. |
| Highlight / imported markup | `left/top` + scaled `width` on imported path | Not center-relative `x1` |
| `pdfNativeExport/adapters/line.js` `adaptLine` | raw `x1..y2` | Same Wave 8 bug **but flag-off / not wired into live export**. Not a product path. Not invented. |

## Leftover 18 — unchanged

Not replayed. Still open: `X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

Crossing-cuts allocation leftover unchanged. Cap not loosened.

## Goal

Stays **open**.
