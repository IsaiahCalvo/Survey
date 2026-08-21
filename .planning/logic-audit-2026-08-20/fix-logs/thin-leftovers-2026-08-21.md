# Thin leftovers — cross-page paste, Pages Duplicate execute, imported sticky chrome

**Date:** 2026-08-21  
**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Goal:** stays open

Did **not** replay waves 5–12, flatten, survey-marker, leftover **18**, or official `npm test`.  
No prod SQL. Cap **8448** / **75/250** not loosened. No secrets. Did not stamp `file.id`.  
Did **not** invent a Note or Link create tool.

Vite reused `http://localhost:5173` (`npm run dev:ui`); not killed.

## Clusters

The three leftovers named after E2E-LINK-01. None were already proven in `E2E-STATUS.md` (UL-27–29 same-page paste only; UL-32 showed the Duplicate *item*; no imported `/Text` fixture).

### 1. Cross-page paste — **pass** (callout clone leftover)

`?testPdf=text-search-glyph-lab.pdf` (3 pages). Spec `debug/scenarios/e2e-thin-leftovers.spec.mjs`.

| Hunt | Verdict | Live proof |
|---|---|---|
| **Intended** — rect / ellipse / pen / text page N → page M | **pass** | Fresh ids on the destination; sources stayed on page 1 |
| **Intended** — callout if present | **create present / clone miss** | Callout tool exists and created `callout-…`. Context-menu Paste kept the last *shape* clipboard (`doPasteAny` prefers `clipboardAnnotation` over `clipboardCallout`). Not a new create tool. |
| **Break** — paste with nothing copied | **pass** | Empty-page menu is Paste-only, gray `rgb(90, 100, 115)`; click no-ops |
| **Break** — paste while Pen armed | **pass** | Clone still landed |
| **Break** — paste after source page deleted | **pass** | Delete page 3; paste on remaining page 1 cloned the doomed rect |
| **Edge** — paste after undo of the source | **pass** | Source gone; clipboard still yielded a new id |
| **Edge** — paste after destination rotate | **pass** | Rotate page 2 CW; paste still cloned |

### 2. Pages Duplicate execute — **pass**

Desktop Pages thumb context menu **Duplicate** (overflow/desktop same menu).

| Hunt | Verdict | Live proof |
|---|---|---|
| **Intended** — duplicate current page including annotations | **pass** | Page 1 rect id stayed on page 1; page 2 got a new-id rect clone. Count 3 → 4 |
| **Break** — Duplicate while Pen armed | **pass** | Count 4 → 5; no ErrorBoundary |
| **Break** — Duplicate while History Restore pending | **pass** | Deleted ellipse offered Restore; Duplicate still inserted (5 → 6) |
| **Edge** — first page, last page, then undo | **pass** | Last-page Duplicate 6 → 7; toolbar Undo **disabled** (local-lane wipe still holds) |

### 3. Imported sticky chrome — **pass** (compile-hidden create tool)

Existing `debug/fixtures/*.pdf` had **zero** `/Subtype /Text` stickies. Create-Note is compile-hidden (`PDFViewer.jsx` Review dropdown: `TODO: Revisit the user-created Note tool`; only Text + Callout). **Not invented.**

Generated native `/Text` fixture only (same pattern as `e2e-link-cluster.pdf`):  
`tests/helpers/buildStickyNotePdf.mjs` → `debug/fixtures/e2e-sticky-note.pdf` → `?testPdf=e2e-sticky-note.pdf`.

| Hunt | Verdict | Live proof |
|---|---|---|
| **Intended** — imported proxy renders | **pass** | `noteId=6R`, `pdfType=Text`, `noteText=e2e-sticky-body` |
| **Open / edit / close** | **no dedicated chrome** | `promptChrome: 0`; no `[data-note-editor]`. PAL `window.prompt` is on the hidden create-Note path. SVG treats the proxy as a selectable rect. |
| **Click-through** | **pass** | Pen-armed click did not delete the imported note. Page 2 has no sticky. |
| **Edge** — no create-Note tool | **pass** | Text sub-toolbar labels: `Text`, `Callout` only |

## Product bug (min-diff)

Imported `/Text` proxies from `convertTextToFabricNote` set `pdfAnnotationId` but **not** `id` / `data.id`. SVG `getAnnotationRenderIdentity` then emitted empty `data-anno-id`, so the hunt (and select/copy) could not see the note.

**Fix:** stamp `annotation.id` onto `id` and `data.id` in `convertTextToFabricNote`.  
Node: `tests/pdfAnnotationImporter.test.mjs` **imported Text sticky note stamps render identity** — pass.  
Not edited: `PDFViewer.jsx`, `PageAnnotationLayer.jsx`, `FabricEraserCanvas.jsx`, `SVGAnnotationLayer.jsx`, `viewerShared.js`, `package.json`, `vite.config.js`.

## Live prove

```bash
npx playwright test --config debug/playwright.reuse-5173.config.mjs \
  debug/scenarios/e2e-thin-leftovers.spec.mjs
# 3 / 3 passed (29.0s)
```

`leftover18: unchanged`.

Isolated importer file including the new identity test: **35 / 35**. Did **not** run official `npm test`.

## Invariants (untouched)

| Invariant | Holds? |
|---|---|
| `zoomGeneration` / SVG `viewBox` / container-aware canvas / single-name `fontFamily` / CORS `*` | yes — high-risk files not edited |

## Leftover 18 — unchanged

Not retried. Still open: `X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

## Remaining unique unblocked clusters

These three leftovers are now live-proven (callout *clone* is the only miss inside cluster 1 — not leftover-18, not a new toolbar). Candidate list from the link wave stays leftover-18, compile-hidden, or already proven. No fourth unique unblocked control cluster was taken.

## Spec

`debug/scenarios/e2e-thin-leftovers.spec.mjs`  
Fixture helper: `tests/helpers/buildStickyNotePdf.mjs`  
Fixture bytes: `debug/fixtures/e2e-sticky-note.pdf`

## Goal

Stays **open**.
