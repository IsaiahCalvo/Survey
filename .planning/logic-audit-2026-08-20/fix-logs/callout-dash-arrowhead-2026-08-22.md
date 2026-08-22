# Live Callout dash + arrowhead every discrete style — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after Line/Arrow dash + arrowhead. Distinct from UL-33 catalog smoke, S-04 selected-arrow sample, T-02 handles / Width / Fill+Border every-swatch. Not leftover-18.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright used Vite `127.0.0.1:5173` with auto-login names cleared.

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| T-02 **pass** (create/edit + handles + Width) | Q-drag + knee/leader/arrowTip/box + corners + flip + leader Width 1/16/50. Not every dash / every head. |
| Callout Fill+Border every-swatch | Color only. |
| Line/Arrow every dash + head | Line/Arrow only. Same pickers; Callout leftover. |

FEATURE-MATRIX T-02 leftover: arrowhead; style patch. Reachable catalogs: Style **Solid / Dashed / Dotted** (Cloud rect-only); Arrowhead **None / Solid triangle / V-shape / Open circle / Open triangle / Horizontal line**.

## Product

`handleCreateCallout` already stamped `lineStyle` from the Style picker but always kept `defaultCalloutStyle.arrowheadStyle` (`solidTriangle`). Min-viable: stamp `arrowheadStyle` from the Arrowhead picker. Read both fields from refs at commit time so an SVG window listener cannot keep the default. Debug seam `__phase35GetAnnotationById` also matches `data.id` / `data.legacyCallout.id` (callout groups store id on `data`, not the root). CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. High-risk `PDFViewer.jsx` surgical only.

## Live-proved

Playwright `e2e-callout-dash-arrowhead.spec.mjs` **2 / 2 (34.2s)** on Vite `http://127.0.0.1:5173` (`npm run dev:ui`, auto-login cleared). Focused Node `calloutDashArrowhead` **3 / 3**.

`viewBox="0 0 612 792"`. `file.id` null. Dashed `callout-b1a8ecdd-…`. Dotted `callout-cb1d6fa7-…`. None `callout-0bc7f56f-…`. Horizontal line `callout-e4d2c2d3-…`. Cloud-armed `callout-baeb0f7e-…`. Isolation undone `callout-0bba72d5-…`. 390 dotted `callout-e557791a-…`. 390 Horizontal Line `callout-5f3e1c01-…`.

### Intended — **pass**

Desktop Style catalog **Solid / Dashed / Dotted**. Arrowhead catalog all **6**. Next-draw + selected-patch every dash (`lineStyle` `solid` / `dashed` / `dotted`; SVG leader + text-box `stroke-dasharray` `null` / `6 4` / `2 4`). Next-draw + selected-patch every arrowhead (SVG none / filled polygon / polyline / circle / open polygon / tick). Head stays solid when the leader is dashed.

| Style | stored `lineStyle` | SVG leader + box |
|---|---|---|
| Solid | `solid` | no dash |
| Dashed | `dashed` | `6 4` |
| Dotted | `dotted` | `2 4` |

| Arrowhead | stored | SVG |
|---|---|---|
| None | `none` | shaft only |
| Solid triangle | `solidTriangle` | filled polygon |
| V-shape | `vShape` | polyline |
| Open circle | `openCircle` | circle |
| Open triangle | `openTriangle` | unfilled polygon |
| Horizontal line | `horizontalLine` | perpendicular tick |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Callout Style | Cloud | **0** options (rect-only) |
| Cloud-armed Callout create | after Rect Cloud | solid (`callout-baeb0f7e-…`) |
| Pen-armed | Style / Arrowhead | **0**; first dashed + dotted vShape held |
| Unknown head (Node) | `not-a-style` | fails closed to `none` |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Isolation | later Dotted did not rewrite first Dashed |
| Undo | isolation Callout gone; first Dashed + dotted/vShape held |
| Select empty | invents 0 |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Style **0** / Arrowhead **0** / Draw **0** |
| 390 | Border style Solid/Dashed/Dotted (Cloud **0**); Arrowhead all 6 Title-Case labels; every next-draw dash + head; Rect still offers Cloud |

## Official / focused Node

Focused `calloutDashArrowhead` **3 / 3**. Official `npm test` fail-stop while starting `tests/performance/overlayPresentationGate.test.mjs` after the main list had already passed `calloutDashArrowhead` **3 / 3** and `leftover18FailClosed`. Isolated re-run of that file + leftover18 + Line/Arrow + Callout dash **30 / 30**. Isolated **8448** not reached. Cap **8448** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Reachable unblocked next: **Counter remaining chrome** if still incomplete. Leftover **18** stay parked. Goal stays open.
