# 390 Text color chips every hex — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after Fill sheet. Distinct from `e2e-mobile-annotation-colors` (Fill chips → next armed rect) and from desktop CompactColorPicker every-swatch (`e2e-pickers-every-swatch`). P-02 harness never clicked these chips. Not leftover-18.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright used Vite `127.0.0.1:5201` with auto-login names cleared.

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| 390 Fill sheet every chip | Next armed **rect fill**. 0 `Set Text color` clicks. |
| Pickers every swatch | Desktop CompactColorPicker 16 + fonts/format. Not the 390 9-chip Text sheet. |
| P-02 mobile text formatting | Harness fonts / B/I/U/S / align / CompactColorPicker open. **0** Text color chip clicks. |
| T-07 Font color | Desktop opaque picker (no transparent). Not 390 chips. |

Catalog (not `COLOR_PICKER_PRESETS`): `#ff0000` `#4A90E2` `#27C07D` `#F4D35E` `#ffffff` `#1e293b` `#C7A7FF` `#FF8A3D` `#000000`. Five of nine are not desktop presets.

## Live-proved

Playwright `e2e-mobile-text-colors.spec.mjs` **1 / 1 (17.5s)** on Vite `http://127.0.0.1:5201` (`npm run dev:ui`, auto-login cleared). Node `mobileAnnotationColors` **4 / 4**.

`viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Each chip then a new textbox stored that fill / fontColor:

| Chip | Stored | id prefix |
|---|---|---|
| `#ff0000` | `#FF0000` | `549acacf-…` |
| `#4A90E2` | `#4A90E2` | `37697751-…` |
| `#27C07D` | `#27C07D` | `555615f9-…` |
| `#F4D35E` | `#F4D35E` | `98083fb6-…` |
| `#ffffff` | `#FFFFFF` | `cc154430-…` |
| `#1e293b` | `#1E293B` | `37c4fd50-…` |
| `#C7A7FF` | `#C7A7FF` | `6e8fbd11-…` |
| `#FF8A3D` | `#FF8A3D` | `6dc5780d-…` |
| `#000000` | `#000000` | `ffd08a12-…` |

### Break — **pass**

| Slice | Evidence |
|---|---|
| Desktop 1440 | All 9 `Set Text color …` counts **0**. |
| hubPreview | Chip **0**; Draw **0**. |
| Select / empty click | Did not invent another textbox. |
| Named / 4-digit hex on CompactColorPicker | Kept `#0000FF` preference. |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| CompactColorPicker large swatch | Next text `5aa089aa-…` fill `#0000FF`. First chip text stayed `#FF0000`. |
| Undo | CompactColorPicker text gone; `#000000` chip text stayed. |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout. |

## Product

No product bug. Chips already write `updateTextDefaults({ fontColor })`; mobile `TextEditOverlay` already uses `newTextStyle.fontColor` as fill. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. High-risk files not edited.

## Official / focused Node

Focused `mobileAnnotationColors` **4 / 4**. Cap **8448** not loosened. Official `npm test` not re-run (no high-risk edit; standing isolated 8448 fail-stop unchanged).

## Next leftover

Named next reachable picker slice: **Highlighter every-swatch**, then **live C-02 hex lengths**. Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.
