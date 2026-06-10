# PDF Rendering Layer Map (KAL-85)

_2026-06-10, overnight loop. Audit-only: no code changed, no deletions (per ticket
guardrails). Every ACTIVE claim cites its import/render chain; unknowns are documented
as unknowns. Codex adversarial fact-check applied. Deletion candidates are coordinated
with KAL-82 (dead-code removal) — nothing is deleted here._

## The two live branches (read this first)

- `useSyncfusionRenderer` (`PDFViewer.jsx:862`) is hardcoded `true` — despite the name,
  this selects the per-page PORTAL LOOP that now serves BOTH engines.
- `getPDFViewerEngine()` (`viewerShared.js:421`) defaults to **pdf.js**
  (`PDF_VIEWER_ENGINE_DEFAULT = PDF_VIEWER_ENGINE_PDFJS`, `viewerShared.js:419`);
  override precedence: `?pdfEngine=` param -> `window.__DEV_OVERRIDE_PDF_VIEWER_ENGINE`
  -> localStorage -> default. **pdf.js is the default WHEN NO OVERRIDE IS SET;
  Syncfusion remains reachable via `?pdfEngine=syncfusion`, the dev override, or a
  PERSISTED `localStorage.pdfViewerEngine` value (`viewerShared.js:440-442`,
  `main.jsx:116-118`) — a machine that once switched stays on Syncfusion until cleared.**
- `rendererMode` (`PDFViewer.jsx:2820`) defaults to `'svg'` (Ctrl+Shift+V /
  `?renderer=` to change), making `requiresLegacyAnnotationLayer` false
  (`PDFViewer.jsx:17046-17052`).

Normal production path: portal loop + engine=pdfjs + rendererMode=svg.

## Ticket answers

- **(a) Visible page:** `PdfjsViewerContainer`'s internal private `PdfPageCanvas`
  (`PdfjsViewerContainer.jsx:129`, `annotationMode: 0` = page pixels only). Chain:
  `main.jsx` -> `AppShell` -> `PDFViewer.jsx:42` import -> `:26782` mounts
  `PDFViewerEngineSelector` -> `PDFViewerEngineSelector.jsx:18-28` picks the engine.
  Syncfusion owns the page when selected by any override (URL param, dev override, or persisted localStorage).
- **(b) App annotations:** `SVGAnnotationLayer.jsx` — mounted per page at
  `PDFViewer.jsx:27529` / `28439` / `29077`, always on in svg mode; zoom via
  `viewBox`, zero JS zoom coordination.
- **(c) Imported/native PDF annotations:** the SAME `SVGAnnotationLayer` —
  `isPdfImported` objects live in the same store and render through the same SVG path
  (`SVGAnnotationLayer.jsx:114` branches per-type). The PDF's own annotation layer is
  suppressed: CSS injection under Syncfusion (`PDFViewer.jsx:27037+`), `annotationMode: 0`
  under pdf.js.
- **(d) Text selection / search highlights:** `PdfjsTextLayer.jsx` (mounted
  `PDFViewer.jsx:27129`, ONLY when engine=pdfjs AND `activeTool === 'text-select'` —
  deliberate perf deferral; full text-selection UX remains KAL-239 future work) and
  `SearchHighlightLayer.jsx` (`PDFViewer.jsx:27137`, when results exist). Syncfusion
  engine uses its own `refreshTextSearchHighlights` (`SyncfusionPDFContainer.jsx:1755`).
- **(e) Selection handles / hit-testing:** `useSVGInteraction` hook (imported
  `SVGAnnotationLayer.jsx:38`, called `:422`) owns hit-testing + AutoCAD-style marquee;
  `SVGSelectionOverlay.jsx` (rendered at `SVGAnnotationLayer.jsx:2418/4980/5208`) owns
  the visual chrome. `RegionSelectionTool.jsx` (`PDFViewer.jsx:26599`) is a SEPARATE
  space-region mode, not annotation selection.

## Status table

| File | Status | Notes |
|---|---|---|
| `src/components/PdfjsViewerContainer.jsx` | ACTIVE | default page renderer; exposes the `data-pdfjs-overlay-host` div inside the zoom transform — the KAL-241 "glued zoom" seam (`:944-948`, `getOverlayHost()`) |
| `src/components/PDFViewerEngineSelector.jsx` | ACTIVE | the engine seam (`PDFViewer.jsx:26782`) |
| `src/components/SVGAnnotationLayer.jsx` | ACTIVE | primary annotation renderer (persisted + imported) |
| `src/components/SVGSelectionOverlay.jsx` | ACTIVE | selection chrome, owned by the SVG layer |
| `src/components/FabricDrawingCanvas.jsx` | ACTIVE | in-progress strokes only (draw tools); `zoomGeneration` contract; mounts `PDFViewer.jsx:27691/28555/29188` |
| `src/components/FabricEraserCanvas.jsx` | ACTIVE | eraser hit-zones only (opacity-0 over SVG visual truth) |
| `src/components/FabricEditCanvas.jsx` | ACTIVE | text/callout body edit only; bbox-edit types stay in SVG chrome |
| `src/components/PdfjsTextLayer.jsx` | ACTIVE | text-select tool only, pdf.js engine |
| `src/components/SearchHighlightLayer.jsx` | ACTIVE | search highlights, pdf.js engine (dead-branch mounts at `PDFViewer.jsx:28341/28979`) |
| `src/components/PdfjsLinkLayer.jsx` / `PdfjsFormLayer.jsx` | ACTIVE | links / form fields, pdf.js engine |
| `src/components/LightweightAnnotationOverlay.jsx` | ACTIVE (Syncfusion engine) / DEAD under pdf.js | frozen-snapshot proxy during Syncfusion interaction phases (`PDFViewer.jsx:27268`); under pdf.js the phase machinery bails before leaving idle (`markSyncfusionInteractionActive` early-return `PDFViewer.jsx:2720`; render gate `:26999-27002`) |
| `src/components/collab/CollaboratorOutlineOverlay.jsx` + `QuarantineMarkerOverlay.jsx` | ACTIVE | session-level, mounted by YDocProvider (`:74,1539` / `:90,1556`) |
| `src/RegionSelectionTool.jsx` | ACTIVE | separate space-region DRAWING mode |
| `src/SpaceRegionOverlay.jsx` | ACTIVE | renders persisted space regions per page (import `PDFViewer.jsx:41`; mounts `:27333/27454/28878/29704`) |
| `src/components/SyncfusionPDFContainer.jsx` | LEGACY-ACTIVE | fallback engine via `?pdfEngine=syncfusion`; holds the legacy zoom lifecycle |
| `src/PageAnnotationLayer.jsx` (~10k lines) | LEGACY-ACTIVE (+1 dead mount) | live-legacy under `?renderer=canvas` (`requiresLegacyAnnotationLayer`) at `PDFViewer.jsx:27208/28353`; ALSO an UNGUARDED mount at `:28991` inside the dead `!useSyncfusionRenderer` branch; the pre-SVG-migration monolith; deletion candidate ONLY after the canvas escape hatch is formally retired |
| `src/components/PDFPageCanvas.jsx` | LEGACY (dead branch) | the `!useSyncfusionRenderer` branch's double-buffered page canvas (`PDFViewer.jsx:28319/28957`); unreachable while the flag is hardcoded true |
| `src/TextLayer.jsx` | LEGACY (dead branch) | manual span text layer for the same dead branch (`:28330/28968`); no other importers (the prototype uses its own `SpikeTextLayer`, NOT this file) |
| `src/main.jsx` Syncfusion CSS imports (`:349-358`) + `registerLicense()` (`:362`) | LEGACY | load unconditionally under BOTH engines — prime Syncfusion-removal cleanup target |
| `src/prototype/*` (spikes, arms, spike layers) | PROTECTED | `?spike=` reference fixtures — never deletable |

Prior-audit cross-check: `PDFPageList.jsx` (react-window's sole importer) confirmed
deleted in `f84e048b`; the orphaned `react-window` dep remains a fallow-report item.
The dead `src/components/PageAnnotationLayer.jsx` stub was deleted 2026-05-28 (not re-flagged).

## Duplicate-looking but genuinely separate

- `src/components/PDFPageCanvas.jsx` vs the private `PdfPageCanvas` inside
  `PdfjsViewerContainer` — two unrelated implementations; no collision (one is dead-branch,
  one is the live engine's private component).
- `src/TextLayer.jsx` vs `src/components/PdfjsTextLayer.jsx` — manual span layout
  (dead branch) vs `pdfjsLib.renderTextLayer` (live).

## Deletion candidates (for KAL-82 — each needs its smoke test; DO NOT delete here)

1. `src/components/PDFPageCanvas.jsx` + `src/TextLayer.jsx` (dead `!useSyncfusionRenderer`
   branch) — smoke test: confirm no `?renderer=`/flag path revives the branch (the
   prototype is unaffected — it uses its own `SpikeTextLayer`); build + full tests.
2. `src/PageAnnotationLayer.jsx` — ONLY after a deliberate decision to retire
   `?renderer=canvas` (Isaiah's call; it is the only non-SVG annotation fallback).
3. `src/main.jsx` Syncfusion license + CSS — belongs to the Syncfusion-removal phase
   proper, not piecemeal cleanup.
4. Orphaned `react-window` dependency (fallow report) — package.json touch, infra rules apply.

## Formerly-unknowns (resolved during adversarial review)

- **LightweightAnnotationOverlay under pdf.js: DEAD.** `markSyncfusionInteractionActive`
  early-returns under the pdf.js engine (`PDFViewer.jsx:2720`) so the interaction phase
  never leaves `'idle'`, and the render gate (`:26999-27002`) therefore never opens.
  The proxy layer is Syncfusion-engine-only.
- **FormFieldPropertiesPanel: no direct Syncfusion import.** The component itself
  (`FormFieldPropertiesPanel.jsx:18-19`) takes a callback/ref from its parent; the
  Syncfusion coupling lives in PDFViewer's integration (`PDFViewer.jsx:2992-3004`).
  The panel survives Syncfusion removal; the parent wiring is what must be reworked.
