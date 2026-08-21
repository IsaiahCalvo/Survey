# Page-structure undo siblings — local-lane wipe

**Date:** 2026-08-21  
**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Goal:** stays open

Did **not** replay Move up/down, wave 11 rotate-ccw, wave 10 insert-blank, leftover **18**, or official `npm test`.  
No prod SQL. Cap **8448** / **75/250** not loosened. No secrets. No `.bot-credentials.json` / `.env*`.

## Hunt

`commitPageStructureState` (`PDFViewer.jsx`) already wipes React `undoHistory` / `redoHistory`, the parallel legacy refs, **and** the local lanes (`localAnnotationUndoRef` / `localAnnotationRedoRef`) plus `localAnnotationHistoryVersion`. That wipe is the Move up/down live-prove fix.

Asked: do sibling page-structure commits skip the same wipe?

| Caller | Path | Remaps addresses? | Uses wipe? |
|---|---|---|---|
| Insert blank | `handleInsertBlankPage` → `runMutation` → `executeMutation` → `commitPageState` | yes (`insert`) | **yes** — same callback |
| Delete page | `handleDeletePage` → same | yes (`delete`) | **yes** |
| Duplicate | `handleDuplicatePage` → same | yes (`duplicate`) | **yes** |
| Rotate CW | `handleRotatePage` / `handleRotatePageCW` → same | yes (`rotate`) | **yes** |
| Rotate CCW | `handleRotatePageCCW` → same | yes (`rotate`) | **yes** |
| Move / paste / cut-paste | `handleReorderPages` / `handlePastePage` → same | yes (`move` / `copy`) | **yes** |
| Rename | `handleRenamePage` → `setPageNames` only | no | n/a — no rematch |
| Mirror H/V | `handleMirrorPage` → presentation transform | no | n/a |
| Reset | `handleResetPage` → presentation transform | no | n/a |
| Cut / Copy clipboard | `setClipboardPage` only | no | n/a |
| Space remove page | `handleSpaceRemovePage` → membership + cascade delete | no page-number remap | n/a |

`usePageOperations.js` has **one** persist-then-commit boundary. Every address-remapping op goes through `commitPageState?.(merged, op)` → `commitPageStructureState`. There is no second commit helper and no caller that publishes remapped `annotationsByPage` while leaving local-lane refs intact.

`tests/pdfViewerUndoOneLiners.test.mjs` P1-18 already asserts the wipe lives inside `commitPageStructureState`.

## Verdict

**Zero sibling misses.** No `PDFViewer.jsx` product diff this pass.

Invariants re-grepped, not edited: `zoomGeneration`, SVG `viewBox`, container-aware canvas sizing, single-name `fontFamily`, CORS `Access-Control-Allow-Origin: '*'`.

High-risk files **not** edited: `PDFViewer.jsx`, `PageAnnotationLayer.jsx`, `FabricEraserCanvas.jsx`, `SVGAnnotationLayer.jsx`, `viewerShared.js`, `package.json`, `vite.config.js`.

## Wave 12

Because every remapping caller already uses the wipe, a **new** adversarial wave 12 ran on a different unused surface: History delete-restore + jump-to-page on `?testPdf=` (W4-03 remaining risk; not pages menu, not flatten, not survey-marker; not a replay of W4-03 button/empty/activity-list).

Spec: `debug/scenarios/e2e-adversarial-wave12.spec.mjs`  
Receipt: `fix-logs/e2e-adversarial-wave12.md`

## Leftover 18 — unchanged

Not retried. Still open: `X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

## Goal

Stays **open**.
