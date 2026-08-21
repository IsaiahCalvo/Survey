# Callout cross-page paste — last-copied wins

**Date:** 2026-08-21  
**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Goal:** stays open

Did **not** replay leftover **18**, waves 5–13, flatten, or official `npm test`.  
No prod SQL. Cap **8448** / **75/250** not loosened. No secrets. Did not stamp `file.id`.  
Did **not** invent a toolbar.

Vite reused `http://localhost:5173` (`npm run dev:ui`); not killed.

## Root cause

Two cooperating misses, both live on `?testPdf=`:

1. **Keyboard Copy read the wrong selection cell.** Live SVG selection is `selectedCalloutIds`. Cmd+C / Cmd+X checked only the legacy PAL `selectedCalloutId`, which stays `null` after a click. The callout copy silently no-oped. `clipboardAnnotation` from the last rect/ellipse/pen/text stayed populated.

2. **Paste preferred the shape lane.** `doPasteAny` (context-menu Paste) and Cmd+V did `if (clipboardAnnotation) paste shape; else if (clipboardCallout) paste callout`. Comments claimed only one lane is ever populated. When a callout copy failed to clear (or never wrote) the shape lane, Paste cloned the last shape.

Context-menu **Copy** on a callout already called `handleCopyCallout` and cleared the shape lane. The thin-leftovers hunt used Cmd+C, so it never wrote `clipboardCallout`.

## Fix (min-diff)

| File | Change |
|---|---|
| `src/utils/pickActiveClipboard.js` | Pure `pickActiveClipboard` (recency / lastKind) + `resolveSelectedCalloutId` (live SVG set) |
| `src/PDFViewer.jsx` | `lastClipboardKind` on every Copy/Cut; Cmd+C uses the live set + `stopImmediatePropagation`; Cmd+V uses `pickActiveClipboard` |
| `src/hooks/useAnnotationContextMenu.jsx` | `doPasteAny` uses `pickActiveClipboard` — last copied item wins |
| `tests/pickActiveClipboard.test.mjs` | Pins empty / shape-only / callout-only / lastKind / timestamps |
| `tests/annotationContextMenuCalloutParity.test.mjs` | Pins `doPasteAny` → `pickActiveClipboard` |
| `debug/scenarios/e2e-callout-paste.spec.mjs` | Focused intended / break / edge |
| `debug/scenarios/e2e-thin-leftovers.spec.mjs` | Callout hunt is now a hard clone assert (context-menu Copy) |

Not edited: `PageAnnotationLayer.jsx`, `FabricEraserCanvas.jsx`, `SVGAnnotationLayer.jsx`, `viewerShared.js`, `package.json`, `vite.config.js`.

`zoomGeneration` / SVG `viewBox` / container-aware canvas / single-name `fontFamily` / CORS `*` untouched.

## Live prove

`?testPdf=text-search-glyph-lab.pdf` (3 pages).

```bash
node --experimental-strip-types --test \
  tests/pickActiveClipboard.test.mjs \
  tests/annotationContextMenuCalloutParity.test.mjs
# 17 / 17

npx playwright test --config debug/playwright.reuse-5173.config.mjs \
  debug/scenarios/e2e-callout-paste.spec.mjs
# 1 / 1 (11.5s)

npx playwright test --config debug/playwright.reuse-5173.config.mjs \
  debug/scenarios/e2e-thin-leftovers.spec.mjs
# 3 / 3 (20.1s) — rect/ellipse/pen/text still clone; callout clone now hard-pass
```

### Intended

| Hunt | Verdict | Live proof |
|---|---|---|
| Copy callout page 1 → Paste page 2 | **pass** | Source `callout-c6a33115-…` stayed on page 1; page 2 got `callout-7c33d8f0-…`. Text `xp-call` + leader `line1`/`line2` intact |

### Break

| Hunt | Verdict | Live proof |
|---|---|---|
| Empty clipboard | **pass** | Empty-page menu Paste-only, gray `rgb(90, 100, 115)`; click no-ops |
| Paste while Pen armed | **pass** | Clone `callout-890d14c3-…` still landed |
| Copy shape THEN copy callout | **pass** | Paste was callout `callout-b30d08bf-…`; no new rect |
| Copy callout THEN copy rect | **pass** | Paste was rect `6bebcf74-…`; callout count unchanged |
| Paste after source page delete | **pass** | Delete page 3; paste on page 1 cloned `callout-8a3d2bdb-…` |

### Edge

| Hunt | Verdict | Live proof |
|---|---|---|
| Second paste unique id | **pass** | `callout-631509e8-…` ≠ first paste |
| Paste after undo of source | **pass** | Source gone; clipboard yielded `callout-576e9234-…` |
| Paste after destination rotate | **pass** | Rotate page 2 CW; paste still cloned `callout-54abf063-…` |

Thin-leftovers callout hunt (hardened): source `callout-db26c8f8-…` → clone `callout-cdbb7724-…` on page 2.

`leftover18: unchanged`.

## Leftover 18 — unchanged

Not retried. Still open: `X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

## Remaining unique unblocked clusters

This was the one unique leftover named after the thin-leftovers pass. It is now live-proven. Candidate list stays leftover-18, compile-hidden (Note / Link create — not invented), or already proven. No new unique unblocked control cluster was taken.

## Goal

Stays **open**.
