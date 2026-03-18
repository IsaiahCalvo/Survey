# Phase 1: Overlay Attachment Foundation - Context

**Gathered:** 2026-03-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Create persistent overlay divs as direct children of Syncfusion `e-pv-page-div` elements, ready to serve as portal targets for later phases. The existing annotation rendering system stays fully operational — overlays are added alongside but not yet used for rendering.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
- **Overlay lifecycle:** Claude decides which pages get overlay divs (visible, annotated, or all loaded) and whether/when to clean up overlay divs for pages no longer in view. The create-once guard per page number is required per design spec.
- **Coexistence strategy:** Overlays should be purely inert in Phase 1 — added to the DOM but not used for rendering. The existing portal host system (`syncfusionStablePortalHostsRef`, `resolveSyncfusionOverlayPortalHost()`, etc.) continues to drive annotation rendering unchanged.
- **Verification approach:** Claude decides how to verify overlays are correctly placed — DevTools inspection, visual indicators during dev, Playwright tests, or manual protocol. Must confirm: overlay divs exist as direct children of page divs, have correct styling, and don't break existing rendering.
- **`attachOverlayToPageDiv()` implementation details:** Function signature, error handling, logging. Design spec provides the shape; Claude handles edge cases.
- **Cleanup of overlay divs for pages scrolled far out of view:** Performance vs simplicity tradeoff — Claude's call.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design Spec
- `docs/superpowers/specs/2026-03-17-option3-direct-child-canvas-design.md` — Full design spec. Step 1 defines `attachOverlayToPageDiv()` function shape, overlay div styling, and what it replaces. Steps 2-6 provide forward context for how overlays will be used in later phases.

### Architecture Reference
- `docs/superpowers/specs/2026-03-17-option2-svg-display-fabric-edit-design.md` — Fallback spec if Option 3 doesn't work. Context only — not used in this phase.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `resolveSyncfusionLivePageHost()` (App.jsx ~line 11980): Contains the page div lookup logic (by ID pattern and `data-page-number` attribute). The overlay attachment function should copy this lookup approach.
- `syncfusionStablePortalHostsRef` (App.jsx ~line 9013): Pattern for storing persistent per-page DOM references in a ref object keyed by page number.
- `SyncfusionPDFContainer.jsx` (line ~205-217): MutationObserver that tracks page divs via `e-pv-page-div` class and `data-page-number` attribute. Feeds `syncfusionPageContainers` state.

### Established Patterns
- Page div lookup: `host.querySelector('.e-pv-page-div[data-page-number="${pageNumber}"]')` — used consistently in SyncfusionPDFContainer.jsx
- Per-page ref storage: `ref.current[pageNumber] = domElement` pattern used throughout App.jsx
- Create-once guard: Check `if (ref.current[pageNumber]) return ref.current[pageNumber]` before creating

### Integration Points
- `overlayDivsRef` will be consumed by Phase 2 (zoom handler applies CSS transforms to these divs) and Phase 3 (render loop creates portals into these divs)
- Must not interfere with current `syncfusionStablePortalHostsRef` system — both coexist until Phase 6 removes the old system
- `syncfusionPageContainers` state (from SyncfusionPDFContainer.jsx MutationObserver) is the signal for when page divs exist and can receive overlay children

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Design spec (Step 1) is prescriptive and should be followed.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-overlay-attachment-foundation*
*Context gathered: 2026-03-17*
