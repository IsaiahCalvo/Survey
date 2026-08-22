# Live T-01 leftover: textbox create auto-edit type / commit / blank / Escape / tight-fit / wrap — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after E-02 RotationInputField (`c0da8e71`). Prior T-01 was wave overlay drag + click-out smoke. Style Solid/Dashed/Dotted is `e2e-rect-ellipse-text-dash`. UL-36 is Aa re-entry only. Distinct from leftover-18, T-02 callout, V-03 Select text, color / Match Fill / zoom / page-field / rotation catalogs. Did **not** invent flatten / stamp / Forms. Did **not** replay P1-07 / P1-28 Node-only IDs.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite via `debug/playwright.config.mjs` (`npm run dev:ui`) with process auto-login names cleared.

## Product

No product change. Harness only:

- Documents hub (`No documents yet`) was covering the page after the first commit — `dismissChrome` closes it.
- `PDFViewer` `editModeCooldownRef` skips pointerdown for 300ms after commit — the next create drag waited 350ms.
- Drag targets `[data-text-overlay]` when armed.

No high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / FabricEraserCanvas / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched.

## Live-proved

Playwright `e2e-textbox-create-edit.spec.mjs` **2 / 2 (18.1s)** on Vite `http://127.0.0.1:5173`. Focused Node `textboxCreateEdit` + leftover18 + `textEditCommit` **25 / 25**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop type **Hello** + click-out commits. Single-line **Hi** tight-fits (`width=30` under a wide drag). Wrapped sentence keeps drag wrap width (`159.1` > Hi). 390 type **Mobile**.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Escape new | type SHOULD-DIE | discard; store unchanged |
| Blank click-out | empty overlay | discard |
| Whitespace | `   ` | discard |
| Pen hide | arm Pen | overlay **0**; Hello held |
| Escape re-edit | Hello → CHANGED then Esc | Hello restored |

### Edge

| Slice | Evidence |
|---|---|
| Re-edit grow | Hello + wrap text; width locked; height grows |
| Blank existing | doomed → empty commit deletes (P1-28 live) |
| Isolation | Second does not rewrite Hello |
| Undo | drops Second; Hello held |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Text / overlay **0**; Draw **0** |
| 390 | Mobile commit; Escape discard; empty discard |

## Official / focused Node

No high-risk file. Official `npm test` not re-run. Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.
