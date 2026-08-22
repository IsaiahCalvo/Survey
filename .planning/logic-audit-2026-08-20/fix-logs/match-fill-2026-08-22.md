# Live C-06 leftover: Match Fill — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after UL-07 page number field (`31fcdb0c`). Prior C-06 was “desktop + mobile stroke tab” plus Cloud/poly catalog one-click at default opacity. P1-38 proved the selected ring ±1 — **not replayed**. C-01 grid / C-02 hex / C-03 opacity / C-04 spectrum already have dedicated intended+break+edge. The unique leftover is **opacity lock**: Match Fill writes fill color + fill opacity onto the border, sitting below the Border `minOpacity=1` slider. Distinct from leftover-18. Did **not** replay the 96 proved IDs. Did **not** invent flatten / stamp / Forms.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite via `debug/playwright.config.mjs` (`npm run dev:ui`) with process auto-login names cleared.

## Product

No product bug. Existing contracts held:

- CompactColorPicker Border first cell is `title="Match fill"` / `__match__`.
- `applyColorPickerSelection` snapshots `matchFillColor` + `matchFillOpacity` and may sit below Border `minOpacity=1`.
- AppShell one-visible rule keeps a side opaque when Match Fill runs against a transparent fill.
- 390 rect/ellipse Stroke takeover uses the same `kind: 'match'` firstPreset.

No high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / FabricEraserCanvas / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched.

## Live-proved

Playwright `e2e-match-fill.spec.mjs` **2 / 2 (10.5s)** on Vite `http://127.0.0.1:5173`. Focused Node `matchFill` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop Color → Fill `#00FFFF` @ **40** → Border `#FF0000` @ 100 → **Match fill**. Stroke becomes `#00FFFF` @ **0.4** (below the Border slider floor). 390 selected rect: same write after Stroke tab takeover.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Fill tab | catalog | Match fill **0** |
| Transparent fill then Match fill | one-visible | at least one side stays opaque |
| Later Fill `#00FF00` | after Match fill | stroke stays `#00FFFF` @ 0.4 (snapshot, not live bind) |
| Line | Color picker | Match fill **0** |
| Select empty / Pen | desktop | Match fill **0** |
| 390 chip sheet / Fill takeover | before Stroke | Match fill **0** |

### Edge

| Slice | Evidence |
|---|---|
| Isolation | second rect does not rewrite the first stroke |
| Undo | drops the Line; first stroke held |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Match fill **0**; Draw **0** |
| 390 | selected write `#00FFFF` @ 0.4 |

## Official / focused Node

No high-risk file. Official `npm test` not re-run. Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.
