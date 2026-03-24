# Phase 4: PAL Zoom Simplification - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning
**Source:** Phase 4 refresh after architecture review, reference-app comparison, and repo-rule reconciliation

<domain>
## Phase Boundary

Keep the existing page-attached overlay architecture. This phase does NOT redesign where annotations mount.

Instead of deleting the current zoom/scale primitives, this phase repairs the timing handoff between them. App.jsx should keep owning page attachment and temporary visual zoom scaling. PageAnnotationLayer should stay mounted on the overlay during zoom, follow the page visually, then redraw at the settled zoom so the result becomes crisp without disappearing.

Drawing tools, search highlights, undo/redo, and proxy rendering must all keep working after the sequencing repair.

</domain>

<decisions>
## Implementation Decisions

### Overlay architecture is already correct
- Keep the persistent per-page overlay div as the permanent annotation host
- Keep the custom editable annotation layer; do NOT switch to Syncfusion-owned editable annotations
- Use the reference app only as a behavior reference for "page-attached overlays move naturally with zoom," not as an architecture to copy wholesale

### Responsibilities by layer
- App.jsx owns page attachment and temporary visual CSS scaling during active zoom
- PageAnnotationLayer owns the post-settle redraw sequence
- PageAnnotationLayer stays mounted on the page overlay during zoom; the parent should not replace the host architecture
- SearchHighlightLayer and LightweightAnnotationOverlay continue riding the same overlay structure

### Load-bearing zoom pieces stay in place for now
- Preserve `beginSyncfusionScaleConfirmPending`, `onScaleApplied` / `handlePALScaleApplied`, PAL's 300ms settle timer, and container-aware sizing in this phase
- The fix is to repair their sequencing, not to remove them
- Dead-code removal for this zoom path is deferred until a later cleanup phase after behavior is stable

### Flicker-causing timing must be repaired first
- Keep the confirm-pending system, but repair when App reacts to PAL callback phases so live canvas is not exposed too early or hidden too long
- No phase work should deliberately remove the current coordination path without a verified replacement
- Zoom completion should still follow this order:
  1. redraw at the final scale
  2. remove temporary visual transforms
  3. restore normal interaction state

### Zoom signal handling
- Do NOT treat `isZooming` as the only authoritative zoom signal if the live scale can change while it is false
- Keep `isInteracting` as the safe guard that defers expensive canvas work during active interaction
- Keep PAL's current latches/refs, including the 300ms settle timer, unless a narrowly targeted timing repair requires adjustment
- Container-aware sizing must remain part of both the settled redraw path and the direct resize path

### Interface and sequencing contract
- Keep the PAL-to-App callback contract because it is currently the explicit sequencing link between redraw completion and transform release
- Parent-to-PAL coordination should keep using scale, interaction state, and explicit callback phases until the timing bug is fixed
- Only remove props/helpers that are proven non-load-bearing after the sequencing repair; otherwise defer cleanup
- App should only release per-page transforms / reveal hidden pages on callback phases that truly mean "visually ready"

### Verification priorities
- Detailed stroke-accuracy checks, not smoke tests
- Verify annotations stay visually attached to the page during zoom, even if briefly blurry
- Verify they become crisp quickly after settle with no 3-second disappearance
- Verify pen, shapes, callouts, regions, search highlights, undo/redo, and proxy rendering still work correctly after zoom
- Preserve container-aware sizing behavior across Electron/browser zoom factors

### Claude's Discretion
- Exact PAL callback phases that should trigger per-page transform release versus "still waiting"
- Whether the existing tiered center/visible/off-screen redraw strategy should stay intact or be lightly simplified after the sequencing bug is fixed
- The smallest App-side bookkeeping change needed so callback timing is reliable without deleting the current system
- Error handling for edge cases (for example, missing Fabric canvas refs when zoom settles)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Repo-Level Rule
- `CLAUDE.md` — repo-level zoom rules currently treat `beginSyncfusionScaleConfirmPending`, `onScaleApplied`, the 300ms PAL settle timer, and container-aware sizing as load-bearing; this phase must honor that unless explicitly superseded

### Design Spec
- `docs/superpowers/specs/2026-03-17-option3-direct-child-canvas-design.md` — overall direct-child overlay direction still applies, but the locked decisions in this file override any stale assumptions about which zoom signal or timer should drive the final redraw

### Prior Phase Context
- `.planning/phases/02-zoom-handler/02-CONTEXT.md` — Phase 2 decisions: 1000ms settle timer, CSS transform application, pointer event coordination
- `.planning/phases/03-render-loop-rewrite/03-CONTEXT.md` — Phase 3 decisions: portal targets are overlay divs, layerScale uses live viewer scale, simplified page filtering

### Requirements
- `.planning/REQUIREMENTS.md` — ZOOM-09 (canvas redraws crisp after zoom), OVLY-04 (Fabric.js pointer events work with CSS-transformed parent), PRES-01 through PRES-05 (drawing tools, search highlights, undo/redo, proxy rendering, no console errors)

### Reference Behavior
- `/Users/isaiahcalvo/Desktop/Syncfusion-PDF-App/packages/client/src/pages/Viewer.tsx` — direct page-attached SVG overlay example
- `/Users/isaiahcalvo/Desktop/Syncfusion-PDF-App/packages/client/src/components/PdfViewer/PdfViewer.tsx` — Syncfusion-owned editable annotation behavior reference

### Key Source Files
- `src/PageAnnotationLayer.jsx` lines 7788-8028 — scale useEffect and callback phases
- `src/PageAnnotationLayer.jsx` lines 7814-8069 — container-aware effectiveScale measurement and settled redraw path
- `src/App.jsx` lines 10155-10232 — confirm-pending start and safety timeout
- `src/App.jsx` lines 10704-10791 — `handlePALScaleApplied`
- `src/App.jsx` lines 12043-12165 — overlay attachment and overlay zoom settle logic
- `src/App.jsx` lines 24585-24740 — portal mounting into the page overlay

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `inZoomModeRef` (PAL): zoom latch that prevents expensive canvas resize mid-zoom — keep
- `pendingScaleRef` (PAL): stores deferred scale during zoom — keep
- `zoomSettleTimerRef` (PAL): current 300ms redraw debounce — keep unless a narrowly targeted timing repair requires adjustment
- `enqueueZoomResize()` (PAL): stagger queue for center-page-first rendering — keep as-is unless simplification clearly improves correctness
- `cancelPendingPaintCommit()` / `schedulePaintCommitted()` (PAL): paint commit lifecycle — keep
- `viewportObserverRef` (PAL): IntersectionObserver for off-screen deferred rendering — keep
- `deferredZoomScaleRef` (PAL): stores pending scale for delayed/off-screen pages — keep
- Container-aware `effectiveScale` measurement in PAL: keep

### Established Patterns
- Tiered rendering (center -> visible -> off-screen) with IntersectionObserver for off-screen — existing priority pattern, keep unless it directly conflicts with the repaired sequencing model
- `isZooming` prop already flows from App.jsx to PAL, but should not be treated as infallible if live scale changes arrive outside its timing window
- `fabricRef.current.setWidth/setHeight/setZoom/renderAll` is the standard canvas resize sequence
- `onScaleApplied` phase metadata is the existing explicit handoff between PAL and App — keep and retime rather than delete

### Integration Points
- PAL scale useEffect (lines 7788-8028): main code area to simplify without removing load-bearing pieces
- App.jsx `handlePALScaleApplied`: currently clears transforms too early for some callback phases; this is a likely repair point
- App.jsx confirm-pending bookkeeping: pending pages, reveal scheduling, and transform ratio cleanup must stay consistent
- Phase 5 will add re-attachment logic that calls calcOffset after overlay div moves

</code_context>

<specifics>
## Specific Ideas

- The key insight is still "redraw first, then remove transform" — this eliminates the visual pop that would occur if transforms were removed before fresh pixels were ready
- The overlay host is already the right attachment point; Phase 4 should simplify the behavior layered on top of it, not invent a new host model
- The practical fix is likely App/PAL sequencing repair, not system deletion: preserve the callback path, but only release transforms/reveal pages on callback phases that actually mean "visually ready"
- The reference app proves the value of a page-attached overlay that naturally rides zoom, but we still need our own editable layer on top of that idea
- Stroke-accuracy testing is important because the coordinate system derivation is changing — a quick smoke test could miss subtle pointer offset bugs

</specifics>

<deferred>
## Deferred Ideas

- Removing `beginSyncfusionScaleConfirmPending`, `onScaleApplied`, PAL's 300ms settle timer, or container-aware sizing is deferred until a later cleanup phase after this timing repair is proven safe

</deferred>

---

*Phase: 04-pal-zoom-simplification*
*Context gathered: 2026-03-22*
