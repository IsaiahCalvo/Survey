# Text first-create Width after Callout / Highlighter — 2026-08-26

## Leftover taken

Text first-create on the live Text tool. Live toolbar Width is Border/Width (`strokeWidth`). Text `DEFAULT_TOOL_PREFERENCES` omitted `strokeWidth`, so Callout → Text inherited Callout Width `2` and Highlighter → Text inherited Highlighter Width `20`. First-create then stamped the leaked Width until the user touched Width. Distinct from textbox first-create Width persist (`user-set 8`, already stamps toolbar Width), Counter first-pin Fill color (`39b4e9a5`), and leftover-18.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live create-path / persist / export bug after Counter first-pin Fill color (`11494b6f` / product `39b4e9a5`):

| Key | Toolbar | Verdict |
|---|---|---|
| **text first-create Width after Callout** | Width (next-draw, no Width click) | **LIVE leftover** — Callout → Text inherited Width `2` |
| **text first-create Width after Highlighter** | Width (next-draw, no Width click) | **LIVE leftover** — Highlighter → Text inherited Width `20` |
| text first-create Width after user-set 8 | Width | **aligned** — dedicated first-create Width persist |
| text first-create Fill | Color Fill | **intentional empty** until Color Fill patches |
| highlighter after Pen | Width | Highlighter defaults include 20; not taken |
| ellipse after Rect Width | Width | both default 2; not taken this pass |
| ellipse after Rect dash | Style | session-shared `lineBorderStyle`, not a per-tool omit |

Did **not** invent envelope extras. Did **not** take C-01 (no swatch / hex / Transparent). Did **not** stamp `file.id`. Did **not** invent first-create Fill on an empty-default textbox. Did **not** invent a Font picker / richTextEditor.

## Product

`src/hooks/useDatabase.js`:

- Text defaults now `strokeWidth: 1` (same hairline the first-create path used before Width persist)
- Existing `getToolPreference` per-key merge so a saved text row that predates Width still picks up `1` instead of leaking Callout/Highlighter/Pen Width

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay Counter first-pin Fill color or textbox first-create Width persist.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-textbox-first-create-width-after-sibling.spec.mjs` **2 / 2 (7.3s)**.

- Intended: Callout (Width 2) → Text (Width 1) → Highlighter (Width 20) → Text (Width 1) + first box **without touching Width** writes `strokeWidth` **1**; Export annotated PDF writes FreeText `/Border` **1**; `?testPdf=` reimport keeps Width 1; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent

Node `pdfTextboxFirstCreateWidthAfterSibling` proves Text defaults include Width 1, prefs merge per key, default compose is 1, leaked highlighter 20 stays distinguishable.

Focused Node `pdfTextboxFirstCreateWidthAfterSibling` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent. CreateGoal tool unavailable — no goal armed.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Text first-create now resets Width to 1 after Callout / Highlighter — not a leftover
- Textbox first-create now stamps next-draw Style / Border Opacity / Border / Width — not a leftover
- Textbox first-create empty background is intentional until Color Fill patches — do not invent a fill
- Counter first-pin now loads badge Fill `#ef4444` / 100 — not a leftover
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
