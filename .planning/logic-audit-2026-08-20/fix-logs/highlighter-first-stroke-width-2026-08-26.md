# Highlighter first-stroke Width as-is — 2026-08-26

## Leftover taken

User-set Highlighter Width below 8 on first-stroke. Live Width catalog already offered 1/2/3/4/6 plus custom 7 (field clamp 1–50), but create / live preview / PAL brush used `Math.max(strokeWidth, 8)` so a next-draw Width below 8 never reached persist / export / reimport until Width was touched again. Distinct from leftover-18, Pen as-is `sourceWidth`, highlighter Width catalog above 8 (`edc6735d` / earlier D-05 floor-8 chrome), and highlighter highlightColor compose. Field clamp 1–50 stayed. Did not invent a floor of 8.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live create-path leftover after textbox first-create Fill (`41ec3401` / product `edc6735d`):

| Key | Toolbar | Verdict |
|---|---|---|
| **Highlighter first-stroke Width &lt; 8** | Width | **LIVE leftover** — catalog offered 1…6 / custom 7; create floored 8 |
| Highlighter Width ≥ 8 | Width | **aligned** — as-is `sourceWidth` already |
| Pen first-stroke Width | Width | **aligned** — as-is `sourceWidth` |
| Empty-default Text Fill | Color Fill | **intentional empty** — opacity 0 still stamps `''` |
| Font color / Bold / Italic | richTextEditor | stay 0 — do not invent that editor |
| Highlighter caret / text-highlight | Draw caret | compile-hidden caret 0 — not taken |

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent a polygon tool. Did **not** invent a floor of 8.

## Product

`src/utils/annotationCreationCommit.js`:

- `buildFreehandCommitJSON` stamps `width: strokeWidth` for highlighter (same as Pen)

`src/components/SVGAnnotationLayer.jsx` (HIGH-RISK, min-viable):

- Live preview `strokeWidth={Number(strokeWidth) || 3}` — no highlighter floor

`src/PageAnnotationLayer.jsx` (HIGH-RISK, min-viable):

- Two brush sites use `const w = strokeWidth` — no highlighter floor

`file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay textbox first-create Fill.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-highlighter-first-stroke-width.spec.mjs` **2 / 2 (7.9s)**.

- Intended: Highlighter + Width **4** **before any stroke** + first stroke writes `sourceWidth` **4**; Export annotated PDF writes metadata `sourceWidth` **4**; reimport keeps 4
- Break: empty export invents 0; hubPreview Width **0**
- Edge: 390 Width **1** stamps **1**; viewBox / `file.id` / no invent

Node `pdfHighlighterFirstStrokeWidth` proves commit / preview / PAL no longer floor, first-stroke stamps 4 / 7 / 1 / 20 as-is, export metadata `geometry.sourceWidth` 4, field clamp 1–50, Pen Width 1 isolated.

Focused Node `pdfHighlighterFirstStrokeWidth` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` fail-stops on pre-existing `annotationContextMenuitem` spec (`keyboard.press('Enter')` vs live spec — not taken; not aligned down). Isolated 8448 not reached because official fail-stops first. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Highlighter first-stroke now stamps next-draw Width below 8 — not a leftover
- Highlighter / Pen first-stroke Width ≥ 8 already aligned — not a leftover
- Textbox first-create now stamps next-draw Color Fill when the user set it — not a leftover
- Textbox first-create empty background is still intentional when Fill stays 0
- Eraser Size now persists per tool after remount — not a leftover
- Cloud Bump now persists per tool after remount — not a leftover
- Session-shared Text Fill / Arrowhead / Style dash already aligned
- Text first-create now resets Width to 1 after Callout / Highlighter — not a leftover
- Textbox first-create now stamps next-draw Style / Border Opacity / Border / Width — not a leftover
- Width / Opacity / Color hue / Eraser type sibling pairs — confirmed aligned
- Callout first-create already stamps borderColor / lineThickness / borderOpacity / lineStyle / arrowheadStyle / fill — not a leftover
- Rect / ellipse / line / arrow first-draw already stamp dash + Width + fill — not a leftover
- Partial erase first-swipe Size / Type already aligned — not a leftover
- Font color / Bold / Italic / fontFamily / fontSize / textAlign stay 0 without richTextEditor
- Highlighter caret / text-highlight compile-hidden — not taken
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
