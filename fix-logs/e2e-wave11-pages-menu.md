# Wave 11 — desktop Pages rotate counter-clockwise

**Date:** 2026-08-21  
**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Goal:** stays open

Did **not** replay wave7/8/9/10 insert-blank, leftover **18**, flatten specs, or official `npm test`.  
No prod SQL. Cap **8448** / **75/250** not loosened. No secrets. No `.bot-credentials.json` / `.env*`.

## Menu audit

Compared desktop Pages context menu (`src/sidebar/PagesPanel.jsx` `mobileMode=false`) against:

- the same file’s `mobileMode` extras
- `mobile-expo-go/App.tsx` `openPageContextMenu`
- legacy canvas PAL page menu (`src/PageAnnotationLayer.jsx`)

| Action | Desktop Pages | Mobile Pages / expo-go | Canvas/legacy PAL |
|---|---|---|---|
| Cut / Copy / Paste | yes | yes | Paste page when clipboard set |
| Duplicate | yes | yes | Duplicate page |
| Insert blank page | yes (wave 10) | Add footer + wave-10 menu | Insert blank page |
| Add after last | Insert blank on last thumb | Add inserts after current | Insert blank on that page |
| Rotate CW | Rotate | Rotate | Rotate clockwise |
| Rotate CCW | **was missing** | no | Rotate Counter-Clockwise |
| Move up / down | no (drag reorder) | yes (`mobileMode` only) | no |
| Mirror H / V / Reset / Delete | yes | yes | no |
| Extract page | **no handler on any surface** | no | no |

Real missing desktop control: **Rotate counter-clockwise**. Handler `handleRotatePageCCW` (`delta: -90`) was already wired to PAL only.

Not added: Move up/down (desktop drag covers it), extract (no product handler), a second Insert-blank / add-after-last row.

## Product min-diff

`src/sidebar/PagesPanel.jsx`

- Desktop (and shared) context menu item **Rotate counter-clockwise** → existing `onRotatePageCCW`
- Viewport clamp `480` → `540` so Delete stays on-screen after the extra row
- Escape + deferred outside-click + `data-pages-context-menu="true"` already present from wave 10

`src/PDFSidebar.jsx` — pass `onRotatePageCCW`.  
`src/PDFViewer.jsx` — one left-rail API key + one effect dep (`handleRotatePageCCW`). Function-only identity compare unchanged.  
`src/AppShell.jsx` — comment audit list only (`{...leftRailApi}` already forwards).  
`tests/pagesPanelUtils.test.mjs` — source-wiring asserts.

High-risk files: **tiny** `PDFViewer.jsx` only (API publish). Not edited: `PageAnnotationLayer.jsx`, `FabricEraserCanvas.jsx`, `SVGAnnotationLayer.jsx`, `viewerShared.js`, `package.json`, `vite.config.js`.

### Invariants (re-grepped)

| Invariant | Holds? |
|---|---|
| `zoomGeneration` / `setZoomGeneration` | yes — `PDFViewer.jsx` |
| SVG `viewBox={`0 0 ${width} ${height}`}` | yes — `SVGAnnotationLayer.jsx` |
| Container-aware canvas / single-name fontFamily / CORS `*` | untouched this pass |

## Live prove

Vite already on `http://localhost:5173` (HTTP 200). Reused; not killed.

```bash
node --test tests/pagesPanelUtils.test.mjs
# 5 / 5

npx playwright test --config debug/playwright.reuse-5173.config.mjs \
  debug/scenarios/e2e-adversarial-wave11.spec.mjs
```

**Live: 1 / 1 passed (8.4s).**  
Fixture: `?testPdf=text-search-glyph-lab.pdf` (3 native letter pages, no annots).

| Hunt | Verdict | Live proof |
|---|---|---|
| **Break** — Escape dismisses without rotating | **pass** | Menu offered Rotate counter-clockwise; Escape; page 2 stayed portrait; still 3 pages. |
| **Intended** — CCW page 2 remaps nothing; siblings stay; export 270 | **pass** | Page-2 rect stayed. Page-3 ellipse stayed. Page 1 empty. Export rotations `[0, 270, 0]`. Square on page 2, Circle on page 3. |
| **Edge** — CW restore; last-page CCW isolated | **pass** | Desktop Rotate restored `[0, 0, 0]`. CCW on page 3 → `[0, 0, 270]`. Rect and ellipse stayed on 2 / 3. |

`W11_ROTATE_CCW` log: rect `e41c675d-…`, ellipse `d1efc457-…`.

Node `tests/pagesPanelUtils.test.mjs` **5 / 5**. Did **not** run official `npm test` (wave brief).  
`graphify` CLI was not on PATH (`graphify-out/graph.json` still present); no graph refresh this pass.

## Leftover 18 — unchanged

Not retried. Still open: `X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

## Spec

`debug/scenarios/e2e-adversarial-wave11.spec.mjs`

Not a replay of `debug/scenarios/e2e-adversarial-wave10.spec.mjs` (insert-blank).

## Goal

Stays **open**.
