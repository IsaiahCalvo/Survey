# W4-02 — true two-finger pinch + pinch-cancel

- Date: 2026-08-21
- Status: **proven** (window). No product edit.
- ID: **E2E-W4-02** leftover (V-04)
- Did **not** edit: `PDFViewer.jsx`, `PdfjsViewerContainer.jsx`, `SVGAnnotationLayer.jsx`, `viewerShared.js`. No commit.
- Vite `http://localhost:5173/` reused (`npm run dev:ui`); not killed.

## Verdict

**Proven, not blocked.** Chrome CDP can synthesize two simultaneous touches. Playwright's high-level `touchscreen` cannot (single contact) — do not treat that API as a blocker; `Input.dispatchTouchEvent` with two `touchPoints` delivered trusted `touchstart`/`touchmove` with `touches=2`.

Pinch listeners only attach when `isMobileSurface` is true (`max-width: 720px` or `pointer: coarse`). Probe used Playwright `hasTouch: true` so `pointer: coarse` flipped the surface on both 390×844 and 1440×900.

## Stack

- URL: `http://localhost:5173/?testPdf=clickable-link-test.pdf`
- Playwright Chromium `channel: 'chrome'`, `hasTouch: true`
- CDP: `Emulation.setTouchEmulationEnabled` (`maxTouchPoints: 5`) + `Input.dispatchTouchEvent`

## Cases

| Case | Result | Evidence |
|---|---|---|
| Intended — pinch changes zoom | **pass** | Two-point start + spread + both-up. Toolbar 64% / canvas cssW 390 → **248% / 1517**. `survey-pdfjs-pinch-start` 1, `survey-pdfjs-zoom-start` 1, `survey-pdfjs-zoom-end` 1. 390×844: canvas 318 → 765. |
| Break — `touchcancel` | **pass** (commits preview) | `touchcancel` `changed=2` is wired to the same `onTouchEnd` as lift. Isolated from 64%: **248%**. After a committed 248%, a second pinch+cancel went **800%** (further commit, no revert to fit). |
| Break — one-finger lift | **pass** | After spread, `touchend` with 1 remaining: zoom **248%**, `data-mobile-touch-mode=pinch-release`. Second lift: mode cleared, zoom stays 248% (no second commit). Matches `resolvePinchEndTransition('pinch', 1)` → `{ commit: true, nextMode: 'pinch-release' }`. |
| Edge — pinch while inking | **pass** as discard | One-finger-only control (Pen + CDP drag + lift) committed UUID `4a44684c-b13c-4a6f-bbcf-51aa3be27e4f`. Same stroke left down, then second finger: mid mode `tool`, after pinch zoom 64% → **268%**, **no new UUID**. `survey-pdfjs-pinch-start` cancels the in-flight mark (SVG listener). `zoomGeneration` still bumps; the sync pinch-start clear wins, so this is not the toolbar Zoom-in commit path. |

## Not a PDFViewer bug

`SVGAnnotationLayer` documents pinch-start as cancel-never-commit (parity with the old fabric pinch handler). Toolbar / wheel Zoom-in mid-stroke remains the zoomGeneration auto-commit proof from the earlier W4-02 pass. Live two-finger pinch mid-ink is a change of intent: discard the partial mark, then zoom.

## Remaining

- Native Capacitor / iOS `XCUIElement.pinch` (`scripts/test-ios-native-pinch.mjs`) not re-run.
- Fine pointer desktop without `pointer: coarse` / ≤720px does not attach this touch pinch contract (trackpad still uses ctrl/meta wheel).
- Playwright `page.touchscreen` stays single-touch; use CDP for two contacts.
