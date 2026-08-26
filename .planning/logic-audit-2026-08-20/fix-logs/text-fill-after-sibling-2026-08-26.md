# Text Fill chrome after Callout / Counter sibling switch — 2026-08-26

## Leftover taken

Session-shared Text Color Fill chrome on the live Color swatch. Live toolbar writes Fill as session `fillColor` / `fillOpacity`. Text `DEFAULT_TOOL_PREFERENCES` omitted those keys, so tool-switch restore skipped them. Callout → Text inherited white / 90; Counter → Text inherited badge red / 100; the Text Color swatch showed the leak until Fill was touched. First-create box fill stays empty (`backgroundColor: ''`) — this is **not** inventing a first-create Fill. Distinct from leftover-18, session-shared Arrowhead (`742dc241`), session-shared Style dash (`c082fc76`), and Text first-create Width after sibling (`aa0369af`).

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live create-path / persist / export bug after session-shared Arrowhead (`a4feb011` / product `742dc241`):

| Key | Toolbar | Verdict |
|---|---|---|
| **Callout white / 90 → Text Fill chrome** | Color Fill (next-draw, no Fill click) | **LIVE leftover** — Text swatch inherited `rgba(255,255,255,0.9)` |
| **Counter badge red → Text Fill chrome** | Color Fill (next-draw, no Fill click) | **LIVE leftover** — Text swatch inherited badge red |
| Pen Width 8 → Highlighter Width | Width | **aligned** — Highlighter stays 20; Pen restore 8 |
| Highlighter Width 32 → Pen Width | Width | **aligned** — Pen stays 8 |
| Line Width 8 → Arrow Width | Width | **aligned** — Arrow stays 2; Line restore 8 |
| Callout Width → Text Width | Width | **aligned** — dedicated Width 1 reset (`aa0369af`) |
| Pen Color/Opacity → Highlighter | Color / Opacity | **aligned** — Highlighter stays yellow / 50 |
| Pen → Eraser type/size | Eraser Type | **aligned** — Partial erase / 20 |
| Rect Cloud bump → Ellipse Solid | Style | **aligned** — dedicated Style persist (`c082fc76`) |
| Session-shared Arrowhead | Arrowhead | **aligned** — dedicated Arrowhead persist (`742dc241`) |
| text first-create Fill | Color Fill | **intentional empty** — do not invent first-create Fill |

Did **not** invent envelope extras. Did **not** take C-01 (no swatch / hex / Transparent). Did **not** stamp `file.id`. Did **not** invent first-create Fill on an empty-default textbox. Did **not** invent a Font picker / richTextEditor. Did **not** invent a polygon tool.

## Product

`src/hooks/useDatabase.js`:

- Text defaults now `fillColor: '#ffffff', fillOpacity: 0` (empty Fill chrome)
- Existing `getToolPreference` per-key merge so a saved row that predates Fill still picks up empty Fill instead of leaking a sibling fill
- Existing PDFViewer tool-switch already restores `fillColor` / `fillOpacity` when defined; Fill picker already persists per tool
- HIGH-RISK `PDFViewer.jsx` **not touched** this pass

`file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay Arrowhead / Style dash / Width after sibling.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-text-fill-after-sibling.spec.mjs` **2 / 2 (7.2s)**.

- Intended: Callout Fill white / 90 → Text Fill **empty (alpha 0)** → Callout keeps **white / 90** → Counter badge red / 100 → Text Fill **empty** + first box **without touching Fill** writes `backgroundColor` `''`; Export annotated PDF omits FreeText `/C`; `?testPdf=` reimport keeps empty Fill; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent

Node `pdfTextFillAfterSibling` proves Text defaults include empty Fill, prefs merge per key, tool switch restores + persists Fill, first-create envelope stays `backgroundColor: ''`, leaked white/90 stays distinguishable as FreeText `/C`.

Focused Node `pdfTextFillAfterSibling` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Session-shared Text Fill chrome now resets empty after Callout / Counter — not a leftover
- Session-shared Arrowhead now resets per tool after Callout / Arrow — not a leftover
- Session-shared Style dash now resets per tool after Callout / Rect — not a leftover
- Text first-create now resets Width to 1 after Callout / Highlighter — not a leftover
- Textbox first-create now stamps next-draw Style / Border Opacity / Border / Width — not a leftover
- Textbox first-create empty background is intentional — do not invent a first-create Fill
- Width after remaining pairs (Pen ↔ Highlighter, Line ↔ Arrow, Text ↔ Callout) — confirmed aligned
- Opacity / Color hue / Eraser type sibling pairs — confirmed aligned
- Counter first-pin now loads badge Fill `#ef4444` / 100 — not a leftover
- Callout first-create already stamps borderColor / lineThickness / borderOpacity / lineStyle / arrowheadStyle — not a leftover
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
