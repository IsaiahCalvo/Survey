# Selected paper-ink Color / Opacity / Width as-is after Select — 2026-08-26

## Leftover taken

User-selected Pen / Highlighter Color / Opacity / Width. Live toolbar already wrote Color as rgba `fill` and Width as `sourceWidth`, and the page view already painted that fill, but Select chrome read leftover `stroke` (`transparent`) and leftover `strokeWidth` (`0`). After a sibling tool (Rect Width 2 / Opacity 100), Select kept that leftover chrome until the picker was re-touched, and Color patches wrote leftover `stroke` so the screen stayed the old fill. Distinct from leftover-18, selected-shape Fill Opacity 0 sync (`01e0e5ac`), Pen / Highlighter first-stroke persist, and C-01 swatch / hex / Transparent apply. Field clamp 1–50 stayed. Did not invent a richTextEditor. Did not restroke baked paper-ink polygons on Width patch.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live persist / create-path / view clamp / Select chrome leftover after the exhausted export/`/AP`/flatten/decode class (`e4c0f78d` / product `aa0b87ef`):

| Key | Toolbar | Verdict |
|---|---|---|
| **Selected paper-ink Color / Opacity / Width** | Color / Width after Select | **LIVE leftover** — leftover stroke / strokeWidth dropped fill 0.4 + sourceWidth 4 |
| Style Dotted Ellipse `/AP` | Style | **aligned** — last hunter; not replayed |
| Font / B / I / size persist | Font chrome | **not live** — richTextEditor edit-only |
| Line `/AP` | Line | **not a leftover** — native Line has no `/AP` |
| leftover-18 human-gated | — | **not taken** |

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent Line `/AP`. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover.

## Product

`src/viewerShared.js` (HIGH-RISK, min-viable):

- `isPaperInkAnnotation` — path with a real `fill` and unused leftover stroke

`src/PDFViewer.jsx` (HIGH-RISK, min-viable):

- Select sync reads Color / Opacity from `fill` and Width from `sourceWidth`
- Color / Opacity selected-patch writes `fill` (not leftover `stroke`)
- Width selected-patch writes `sourceWidth` (chrome / metadata; baked outline not restroked)

`file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay Arrow flatten Arrowhead or export/`/AP` writers.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-selected-paper-ink-chrome-sync.spec.mjs` **2 / 2 (8.1s)**.

- Intended: Pen Width **4** + Color Opacity **40** + first stroke + Shapes Rectangle (sibling leftover Width 2 / Opacity 100) + Select keeps Width **4** + Opacity **40**; Color Opacity **20** patches fill **0.2** (stroke stays leftover transparent)
- Break: empty export invents 0; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent

Node `pdfSelectedPaperInkChromeSync` proves paper-ink detect, rejects stroked leftovers, Select + patch write fill / sourceWidth, isolated 8448 / 75/250 standing.

Focused Node `pdfSelectedPaperInkChromeSync` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` fail-stops on pre-existing `annotationContextMenuitem` spec (`keyboard.press('Enter')` vs live spec — not taken; not aligned down). Isolated 8448 not reached because official fail-stops first. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Selected paper-ink Color / Opacity / Width chrome now reads fill / sourceWidth — not a leftover after this pass
- Color selected-patch now writes fill — not a leftover
- Width selected-patch does **not** rebuild baked paper-ink polygons — remaining, not taken
- Style Dotted already writes Ellipse `/AP` — not a leftover
- Font color / Bold / Italic / fontFamily / fontSize stay 0 without richTextEditor
- Line `/AP` — native Line has no `/AP`; do not invent
- Callout box Rotation — callouts have no live box Rotation; do not invent
- Counter pin Rotation — `lockRotation`; do not invent
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
