# Survey BetaSafeS2 — Claude Code Instructions

## CRITICAL — DO NOT BREAK (Enforced Rules)

- **Canvas sizing MUST use container-aware measurement, not pageSize * scale.** The Electron/browser zoom factor creates a mismatch. Always measure `containerEl.offsetWidth / pageSize.width` to get `effectiveScale`. This applies to FabricDrawingCanvas, FabricEraserCanvas, FabricEditCanvas, and any future Canvas component. See Gotchas section for details.

- **SVG viewBox handles all zoom scaling.** The old 5-timer zoom system (beginSyncfusionScaleConfirmPending, onScaleApplied, 300ms settle, freeze/snapshot/confirm-pending) was removed in Phase 11 of the v2.0 SVG Migration. SVG annotations scale via `viewBox="0 0 pageWidth pageHeight"` with zero JavaScript coordination. Canvas components (pen, eraser, edit) use `zoomGeneration` signal for auto-commit during zoom.

- **NEVER remove the zoomGeneration signal.** `setZoomGeneration(prev => prev + 1)` fires at zoom-start inside `beginSyncfusionScaleConfirmPending`. All mounted Canvas components (FabricDrawingCanvas, FabricEraserCanvas, FabricEditCanvas) watch this signal to auto-commit in-progress work before the container resizes.

## Gotchas & Lessons Learned

- **2026-03-22 — Canvas sizing must use container-aware measurement, not pageSize * scale:** The Electron/browser zoom factor creates a mismatch between the computed canvas size (`pageSize.width * syncfusionViewerScale`) and the actual Syncfusion page div size. At 50% PDF zoom with a 4/3 Electron zoom factor, the Syncfusion page div was 816x528 but the Fabric.js canvas was only 612x396, causing annotations to appear smaller and offset up-left. Fix: measure `containerEl.offsetWidth / pageSize.width` to get `effectiveScale` instead of trusting the Syncfusion-reported zoom percentage. Applied in PAL's canvas init (`PageAnnotationLayer.jsx:~5192`), direct resize path, and settle callback in the scale useEffect.
