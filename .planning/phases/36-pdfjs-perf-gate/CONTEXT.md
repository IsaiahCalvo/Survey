# Phase 36 — pdf.js Perf-Gate Spike (Milestone: Renderer Ownership, Phase 1 of 4)

**Created:** 2026-06-01
**Milestone:** Renderer Ownership (replace Syncfusion with the owned pdf.js renderer)
**Source plan:** `HANDOFF.md` (the 4-phase staged cutover) + `docs/audits/SYNCFUSION-EMBEDPDF-AUDIT.md`

## Goal

Mount the proven pdf.js renderer (from `src/prototype/PdfjsArm.jsx`) inside the REAL
packaged Electron/Vite app behind the existing `useSyncfusionRenderer` flag, wired into
the real heavy overlay stack (PageAnnotationLayer + Fabric canvases + collab) on a few
pages, and MEASURE whether it holds. This is a build-and-measure gate — **nothing is
ripped out**. Syncfusion stays the default and the safety fallback.

The single load-bearing seam is the `{pageNumber: hostElement}` page-container map
(`pageContainersRef.current`, populated for Syncfusion via
`handleSyncfusionPageContainersChange`). The pdf.js renderer must publish the SAME map
through the SAME contract so the existing overlay portal loop attaches unchanged.

## Acceptance Criteria

- **Given** the app is running with `useSyncfusionRenderer = false`, **when** the 36-page
  test document loads, **then** the pdf.js renderer displays continuous virtualized pages
  with correct mixed orientation, and the existing annotation overlays render pinned to the
  correct page positions (the overlay portal loop attaches to the pdf.js page-host map).
- **Given** a giant marked-up survey sheet with hundreds of shapes and the heavy Fabric
  overlay mounted, **when** a ctrl/⌘-wheel cursor-zoom sweep is performed, **then** the
  overlay holds ~60fps / worst frame < 18ms and stays pixel-pinned to the page (measured,
  recorded with numbers).
- **Given** a 500+ page document, **when** scrolled end to end, **then** heap stays bounded
  (virtualization holds; only near-viewport pages mount canvases).
- **Given** the biggest sheet zoomed deep (well past the crispness cliff), **when** zoomed,
  **then** the visible slice stays crisp (deep-zoom tiling; no clamp/blur).
- **Given** a 90°/270° rotated page, **when** zoomed and scrolled, **then** overlays and
  collab remote cursors stay pixel-pinned.
- **Given** the historical `documentLoadFailed` corpus, **when** opened on pdf.js, **then**
  each opens cleanly (no sanitize/retry needed).
- **Given** the flag is `true` (default), **when** the app runs, **then** the Syncfusion
  path is byte-for-byte unchanged in behavior (zero regression while the flag is off).

## Gate Decision

If the criteria pass → proceed to Phase 2 (re-home the seam, delete the Syncfusion zoom
lifecycle). If any criterion stumbles → we learned it cheaply BEFORE ripping anything out;
record the failure and re-plan. Do NOT delete any Syncfusion code in this phase.

## DO NOT CHANGE (boundaries for this phase)

This is a measurement spike. Touch only what is needed to mount the new renderer behind the
flag and publish its host map. Everything below is OUT of scope:

- `src/components/SyncfusionPDFContainer.jsx` — the Syncfusion wrapper; stays the live
  default + fallback. Not deleted, not refactored this phase.
- `src/PageAnnotationLayer.jsx` — the overlay stack carries over unchanged; it must attach
  to the new host map with no edits. If it needs edits, that is a finding, not a task.
- `src/components/SVGAnnotationLayer.jsx` — SVG viewBox owns all zoom scaling; never add JS
  zoom coordination here.
- `src/components/Fabric{Drawing,Eraser,Edit,Text}Canvas.jsx` — the `zoomGeneration` signal
  contract is untouchable; canvases already measure their own parent width.
- `src/viewerShared.js` — shared scale helpers; do not alter the Syncfusion scale math.
- `package.json` / `vite.config.js` — no dependency churn this phase (pdf.js + pdf-lib are
  already present).
- The Syncfusion zoom-lifecycle cluster in `src/PDFViewer.jsx` (snapshot / freeze /
  confirm-pending / interaction-phase / 1400ms settle) — DELETED only in Phase 2, AFTER the
  gate passes. Leave it intact this phase.

### Allowed edits (high-risk, standing waiver — minimum-viable diffs only)

- `src/PDFViewer.jsx` — add the `!useSyncfusionRenderer` render branch that mounts the new
  renderer; wire its host-map callback to the existing `handleSyncfusionPageContainersChange`
  (or a renderer-agnostic equivalent); add a runtime/dev switch to flip the flag for A/B.
  Keep the diff small and scoped.
- New file `src/components/PdfjsRenderer.jsx` — production adaptation of `PdfjsArm`, exposing
  the `{pageNumber: element}` host map + an imperative API (zoom %, fit, go-to-page,
  `zoomGeneration` fire-at-gesture-start). Net-new; no regression surface.

## Enforced Invariants (still bind — from CLAUDE.md)

Container-aware canvas sizing (measure host width, not pageSize*scale); single-name
fontFamily; never remove the `zoomGeneration` signal; SVG viewBox owns all zoom scaling.
Run `npm test` after any edit to `PDFViewer.jsx` and report baseline (target 840/0/6).

## Status: IN PROGRESS
