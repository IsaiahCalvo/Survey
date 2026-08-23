# Page-rotate remapped-page `mtr` at object 180 after CW — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0. Did **not** replay remappers, create-after-rotate, bbox clamp happy path, or first CW/`mt` clip as the leftover.

Parked leftover after remapped-page `mtr` 90→180: Shift+45 / further `mtr` was not cheap (`mtr` screen box x **−516**). `placeRotationHandle` + `clampHandleToPage` already keep the **world** 180° stem on the 612 page. The knob was still unhittable because overlay pivot used Fabric's 180° around-origin flip.

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_EMAIL` / `PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| `FILE_ID` / `VITE_DEV_AUTO_LOGIN_FILE_ID` / `LEASE_TOKEN` | **absent** |
| Coordinator lease for this task (`scripts/test-account-lease.mjs assign`) | **none** (stale `/tmp` KAL-500 tree has no `FILE_ID`) |
| `.bot-credentials.json` | **none** |

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write on the personal-like `.env.local` identity. Did **not** write another X-01 receipt.

## Product

After remapped-page `mtr` 90→180:

- Store `data.left/top` stays remapped: **648.17 / −8.41**.
- Fabric `left/top` becomes the 180° around-origin flip: **−648.17 / 8.41**.
- `displayedBoxOrigin` used to prefer remapped data only when Fabric left was **0**. Non-zero flipped Fabric won.
- Overlay became `rotate(180, −580.46, 84.53)` and the knob sat at screen x **≈ −528**, `elementFromPoint` miss.

World stem math was already on-page on the **+y (180°) ray**. Playwright `boundingBox` can still lie. Do **not** flip the stem to the opposite side — that jumps rotate math by 180.

Min-viable (`9a27f106`):

- `displayedBoxOrigin()` in `src/utils/svgBoundingBox.js` — also prefer remapped `data.left/top` when Fabric origin is a 180° around-origin flip (`own ≈ −data`, `|data| > 1`, `|own + data| < 1.5`).
- No second clamp. No side-flip. High-risk files untouched.

Harness: e2e `geom()` / `pickOrigin` now uses the same 0-placeholder **or** origin-flip pick so `onPage(postFurther)` does not report the flipped Fabric origin after a further rotate.

CORS `*` / `zoomGeneration` / SVG viewBox zoom / container-aware canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened.

## Live-proved

Playwright `e2e-page-rotate-remap-resize.spec.mjs` **4 / 4 (17.3s)** on Vite `http://127.0.0.1:5301`. Focused Node `pageRotateRemapResize` **24 / 24** + leftover18 **12 / 12**.

`?testPdf=clickable-link-test.pdf`. After CW: `viewBox` **`0 0 792 612`**. `file.id` null.

Desktop rect `06096af0-…` create then pre-rotate `br` **135.42 × 152.24**. CW maps center **715.88, 67.71**; angle **90**; left **648.17**. Setup `mtr` **90 → 180.00°**. At 180:

| Probe | Value |
|---|---|
| Overlay pivot | `rotate(180, 715.88, 67.71)` — on-page, not −580 |
| Local `mtr` | **(715.88, −44.41)** |
| CTM screen | **(1128.77, 327.25)**; `dxRight` **97.28** |
| Hit | `elementFromPoint` **circle / mtr** |
| Store | `dataLeft` **648.17**; Fabric `rawLeft` **−648.17** (flip ignored) |

Further free-drag **180 → 224.9999°** (same +y-side ray; size held). Toolbar Undo restores **180**; viewBox stays **`0 0 792 612`**. Shift+45 after 180 is now also cheap in the sibling remapped `br`/`mtr` test (not a second leftover). 390 Pages rotate not cheap; edge is viewBox + `file.id` + 0 marks.

### Intended — **pass** (`mtr` at object 180)

| Slice | Evidence |
|---|---|
| Knob on remapped page | `MTR_180_PROBE` CTM on-page; `dxRight` **97.28**. |
| Hit | `circle` / `mtr` (CTM + expectedScreen). |
| Overlay pivot | **715.88, 67.71** (not −580). |
| Further drag | **180 → 225°**; vw/vh held **135.42 × 152.24**; on-page. |
| viewBox | **`0 0 792 612`** |

### Break — **pass** (undo last 180° `mtr`; no side-flip)

| Control | Input | Result |
|---|---|---|
| Undo last further rotate | Toolbar Undo | Angle **225 → 180**; viewBox **`0 0 792 612`**. |
| Side-flip stem | Would jump angle 180 | **Not done**; knob stayed on the +y ray. |
| Second clamp | World stem already on-page | **Not invented.** |

### Edge

| Slice | Evidence |
|---|---|
| viewBox after rotate / 180° `mtr` | **`0 0 792 612`** |
| `file.id` | `?testPdf=` **null** |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; user marks **0** |
| hubPreview | Draw **0** |

## Official / focused Node

Focused `pageRotateRemapResize` **24 / 24** + leftover18 **12 / 12**. Cap **8448** not loosened. Official `npm test` not re-run (no high-risk 34k-line edit; bbox helper + spec contract covered by focused tests).

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.
