# Style dash after Callout / Rect sibling switch — 2026-08-26

## Leftover taken

Session-shared Style dash on the live Style picker. Live toolbar writes Style as `lineBorderStyle` (solid / dashed / dotted / rect-only cloud). Style-capable `DEFAULT_TOOL_PREFERENCES` omitted `lineBorderStyle`, `handleLineBorderStyleChange` did not persist it, and the tool-switch sync restored Width / Color / Opacity but not Style. Callout → Text inherited Dashed; Rect → Ellipse inherited Dashed; first-create then stamped the leak until Style was touched. Distinct from leftover-18, textbox first-create Style persist (user-set Dashed, `45acb83d`), and Text first-create Width after sibling (`aa0369af`).

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live create-path / persist / export bug after Text first-create Width after sibling (`79eacf19` / product `aa0369af`):

| Key | Toolbar | Verdict |
|---|---|---|
| **Callout Dashed → Text Style** | Style (next-draw, no Style click) | **LIVE leftover** — Text inherited Dashed |
| **Rect Dashed → Ellipse Style** | Style (next-draw, no Style click) | **LIVE leftover** — Ellipse inherited Dashed |
| textbox first-create Style persist | Style | **aligned** — dedicated first-create dash (`45acb83d`) |
| text first-create Width after sibling | Width | **aligned** — dedicated Width 1 reset (`aa0369af`) |
| text first-create Fill | Color Fill | **intentional empty** until Color Fill patches |
| highlighter after Pen Width | Width | Highlighter defaults include 20; not taken |
| session-shared Arrowhead | Arrowhead | still session-shared; not taken this pass |

Did **not** invent envelope extras. Did **not** take C-01 (no swatch / hex / Transparent). Did **not** stamp `file.id`. Did **not** invent first-create Fill on an empty-default textbox. Did **not** invent a Font picker / richTextEditor. Did **not** invent a polygon tool.

## Product

`src/hooks/useDatabase.js`:

- Text / Callout / Rect / Ellipse / Line / Arrow defaults now `lineBorderStyle: 'solid'`
- Existing `getToolPreference` per-key merge so a saved row that predates Style still picks up Solid instead of leaking a sibling dash

`src/PDFViewer.jsx` (HIGH-RISK, min-viable):

- Tool-switch sync restores `lineBorderStyle` from that tool's prefs
- Style picker persists `lineBorderStyle` per tool the same way Width already persists `strokeWidth`

`file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay textbox first-create Style persist or Text first-create Width after sibling.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-style-dash-after-sibling.spec.mjs` **2 / 2 (8.4s)**.

- Intended: Callout Style Dashed → Text Style **Solid** → Callout keeps **Dashed** → Rect Dashed → Ellipse Style **Solid** → Text Style **Solid** + first box **without touching Style** writes solid dash; Export annotated PDF omits FreeText `/BS`; `?testPdf=` reimport keeps Solid; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0; hubPreview Style **0**
- Edge: 390 viewBox / `file.id` / no invent

Node `pdfStyleDashAfterSibling` proves Style-capable defaults include Solid, prefs merge per key, tool switch restores + persists Style, default compose is solid, leaked dashed `[6,4]` stays distinguishable.

Focused Node `pdfStyleDashAfterSibling` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` fail-stops on pre-existing `annotationContextMenuitem` spec (`keyboard.press('Enter')` vs live spec — not taken; not aligned down). Isolated 8448 not reached because official fail-stops first. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Session-shared Style dash now resets per tool after Callout / Rect — not a leftover
- Text first-create now resets Width to 1 after Callout / Highlighter — not a leftover
- Textbox first-create now stamps next-draw Style / Border Opacity / Border / Width — not a leftover
- Textbox first-create empty background is intentional until Color Fill patches — do not invent a fill
- Counter first-pin now loads badge Fill `#ef4444` / 100 — not a leftover
- Callout first-create already stamps borderColor / lineThickness / borderOpacity / lineStyle — not a leftover
- Rect / ellipse / line / arrow first-draw already stamp dash + Width — not a leftover
- Pen / highlighter first-stroke Width + opacity already aligned — not a leftover
- Partial erase first-swipe Size / Type already aligned — not a leftover
- Font color / Bold / Italic / fontFamily / fontSize / textAlign stay 0 without richTextEditor
- **Session-shared Arrowhead** (`arrowheadStyle` useState) can still leak Callout ↔ Arrow after a sibling switch — not taken
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
