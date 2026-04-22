# Group / Ungroup Design — Two-Stage Selection

**Date**: 2026-04-18
**Status**: Design captured, on hold pending prerequisite work (TBD)

## Summary

Implement Figma / Illustrator / PowerPoint-style two-stage group selection for multi-annotation groups on the SVG selection surface.

## User Experience

### Stage 1 — Click anything in a group

- A single outer dashed blue box with handles (rotation handle included) encompasses the entire group.
- Every member inside the group paints the blue hover-glow (same glow used when shift-clicking to add to a selection).
- Members do NOT show their own per-shape bounding boxes or handles.
- Equivalent to the current marquee multi-select chrome.

### Stage 2 — Click a specific member inside the already-selected group

- The outer dashed blue box turns into a gray dashed outline.
- The outer outline loses its handles and rotation handle.
- The clicked member gains full focus: its own handles, rotation handle, and accepts double-click to edit.
- The member can be dragged, scaled, rotated, and edited independently.

### Live-adjusting gray outline

- If the focused member is resized or dragged such that any edge extends beyond the gray outline, the gray outline grows in real time to accommodate the new extent.
- The gray outline should always visually contain every group member after every transform tick.
- When selection is cleared (click empty space), the gray outline disappears. Next click on any member returns to Stage 1.

## Design Reference

- **Figma** — single click selects group, double-click drills into a member (isolation mode).
- **Google Slides / PowerPoint** — same two-stage model, outer box shrinks to "ghost" state when a member is focused.
- **Illustrator** — Group Selection Tool (A+) or double-click enters isolation mode.

The live-growing outer outline is a small UX improvement over Figma / Slides, which keep the outer box fixed until you exit the group.

## Prerequisite

User has flagged that another piece of work must land BEFORE this design can be implemented. TBD in next session — capture prerequisite here once identified.

## Open Questions (deferred until prerequisite lands)

- Storage model: `groupId` field on each annotation vs. separate `groups` array on the page.
- Do callouts participate as group members? (Current multi-select chrome already includes them.)
- Nested groups — supported or flat-only for v1?
- Ungroup behavior — does it restore each member as independently selected, or clear selection entirely?
- Click-through empty space inside the gray outline — treat as empty-space click (deselect) or as sub-threshold group drag?

## Current Related State

- Group / Ungroup menu items already exist in the right-click context menu on the outer group box but are currently no-ops.
- Existing multi-select chrome (outer dashed box + member hover-glow) is exactly Stage 1 of this design.
- Right-click batch ops (Cut / Copy / Paste / Delete / z-order) already work on the outer group box and should continue to work on Stage 1 groups.

## Out of Scope for This Design

- Cross-page group membership (user confirmed: click-and-drag marquee stays single-page; click / shift-click across pages remains the only multi-page selection path).
- Replacing the dormant Fabric-layer AutoCAD reference code — that cleanup is a separate task.
- Alt-drag callout subtract — separate task.
