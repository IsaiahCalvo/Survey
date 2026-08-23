# Page-2 rotate max-update-depth — chrome-publish identity churn — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.**  
Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write.

Unique leftover after page-2 remap (`f8471fa8`): live `Maximum update depth exceeded` in `PDFViewer.jsx` on `?testPdf=spike-120-pages.pdf`. Tests had passed anyway.

Distinct from leftover-18 / X-01 / CW/CCW/180 remappers / persist catalogs / form persist / `mtr` / page-2 remap isolation / 103-ID refresh `2026-08-23c` (not replayed).

## Root cause

CLAUDE.md 2026-05-13 chrome-publish identity-churn. AppShell passes raw `setTopToolbarApi` / `setBottomToolbarApi`. Left/right rail already compared next vs prev and treated function-only identity as unchanged. Top/bottom toolbar did not.

- `src/PDFViewer.jsx:12380` — top toolbar `useEffect` published `{ canUndo, canRedo, onUndo: handleUndo, onRedo: handleRedo }` every time `handleUndo`/`handleRedo` identity churned after page mutation → AppShell `setState` every render.
- `src/PDFViewer.jsx:23484` — bottom toolbar published a new object on every effect run (`annotationsByPage` / `pageTransformations` / `scale` after 120-page rotate).
- `src/PDFViewer.jsx:4392` — `handleRightRailCollapseChange` always `setRightRailCollapsed(isCollapsed)` even when already current.

## Product (min-viable)

Same compare as left rail: functional updater, same key-length, function-only-equal, `===` for the rest; return `prev` when unchanged. Collapse: `setRightRailCollapsed((prev) => (prev === isCollapsed ? prev : isCollapsed))`.

Did **not** refactor `PDFViewer.jsx`. Did **not** edit AppShell. Invariants held: container-aware `offsetWidth / pageSize.width`, SVG viewBox zoom, `zoomGeneration`, single-name `fontFamily`, CORS `*`.

## Live proof

`?testPdf=spike-120-pages.pdf` · Playwright `e2e-page-rotate-max-update-depth.spec.mjs` **3 / 3 (12.6s)** · `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5207`.

| Path | Result |
|---|---|
| Intended page-2 CW | page 1 `b8f82912-…` **held 183.60**; page 2 `ddc8f1f8-…` **514.80, 183.60**; viewBox **`0 0 792 612`**; **hits 0** |
| Break single-page | `clickable-link-test.pdf` cancel/Escape invents **0**; empty CW invents **0**; viewBox **`0 0 792 612`**; **hits 0** |
| Edge 390 | 120-page load invents **0**; viewBox **`0 0 612 792`**; **hits 0**; `file.id` null |

Traps: console + `pageerror` for `Maximum update depth exceeded` / `too many re-renders`.

## Node

`tests/pageRotateMaxUpdateDepth.test.mjs` **4 / 4**. Focused + leftover18 **16 / 16**.

Official `npm test` after `PDFViewer.jsx`: **201** files passed, then fail-stopped `tests/e2eUnlistedControls.test.mjs` **16 / 17** — standing `aria-label="Counter start number"` lives in `CounterStartNumberField.jsx` after extract, not `AppShell.jsx`. Not this leftover. Did **not** loosen that UL contract. Isolated **8448** `partialEraserComplexity` not reached (runner fail-stops). Cap **8448** / 75/250 **not** loosened.

`graphify` CLI **absent**.

## Next leftover

Leftover-18 live hosts (first **X-01**). Goal stays **OPEN**.
