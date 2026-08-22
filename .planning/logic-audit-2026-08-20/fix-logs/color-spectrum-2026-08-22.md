# Live C-04 leftover: Color spectrum HSV — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after D-03 / D-04 Eraser type (`6234f7c6`). Prior C-04 only sampled aria valuetext / leave-reenter. C-01 grid, C-02 hex, and C-03 opacity already have dedicated intended+break+edge. Spectrum never wrote a selected / next-draw fill. Not leftover-18. Did **not** replay the 96 proved IDs. Did **not** invent flatten / stamp / Forms.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite via `debug/playwright.config.mjs` (`npm run dev:ui`) with process auto-login names cleared.

## Product

Min-viable in `src/components/CompactColorPicker.jsx` color-prop HSV sync:

- `hexToHsv('#FF0000')` is 0°. Keyboard End sets hue 360 (same hex).
- The parent color round-trip used to snap 360 → 0, so ArrowRight looked like a wrap (360 → 1).
- Keep End-key 360 when the incoming hex is still 0°.

Not a high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / FabricEraserCanvas untouched.

CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched.

## Live-proved

Playwright `e2e-color-spectrum.spec.mjs` **2 / 2 (47.7s)** on Vite `http://127.0.0.1:5173`. Focused Node `colorSpectrum` + leftover18 **16 / 16**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop Color → Color spectrum. Hue 120 writes green (`#00FF00` / live `#01FF00` from rounded `aria-valuenow`). SV out-of-bounds left-top writes `#FFFFFF`; right-top restores `#FF0000`. 390 takeover spectrum; next-draw stamps green.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Hue Home / ArrowLeft | at 0 | stays 0 |
| Hue End / ArrowRight | at 360 | stays 360 (no wrap) |
| SV Home / ArrowLeft | sat 0 | stays 0; unused `x` / Enter no-op |
| Select empty click | invents **0** | Color spectrum **0** |
| Pen | arm Pen | Color spectrum **0** |
| 390 chip sheet | before takeover | spectrum **0** |

### Edge

| Slice | Evidence |
|---|---|
| Isolation | next rect is not spectrum-green |
| Undo | drops the isolation rect; green stays |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Color spectrum **0**; Draw **0** |
| 390 | next-draw green; Pen hide; pages overlay closed before create |

## Official / focused Node

No high-risk file. Official `npm test` not re-run. Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.
