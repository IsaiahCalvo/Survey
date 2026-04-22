# Phase 16 — Curvature Pill

**Gathered:** 2026-04-19
**Status:** Awaiting user sign-off before planning

## What You'll See

Select a line or arrow. When you hover the middle handle (the small dot in the center), a small dark number bubble fades in 16 px above the handle. The bubble shows the current curve amount as a signed pixel distance — `0 px` for a straight line, `+24 px` means the midpoint is pulled 24 px off the straight baseline to one side, `-24 px` to the other side. You can click into the bubble and type an exact number, hit Enter, and the line re-curves to match. Arrow keys nudge by 1 px, Shift + Arrow nudges by 10 px, Escape cancels. The bubble follows the handle while you drag the midpoint, always stays upright, and disappears 500 ms after your cursor leaves both the handle and the bubble.

## Acceptance Criteria

- **Given** a line is selected and the cursor is not near the midpoint handle, **when** the user looks at the page, **then** no curvature bubble is visible.
- **Given** a line is selected, **when** the cursor hovers the midpoint handle for 150 ms, **then** a small dark bubble appears 16 px above the handle showing the current curve amount in pixels (signed, integer).
- **Given** the curvature bubble is visible and focused, **when** the user types a number and presses Enter (or blurs the input), **then** the line re-curves so the midpoint sits that many pixels perpendicular from the straight baseline, in the same direction as the current curve (or the nearer side if straight).
- **Given** the curvature bubble is visible, **when** the user presses Escape, **then** the bubble reverts to the pre-edit value and the line geometry does not change.

## DO NOT CHANGE

- `src/App.jsx` — no edits.
- `src/components/PageAnnotationLayer.jsx` — untouched.
- `src/components/FabricDrawingCanvas.jsx` / `FabricEraserCanvas.jsx` / `FabricEditCanvas.jsx` — untouched. The curvature pill is SVG-overlay only.
- `src/components/SVGAnnotationLayer.jsx` — in scope, narrow edits only (add hover-intent state for the midpoint handle + mount the new `CurvatureInputField` next to the existing `RotationInputField` portal, same pattern).
- `src/components/RotationInputField.jsx` — DO NOT EDIT. The curvature pill is a SEPARATE component that mirrors its pattern, not a modification.
- `src/utils/lineGeometry.js` — consumed only. No math changes. The pill drives a new write path into `data.midpoint` using the existing `getControlPoint` logic in reverse.
- `package.json` / `vite.config.js` — untouched.

## Scope Boundary

**In scope:** Curvature pill (hover-reveal + typeable number bubble on line/arrow midpoint handle).

**Out of scope:** Mini-toolbar for color / thickness / arrowhead style picker UI (user skipped this 2026-04-19). Minimum drag length for line/arrow creation (user confirmed already working 2026-04-19 — verify during phase close-out but no code changes). Callout collision / resize / auto-routing / hover / self-destruct (Phases 17-18).

## Claude's Discretion

- Exact sign convention for the pixel-distance number (which side is positive) — pick whichever matches the curve direction the user sees when they drag.
- How the typed number behaves when the line is currently straight (no existing curve direction) — default to positive side, user types negative to flip.
- Whether the curvature bubble stays open during a midpoint drag (showing the live pixel value) or hides during drag. Recommend: stays open and live-updates, same as the rotation bubble does during rotation drag.
