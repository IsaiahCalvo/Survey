---
status: diagnosed
trigger: "Investigate issue: syncfusion-zoom-annotation-flicker"
created: 2026-03-06T03:00:30Z
updated: 2026-03-06T03:03:59Z
---

## Current Focus

hypothesis: Confirmed. Syncfusion zoom causes page-container mutations and portal-host churn; the App.jsx overlay render path unmounts when a page host is missing or disconnected, and PageAnnotationLayer disposes its Fabric canvas on that unmount.
test: Diagnosis complete.
expecting: N/A
next_action: return root-cause report with the zoom -> mutation -> render-bailout -> remount sequence

## Symptoms

expected: Annotation visuals stay visible and scale continuously with the underlying PDF page during active zoom.
actual: During active zoom in the Syncfusion viewer, annotations intermittently disappear/flicker; after zoom settles they snap back at the correct size and position.
errors: No runtime errors reported yet. Check local logs and debug instrumentation.
reproduction: Open the Syncfusion-based PDF viewer path, place or load annotations, then zoom in/out via wheel or viewer zoom controls.
started: Current behavior in this codebase; prior planning artifacts suggest this is ongoing.

## Eliminated

## Evidence

- timestamp: 2026-03-06T03:00:58Z
  checked: codebase search for Syncfusion viewer and custom annotation overlay files
  found: zoom-annotation logic is concentrated in src/components/SyncfusionPDFContainer.jsx, src/components/PageAnnotationLayer.jsx, and src/components/LightweightAnnotationOverlay.jsx
  implication: the disappearance sequence is likely fully explainable within the Syncfusion container plus the two custom overlay layers

- timestamp: 2026-03-06T03:01:29Z
  checked: import graph for PageAnnotationLayer and LightweightAnnotationOverlay
  found: SyncfusionPDFContainer is a standalone viewer bridge, while the live annotation integration uses src/App.jsx with src/PageAnnotationLayer.jsx and src/components/LightweightAnnotationOverlay.jsx; src/components/PageAnnotationLayer.jsx is a different lightweight SVG component used by PDFPageItem
  implication: the zoom flicker root cause must be traced through App.jsx and the root PageAnnotationLayer, not the similarly named component under src/components

- timestamp: 2026-03-06T03:02:27Z
  checked: Syncfusion overlay render path and interaction-mode code in src/App.jsx plus zoom-resize behavior in src/PageAnnotationLayer.jsx
  found: zoom-only interactions intentionally keep pages in `full` mode (no lightweight proxy swap), freeze overlay scale/portal hosts during interaction, and bail out of portal rendering when `!pageHost.isConnected`; PageAnnotationLayer itself avoids expensive resizes during interaction and applies CSS transforms to stay visible
  implication: the disappearance is not caused by the lightweight overlay path or Fabric resize deferral alone; a disconnected portal host during Syncfusion DOM replacement is now the leading mount/unmount hypothesis

- timestamp: 2026-03-06T03:03:59Z
  checked: default Syncfusion overlay feature flags in src/App.jsx
  found: `readSyncfusionLiveStableOverlayEnabled` and `readSyncfusionDualLayerEnabled` both default to false when localStorage keys are absent
  implication: in the default code path, the live-stable interaction window does not run, so overlays follow the live page-container map directly during zoom

- timestamp: 2026-03-06T03:03:59Z
  checked: page-container refresh lifecycle in src/components/SyncfusionPDFContainer.jsx
  found: Syncfusion refreshes the page-container map from `.e-pv-page-div` nodes, schedules refreshes on DOM mutation, and refreshes again on `page_render_complete`; zoom changes are emitted separately
  implication: active zoom can produce repeated page-container identity changes while the overlay layer is still rendering against those hosts

- timestamp: 2026-03-06T03:03:59Z
  checked: App.jsx portal-host resolution and render bailout
  found: overlay pages are rendered from `Object.keys(syncfusionPageContainers)` when live-stable mode is off, and the portal render returns `null` whenever `resolvedPageSize` is missing or `pageHost` is absent/disconnected
  implication: when Syncfusion swaps or temporarily removes a page div during zoom, the annotation overlay for that page unmounts instead of remaining visually attached

- timestamp: 2026-03-06T03:03:59Z
  checked: PageAnnotationLayer cleanup and zoom behavior
  found: PageAnnotationLayer is designed to stay visible during interaction by CSS-transforming the Fabric wrapper, but its effect cleanup disposes the Fabric canvas on unmount
  implication: once the portal host churn causes an unmount, annotations disappear entirely and only reappear after the layer mounts again on the new page host

## Resolution

root_cause:
  Syncfusion zoom drives DOM replacement/mutation of `.e-pv-page-div` hosts while the annotation overlays are portal-mounted to those hosts. In the default code path the live-stable overlay system is disabled, so App.jsx renders overlays directly from the mutable `syncfusionPageContainers` map. During zoom, a page host can disappear or be replaced before the new host is ready; the overlay render path then returns `null` for that page, which unmounts PageAnnotationLayer. PageAnnotationLayer would otherwise remain visible by CSS-transforming its Fabric wrapper during interaction, but unmount cleanup disposes the Fabric canvas, producing the observed disappearance/flicker. Once Syncfusion finishes the zoom and `page_render_complete` refreshes the page-container map, the overlay remounts on the new host at the correct scale and position.
fix:
verification:
files_changed: []
