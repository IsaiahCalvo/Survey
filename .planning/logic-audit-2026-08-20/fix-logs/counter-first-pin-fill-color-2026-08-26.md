# Counter first-pin Fill color persist — 2026-08-26

## Leftover taken

Counter first-pin create on the live Counter tool. Live toolbar Fill is the badge body (`#ef4444`). Counter `DEFAULT_TOOL_PREFERENCES` omitted `fillColor` / `fillOpacity`, so Shapes → Counter (lastShapeTool defaults to rect) inherited rect's empty fill (`#ffffff` / `0`). First-pin compose then stamped `rgba(255, 255, 255, 0)` — an invisible pin — until the user opened Counter colors / touched Fill. Distinct from Counter first-pin fillOpacity compose (`66dff649`, which already composed hex+opacity but from the leaked rect values), Number export GS1 `/ca` (`4562beb2`), and leftover-18.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live create-path / persist / export bug after Counter Number color opacity export (`b5d0722b` / product `4562beb2`):

| Key | Toolbar | Verdict |
|---|---|---|
| counter first-pin Number Opacity | Counter colors Number Opacity | **aligned** — live probe first pin wrote `rgba(..., 0.4)` via the numberColor ref |
| counter first-pin Number hue | Counter colors Number (spectrum SV) | **aligned** — live probe first pin wrote `rgba(166, 13, 13, 1)` |
| counter first-pin Size | Size | **aligned** — live probe first pin `radius: 28` |
| **counter first-pin Fill COLOR** | Counter colors Fill (next-draw, no picker) | **LIVE leftover** — Shapes → Counter inherited rect `#ffffff` / `0` |
| textbox first-create fontFamily | Font | **parked** — 0 without `richTextEditor` |
| textbox first-create Fill | Color Fill | **intentional empty** until Color Fill patches |

Did **not** invent envelope extras. Did **not** take C-01 (no swatch / hex / Transparent). Did **not** stamp `file.id`. Did **not** open Counter caret. Did **not** invent a Font picker / richTextEditor. Did **not** invent first-create Fill on an empty-default textbox. Did **not** invent increment (Start is post-select, count === 1).

## Product

`src/hooks/useDatabase.js`:

- Counter defaults now `fillColor: '#ef4444'`, `fillOpacity: 100`; Number `strokeColor: '#ffffff'`
- `getToolPreference` per-key merges defaults so a saved counter row that predates fill keys still picks up badge Fill instead of leaking rect empty fill

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay Counter first-pin fillOpacity compose, Number GS1 `/ca`, or textbox first-create leftovers.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-counter-first-pin-fill-color.spec.mjs` **2 / 2 (7.2s)**.

- Intended: Shapes → Counter + place first pin **without opening Counter colors** writes badge Fill `#ef4444` (not transparent white); Export annotated PDF writes Circle `/IC` red; no dict `/CA`; no AP `/ca`; `?testPdf=` reimport keeps badge red; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0; hubPreview Counter colors **0**
- Edge: 390 viewBox / `file.id` / no invent

Node `pdfCounterFirstPinFillColor` proves Counter defaults include badge Fill, prefs merge per key, default compose is opaque red, leaked rect compose is transparent, first-pin-shaped export omits `/ca`.

Focused Node `pdfCounterFirstPinFillColor` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent. CreateGoal tool unavailable — no goal armed.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Counter first-pin now loads badge Fill `#ef4444` / 100 — not a leftover
- Counter first-pin Number Opacity already rides the numberColor ref — not a leftover
- Counter first-pin Number hue already rides the numberColor ref — not a leftover
- Counter first-pin Size already stamps `strokeWidth` as radius — not a leftover
- Counter Number color opacity export now writes GS1 `/ca` — not a leftover
- Counter first-pin now composes fillColor + fillOpacity at create — not a leftover
- Counter Fill already writes Circle AP `/ca` — not a leftover
- Textbox first-create now stamps next-draw Style / Border Opacity / Border / Width — not a leftover
- Textbox first-create empty background is intentional until Color Fill patches — do not invent a fill
- Callout first-create already stamps borderColor / lineThickness / borderOpacity / lineStyle — not a leftover
- Rect / ellipse / line / arrow first-draw already stamp dash + Width — not a leftover
- Pen / highlighter first-stroke Width + opacity already aligned — not a leftover
- Partial erase first-swipe Size / Type already aligned — not a leftover
- Font color / Bold / Italic / fontFamily / fontSize / textAlign stay 0 without richTextEditor
- Polygon `/IC` without alpha — live toolbar is Counter/rect/ellipse, no polygon tool
- Projects desktop file rows (Open file)
- Activity File / Edited (need View activity)
- MoveCopy Close / Cancel / Confirm type-null (behind Select apply)
- AccessManagement row Resend/Revoke type-null (empty SE-011)
- Select-gated All / None / Duplicate / Move/Copy / Restore / Delete forever
- Templates move-modal Close; Edit-modules New module type-null
- Documents More menuitem type-null; Templates MoreMenu menuitem type-null
- Subscription Manage / Usage tabs
- Spaces expand / delete (Create space)
- Survey item Notes (needs a placed marker)
- C-01 swatch / hex / Transparent apply; Send viewer invite apply
- Highlighter caret compile-hidden; Counter caret 0
- Pages unnamed cards (tab-as-switcher)
- Idle editor unnamed text+checkbox (Forms / X-05 host-proved)
- Activity Close (A-06); Manage Team role trigger 0; History Version history trigger 0
- Desktop archived Permanently delete; dirty Cancel / Save
- Module-tab rename; ResetPassword success Back to Survey
- Hub Search `⌘K` (display-only; classified 2026-08-22)

Leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45.
Leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24.

Goal stays OPEN. Parent owns PR 800.
