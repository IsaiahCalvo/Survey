# Page rotate CCW + 180 (two CWs) — remap + persist — 2026-08-23

Named leftover after CW-only remapper + persist catalog (`7c0da542`). Existing proofs were clockwise-only. 180 is two live CWs — no dedicated 180 button. Named cloud save stays leftover-18 **X-01**. Did **not** stamp `file.id`. Did **not** replay the CW catalog.

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_*` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| Coordinator lease | **none** |
| `.bot-credentials.json` | **none** |

## Remount limit

Same as CW: remount reloads original fixture bytes. After reload: viewBox **`0 0 612 792`**. `pageTransformations` **null**. Local cache still holds remapped ids + coords. After 180 the live viewBox is also portrait, so remount is distinguished by remapped cache (not leftover identity), not by a swapped viewBox.

## Live-proved

Playwright `e2e-page-rotate-ccw-180.spec.mjs` **4 / 4 (26.6s)** on Vite `http://127.0.0.1:5198`. `file.id` null. Remapper contracts held — no product edit.

### CCW (`delta: -90` → 270)

viewBox **`0 0 792 612`**. Not leftover portrait.

| Type | Id | Created → CCW |
|---|---|---|
| Rect `0c113535-…` | **183.60, 277.20 → 277.20, 428.40** |
| Pen `9be8cd00-…` | **134.64, 237.60 → 237.60, 477.36** |
| Callout `callout-ab15e92a-…` | **329.28, 348.64 → 348.64, 282.72** |
| Counter `3f8bc6d6-…` | **171.36, 411.84 → 411.84, 440.64** (`pointerAngle` **225 → 135**) |
| Line `0f32bc59-…` | **110.16, 174.24 → 174.24, 501.84** |

### 180 (two CWs)

viewBox stays **`0 0 612 792`**. Objects remap (not identity). Double-CW ≡ 180.

| Type | Id | Created → 180 |
|---|---|---|
| Rect `c6835a77-…` | **183.60, 277.20 → 428.40, 514.80** |
| Pen `1646d371-…` | **134.64, 237.60 → 477.36, 554.40** |
| Callout `callout-c1a24b37-…` | **329.28, 348.64 → 282.72, 443.36** |
| Counter `bd5daeb5-…` | **171.36, 411.84 → 440.64, 380.16** (`pointerAngle` **225 → 45**) |
| Line `7b427e9c-…` | **110.16, 174.24 → 501.84, 617.76** |

Persist (local save/reload) after both: same ids + remapped cache. Wipe+reload invents **0**. Empty CCW / empty two-CW / cancel invent **0**. No invented 180 button. 390: viewBox + `file.id`. hubPreview Draw **0**.

## Official / focused Node

Focused `pageRotateCcw180` + leftover18 **22 / 22**. Cap **8448** / 75/250 not loosened. No high-risk edit. `graphify` CLI absent.

## Leftover-18

Still parked. Goal stays OPEN.
