# Live C-02 hex lengths — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after Highlighter every-swatch. Distinct from C-01 swatch catalogs, 390 Fill / Text chips, Highlighter every-swatch, and the thin 6-digit + `ZZZZZZ` checks in `e2e-pickers-every-swatch` / `e2e-adversarial-repass`. Not leftover-18.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright used Vite `127.0.0.1:5213` with auto-login names cleared.

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| C-02 **pass** / Node `normalizeHexColor` | Catalog only. Live hex field typed `00FF00` / `ABCDEF` + `ZZZZZZ` / `not-a-color` / empty. |
| Highlighter / 390 chip CompactColorPicker | Named `red` + 4-digit `#FF00` keep as a side check. No 3/5/6/7/8 matrix. |

FEATURE-MATRIX C-02 intended: `#rgb` / `#rrggbb` / bare. Break/edge: invalid, rgba(), named, 4/5/7/8 digit.

## Live-proved

Playwright `e2e-hex-lengths.spec.mjs` **2 / 2 (12.7s)** on Vite `http://127.0.0.1:5213` (`npm run dev:ui`, auto-login cleared). Focused Node `hexLengths` + `annotationStyleCatalog` **17 / 17**.

`viewBox="0 0 612 792"`. `file.id` null. Rect `7eccc421-…`.

### Intended — **pass**

Desktop CompactColorPicker Fill hex on a selected rect:

| Typed | Stored | Kind |
|---|---|---|
| `f00` | `#FF0000` | 3-digit bare |
| `#0f0` | `#00FF00` | 3-digit hash |
| `0000FF` | `#0000FF` | 6-digit bare |
| `#FF8000` | `#FF8000` | 6-digit hash |
| `abc` | `#AABBCC` | 3-digit mixed |

Font-color site: `0f0` → overlay `#00FF00`. 390 large-swatch opener: `f00` then next rect `fb913ef7-…` fill `#FF0000`.

### Break — **pass**

Desktop kept last valid `#AABBCC` (then later `#0000FF` / `#FF00FF` after edge) for:

named `red` / `blue` · `rgba(255,0,0,1)` · `rgb(0, 128, 0)` · 4-digit `FF00` / `#F0F0` · 5-digit `12345` / `#12345` · 7-digit `1234567` · 8-digit `FF0000FF` / `#AABBCCDD` · `zzzzzz` · empty · `transparent` · `##FF0000`.

Font-color 4-digit `FF00` kept `#00FF00`. 390 chip sheet has **0** hex fields until `Open fill color picker`. hubPreview Hex color **0** / Draw **0**. Desktop `Open fill color picker` **0**. Select / empty invents 0.

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Whitespace `  00f  ` | `#0000FF` |
| After `not-a-color`, `f0f` | `#FF00FF` |
| Isolation rect | `93df4df9-…` did not inherit magenta |
| Undo | Isolation rect gone; hex-patched fill stayed `#FF00FF` |
| 390 invalid local display | Field shows `red` / `FF0000FF`; next rect still `#FF0000` |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout. |

## Product

No product change. Hex field already applies only when `normalizeHexColor(val)` succeeds (`CompactColorPicker.jsx`). Invalid typed text stays local (`setLocalHex`) and does not patch. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched.

## Official / focused Node

Focused `hexLengths` + `annotationStyleCatalog` **17 / 17**. Cap **8448** not loosened. Did **not** run official `npm test` (no high-risk file). Did **not** loosen leftover-18 or invent a lease.

## Next leftover

Named next reachable picker slice: **Line/Arrow desktop every-swatch**. Fonts / B/I/U/S / sizes / align / resize / rotation already every-value on `e2e-pickers-every-swatch`. Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.
