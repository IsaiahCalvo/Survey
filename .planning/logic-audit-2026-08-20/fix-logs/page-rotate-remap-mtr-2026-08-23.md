# Page-rotate remapped-page canvas `mtr` — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0. Did **not** replay remapped `br`.

Prior remapped-page pass proved `br` after CW rotate (`viewBox` `0 0 792 612`, angle 90) and **skipped** `mtr` because the drag left angle at 90. That was a product bug, not a bad-only harness.

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_EMAIL` / `PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| `FILE_ID` / `VITE_DEV_AUTO_LOGIN_FILE_ID` / `LEASE_TOKEN` | **absent** |
| Coordinator lease (`scripts/test-account-lease.mjs assign`) | **none** |
| `.bot-credentials.json` | **none** |

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write on the personal-like `.env.local` identity. Did **not** write another X-01 receipt.

## Product

After CW remap the rect sits on the new right edge (`cx` **715.88** on a 792-wide page). `SVGSelectionOverlay` rotates the stem with the object, so at 90° local-top becomes world-right and the knob went past `viewBox` `0 0 792 612`. The layer uses `overflow: hidden`, so the hit never started (prior skip). Absolute rotate math must keep the knob on that same 90° ray — flipping to the opposite side would jump angle by 180 on pointerdown.

Min-viable:

- `placeRotationHandle()` in `src/utils/svgBoundingBox.js` — shorten the stem along the same ray so the knob stays inside the page (16-unit inset).
- `displayedAngle()` — same 0-placeholder pick as `displayedBoxOrigin` for remapped `data.angle`.
- `SVGSelectionOverlay` + `SVGAnnotationLayer` pass `pageWidth` / `pageHeight` (high-risk layer; two props only).
- Rotate commit writes `data.angle` like remapped `left`/`top`.
- `useSVGInteraction` captures pointer on the SVG root so the first `visualTransform` remount does not drop `setPointerCapture`.

CORS `*` / `zoomGeneration` / SVG viewBox zoom / container-aware canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened.

## Live-proved

Playwright `e2e-page-rotate-remap-resize.spec.mjs` **2 / 2 (10.7s)** on Vite `http://127.0.0.1:5296`. Focused Node `pageRotateRemapResize` + leftover18 + `annotationRotate` **22 / 22**.

`?testPdf=clickable-link-test.pdf`. After CW: `viewBox` **`0 0 792 612`**. `file.id` null.

Desktop rect `8a98e621-…` create **120.4** then pre-rotate `br` **135.42 × 152.24**. CW maps center **67.71, 76.12 → 715.88, 67.71**; angle **90**; left **648.17**. Post-rotate `br` **141.27 × 158.82** (not replayed as the leftover; held from prior pass). `mtr` knob on-page (`dxRight` **20.45**). Free-drag **90 → 180.00°**; size held. Shift+45 not cheap after 180 (stem off-page at **x −516**). Undo last rotate restores **90**; viewBox stays **`0 0 792 612`**. 390 Pages rotate not cheap; edge is viewBox + `file.id` + 0 marks.

### Intended — **pass** (`mtr` 180)

| Slice | Evidence |
|---|---|
| Knob on remapped page | `MTR_HIT` `circle` / `mtr`; `dxRight` **20.45**. |
| Free-drag | **90 → 180.00°**; vw/vh held **141.27 × 158.82**; on-page. |
| viewBox | **`0 0 792 612`** |

### Break — **pass** (undo last rotate; Shift+45 not applicable after 180)

| Control | Input | Result |
|---|---|---|
| Undo last remapped `mtr` | Toolbar Undo (2 steps; re-select no-op first) | Angle **180 → 90**; viewBox **`0 0 792 612`**. |
| Shift+45 | After 180 the stem is off-page | **Not applicable** in this harness (`SHIFT_MTR_SKIP`). |
| Collapse / flip | Same as prior remapped `br` | **Not applicable** at 90° inward/flip. |

### Edge

| Slice | Evidence |
|---|---|
| viewBox after rotate / remapped `mtr` | **`0 0 792 612`** |
| `file.id` | `?testPdf=` **null** |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; user marks **0** |
| hubPreview | Draw **0** |

## Official / focused Node

Focused `pageRotateRemapResize` + leftover18 + `annotationRotate` **22 / 22**. Cap **8448** not loosened. Official `npm test` not re-run (high-risk layer was a two-prop pass-through only; hook + bbox helpers covered by focused tests).

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.
