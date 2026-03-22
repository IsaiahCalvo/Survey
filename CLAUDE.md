# Survey BetaSafeS2 — Claude Code Instructions

## Gotchas & Lessons Learned

- **2026-03-22 — Canvas sizing must use container-aware measurement, not pageSize * scale:** The Electron/browser zoom factor creates a mismatch between the computed canvas size (`pageSize.width * syncfusionViewerScale`) and the actual Syncfusion page div size. At 50% PDF zoom with a 4/3 Electron zoom factor, the Syncfusion page div was 816x528 but the Fabric.js canvas was only 612x396, causing annotations to appear smaller and offset up-left. Fix: measure `containerEl.offsetWidth / pageSize.width` to get `effectiveScale` instead of trusting the Syncfusion-reported zoom percentage. Applied in PAL's canvas init (`PageAnnotationLayer.jsx:~5192`), direct resize path, and settle callback in the scale useEffect.
