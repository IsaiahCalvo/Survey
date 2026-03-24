# Survey BetaSafeS2 — Claude Code Instructions

## CRITICAL — DO NOT BREAK (Enforced Rules)

- **NEVER modify the zoom/scale system in App.jsx or PageAnnotationLayer.jsx without explicit user approval of the EXACT changes BEFORE applying them.** The zoom system (beginSyncfusionScaleConfirmPending, handlePALScaleApplied, the 300ms settle timer, onScaleApplied callback, container-aware sizing) is extremely fragile and interconnected. THREE separate attempts to simplify it (plan 04-02) all broke annotation positioning. The working state is commit 951164e. Any zoom-related change MUST be presented as a diff for user review BEFORE editing files. No exceptions.

- **NEVER remove beginSyncfusionScaleConfirmPending, onScaleApplied, the 300ms settle timer, or container-aware sizing.** These are load-bearing. Removing any one causes annotations to lose correct size/position after zoom. The confirm-pending timing issue (PAL fires before App) is a KNOWN bug — the fix must not involve removing the system, but fixing the timing coordination.

## Gotchas & Lessons Learned

- **2026-03-22 — Canvas sizing must use container-aware measurement, not pageSize * scale:** The Electron/browser zoom factor creates a mismatch between the computed canvas size (`pageSize.width * syncfusionViewerScale`) and the actual Syncfusion page div size. At 50% PDF zoom with a 4/3 Electron zoom factor, the Syncfusion page div was 816x528 but the Fabric.js canvas was only 612x396, causing annotations to appear smaller and offset up-left. Fix: measure `containerEl.offsetWidth / pageSize.width` to get `effectiveScale` instead of trusting the Syncfusion-reported zoom percentage. Applied in PAL's canvas init (`PageAnnotationLayer.jsx:~5192`), direct resize path, and settle callback in the scale useEffect.
