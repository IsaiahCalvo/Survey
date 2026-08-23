# Page-rotate remapped `mtr` after 180 (two CWs) — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.**  
Did **not** invent a lease, plus-alias, or `file.id`. Did **not** invent a 180 menu item.

Named remapped-page `mtr` was CW (`e2e-page-rotate-remap-resize`) + CCW (`e2e-page-rotate-remap-mtr-ccw`). Object-180 after CW (`page-rotate-remap-mtr-180`) is a **landscape leftover**, not this path. This leftover is **page 180** (two live CWs) on leftover-portrait viewBox `0 0 612 792`.

Distinct from leftover-18 / X-01 / CW/CCW handle catalogs / remapper persist (not replayed).

## Live proof

`?testPdf=clickable-link-test.pdf` · Playwright `e2e-page-rotate-remap-mtr-180-page.spec.mjs` **2 / 2**.

| Step | Result |
|---|---|
| Fresh editor | invents **0**; viewBox `0 0 612 792`; `file.id` **null** |
| Rect `174caae7-…` | center **183.60, 277.20** angle **0** |
| Two CWs (no 180 button) | viewBox stays **`0 0 612 792`**; center **428.40, 514.80**; angle **180** |
| `mtr` free-drag | angle **180 → 225**; size held **120.4 × 140.56**; knob on-page (`requireOnPage` + CTM) |
| Undo | restores angle **180**, not invert `/Rotate`; viewBox held |
| Empty two-CW | invents **0** |
| 390 | viewBox + `file.id` null |
| hubPreview | Draw **0** |

Post-`mtr` Fabric `left`/`top` near **0** (`cx 60.2, cy 70.28`) is the known 180 origin-flip class already handled by `displayedBoxOrigin`. Overlay stem stayed on-page. No new `placeRotationHandle` edit.

Extra `br` grow after 180 was attempted then dropped — named leftover is `mtr`; CW `br` is already `e2e-page-rotate-remap-resize`.

## Node

`tests/pageRotateRemapMtr180Page.test.mjs` — remapper `delta: 180` on 612×792; `placeRotationHandle` + clamp stay on leftover portrait at remapped 180; spec contracts. **3 / 3**.

## Product

No product edit. High-risk files untouched. Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk change). `graphify` CLI **absent**.

## Next leftover

Leftover-18 live hosts (first **X-01**). Goal stays **OPEN**.
