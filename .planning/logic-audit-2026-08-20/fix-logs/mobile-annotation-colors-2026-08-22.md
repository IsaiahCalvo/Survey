# 390 MOBILE_ANNOTATION_COLORS every chip — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Fidelity audit after local save / export-reimport. First incomplete reachable picker vs the objective: the 390 sheet chip catalog `MOBILE_ANNOTATION_COLORS` (9 hexes). Desktop CompactColorPicker every-swatch (`e2e-pickers-every-swatch`) never opened these chips. P-02 harness never clicked them. Not leftover-18.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | PRESENT | not written | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | PRESENT | not written | no |
| `SUPABASE_SERVICE_ROLE_KEY` | PRESENT | not written | no |

Cursor environment still **null**. Did **not** invent values, write `.env.local`, or run X-01 live. Playwright used Vite `127.0.0.1:5199` with auto-login names cleared.

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| Pickers every swatch | Desktop CompactColorPicker 16 + fonts/format. Not the 390 9-chip sheet. |
| P-02 mobile text formatting | Harness fonts / B/I/U/S / align / CompactColorPicker open. **0** `MOBILE_ANNOTATION_COLORS` clicks. |
| C-05 fill vs stroke vs font | Desktop counter number + armed vs selection. Not 390 chips. |

Catalog (not `COLOR_PICKER_PRESETS`): `#ff0000` `#4A90E2` `#27C07D` `#F4D35E` `#ffffff` `#1e293b` `#C7A7FF` `#FF8A3D` `#000000`. Five of nine are not desktop presets.

## Live-proved

Playwright `e2e-mobile-annotation-colors.spec.mjs` **1 / 1 (13.3s)** on Vite `http://127.0.0.1:5199` (`npm run dev:ui`, auto-login cleared). Node `mobileAnnotationColors` **3 / 3**.

`viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Each chip then a new rect stored that fill:

| Chip | Stored | id prefix |
|---|---|---|
| `#ff0000` | `#FF0000` | `a2731db0-…` |
| `#4A90E2` | `#4A90E2` | `eb68d03e-…` |
| `#27C07D` | `#27C07D` | `bef80458-…` |
| `#F4D35E` | `#F4D35E` | `cbc10349-…` |
| `#ffffff` | `#FFFFFF` | `8d45ef5f-…` |
| `#1e293b` | `#1E293B` | `7ff45298-…` |
| `#C7A7FF` | `#C7A7FF` | `55dac295-…` |
| `#FF8A3D` | `#FF8A3D` | `d4e396fd-…` |
| `#000000` | `#000000` | `3b8f5dab-…` |

### Break — **pass**

| Slice | Evidence |
|---|---|
| Desktop 1440 | All 9 `Set Fill color …` counts **0**. |
| hubPreview | Chip **0**; Draw **0**. |
| Select / empty click | Did not invent another rect. |
| Named / 4-digit hex on CompactColorPicker | Kept `#0000FF` preference. |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| CompactColorPicker large swatch | Next rect `0ab0ab93-…` fill `#0000FF`. First chip rect stayed `#FF0000`. |
| Undo | CompactColorPicker rect gone; `#000000` chip rect stayed. |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout. |

## Product

Default fill opacity is **0**. 390 chips sent hex only, so the next rect stayed `TRANSPARENT`. Min-viable in `MobilePdfViewerChrome.jsx` `applyShapeColor`: a solid chip restores fill/stroke opacity **100** (same restore CompactColorPicker already does). Not a high-risk file. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched.

## Official / focused Node

Focused `mobileAnnotationColors` **3 / 3**. Cap **8448** not loosened. Official `npm test` not re-run (no high-risk edit; standing isolated 8448 fail-stop unchanged).

## Next leftover

Leftover-18 live hosts. First named: **X-01** (names now present in process env; still need `.env.local` + coordinator lease + real `file.id`; do not invent). Other reachable picker/format slices still thinner than the objective (Highlighter every-swatch, live C-02 hex lengths, Line/Arrow desktop every-swatch). Leftover **18** stay parked. Goal stays open.
