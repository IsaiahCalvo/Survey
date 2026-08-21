# Flatten affine remaining hunt — text/textbox scale

**Date:** 2026-08-21  
**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Product commit:** `99478f57`  
**Goal:** stays open

Did **not** replay line `getLineEndpoints`, legacy arrow-group double-offset, polygon/circle scale, or ink print affine.  
Did **not** replay leftover 18. No prod SQL. No budget loosen (8448 / 75/250). No secrets.  
Did **not** invent a flatten rewrite, text `angle`, polygon `pathOffset`, or image/stamp writers.

## Miss found + fixed (1)

**`createFreeTextAnnotation` / `drawFlattenedText` in `src/utils/pdfAnnotationsPdfLib.js`**

Screen (`renderText`) sizes the box as `width*|scaleX|` × `height*|scaleY|` and leaves `fontSize` unscaled. Individual SVG resize and `buildExistingTextCommitJSON` bake scale to 1. **Group-resize** (mixed selection) writes `scaleX`/`scaleY` and leaves `width`/`height` unbaked — same P1-04-family hole as polygon vertices / circle radius.

Export wrote raw `width`/`height` as `/Rect`. Print wrapped at raw `width`. After a group-resize `scaleX=2` a 40×16 box still exported as `[10, 164, 50, 180]` on a 200pt page instead of `[10, 148, 90, 180]`.

**Min-diff:** multiply export `/Rect` and print wrap/`height` by `|scaleX|` / `|scaleY|`. `fontSize` unchanged (matches `renderText`). `angle` not invented.

High-risk files **not** edited (`PDFViewer.jsx`, PAL, FabricEraser, SVG layer, `viewerShared.js`, `package.json`, `vite.config.js`).

Invariants held: container-aware canvas sizing, SVG `viewBox` zoom, `zoomGeneration`, single-name `fontFamily`, CORS `Access-Control-Allow-Origin: '*'`.

### Intended / break / edge

`node --test tests/textFlattenAffineScale.test.mjs tests/printMultilineDecoration.test.mjs tests/pdfAnnotationTextStyleAndArrowExport.test.mjs tests/exportScaleLeftovers.test.mjs` → **22 / 22**

- **Intended (export):** textbox `left=10 top=20 width=40 height=16 scale=2` → `/Rect [10, 148, 90, 180]`
- **Break (export):** unscaled `/Rect [10, 164, 50, 180]` is not written
- **Edge (export):** scale default 1 unchanged; `scaleX=2 scaleY=3` → 80×48
- **Intended (print):** `AAAA BBBB` at `width=40 scaleX=2` wraps as **1** `Tj` (box 80)
- **Break (print):** same string at raw `width=40` is **≥2** `Tj`; scaled count ≠ raw count

## Other writers checked — not this class

| Writer | After move/scale/rotate | Verdict |
|---|---|---|
| Line / arrow (`createLineAnnotation`, `drawFlattenedLine`) | `getLineEndpoints` | Already fixed; not replayed |
| Legacy arrow group mapper | World `x1..y2`, bbox zeroed | Already fixed; not replayed |
| Polygon / polyline / circle / ellipse | `polygonWorldPoint` / radius×scale / `/AP` matrix | Already fixed; not replayed |
| Ink export + print flatten | `createInkPageTransform` | Already fixed; not replayed |
| Filled paper ink / highlighter path | Same ink affine | Already applied; no leftover of this class |
| Square / cloud rect | `width*\|scaleX\|` | Already scaled (P1-04) |
| Imported Highlight / Text note / Caret | `width*\|scaleX\|` | Already scaled |
| Survey-marker `createHighlightAnnotation` | Raw bounds | Survey markers **excluded** from export + regular print. Not a product path. |
| Counters | `radius*\|scaleX\|`; group/individual bake to 1 | Already scaled |
| Callout leaders + text box | World / normalized page fractions, no fabric scale | Not this class |
| Image / stamp | No SVG renderer, not in `EXPORTABLE_FABRIC_TYPES`, no flatten branch | Unsupported type, not an affine miss. Not invented. |
| Measurement | No annotation type in these writers | None |
| Mixed fabric `group` print | Offsets child `left`/`top` only | Children keep own scale; text children now honor it |
| Text / rect / polygon **angle** | Screen rotates; writers axis-align | Same leftover as prior polygon-angle call. **Not invented.** |
| `pdfNativeExport/adapters/freeText.js` (and siblings) | Raw width, no scale | Flag-off / not wired into live export. Not invented. |

## Leftover 18 — unchanged

Not replayed. Still open: `X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

Crossing-cuts allocation leftover unchanged. Cap not loosened.

## Goal

Stays **open**.
