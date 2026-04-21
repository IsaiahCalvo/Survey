# Handoff: Counter + Multi-Select + Arrow Import Shipped — Group / Ungroup Next

**Generated**: 2026-04-20 (session close)
**Branch**: post-v2.0/cleanup
**Status**: All work below is committed. Working tree has only uncommitted scaffolding (see "Working Tree State"). Ready to start Group / Ungroup implementation.

## What Just Shipped (closed)

**Multi-select + shift-click symmetry**
- Outer dashed group box for a multi-selection now uses each member's rotation-aware world AABB, so a rotated curved line or arrow combined with another shape produces a frame that actually encompasses the visible arc instead of clipping it.
- Shift-click on a callout now honors the existing shape selection (toggle-add instead of replace), so you can start with a shape and Shift-click a callout in either order.

**Arrow import**
- PDF Line annotations with an arrow `/LE` ending (OpenArrow, ClosedArrow, and their R-prefixed reversed variants) now import as the app's Arrow tool and render with an arrowhead. Start-only arrows swap endpoints so the head lands where the PDF author placed it.
- The blue arrow on page 1 of the canonical test PDF is now imported correctly.

**Curved arrow hover glow**
- The hover-glow arrowhead on a curved line/arrow rotates to the bezier tangent at the endpoint (same math as the visible SVG arrowhead), so the glow triangle points in the same direction as the painted one.

**Counter pin work**
- Dashed selection box now extends to include the nub tip (was previously clipping it on the side opposite the bubble).
- During a resize handle drag the counter re-dispatches to `renderCounter` instead of falling through to the ellipse path, so the nub + number stay visible throughout the drag.
- Shift + press-and-drag on a committed (selected or not) counter orbits the bubble around the pinned nub tip — same math as creation-time Shift-twist. Tip stays planted, bubble swings around it.
- A quick Shift-click without dragging past ~3 px still toggles the counter in/out of multi-selection (symmetric with shape shift-click).
- Mid-drag: starting a plain move on a counter and then pressing Shift seamlessly switches to orbit mode (tip captured from the current dragged position); releasing Shift switches back to plain move — same slide → twist → slide pattern as creation.
- Double-click enters bbox edit mode. In that mode the dashed box hugs the whole pin (bubble + nub extension), rotates as a unit with the nub, and the rotation handle + angle pill float past the tip in the nub's direction. At 0° the nub points straight up and the pill sits above the bbox.
- The angle pill reads "0 = nub up" and writing a degree into it rotates the nub to that orientation. The bubble stays circular and the number never tips. Typed commits apply the -90° offset between the Fabric rotation-handle convention and the 3-o'clock-based nub direction, so the first pointermove after grabbing the handle no longer jumps 90°.

**Prop-flip wins**
- Print is now enabled in the PDF viewer (Cmd+P / native print dialog).
- Clickable hyperlink annotations are now active. The Electron `shell:openExternal` handler was already in place.

## Under the Hood (context for future-Claude; not user-facing)

- `getAnnotationWorldAABB(obj)` was added to `src/utils/svgBoundingBox.js`. Callers that need the rotated world AABB (currently only the multi-select group union in `SVGAnnotationLayer.jsx`) use this helper; `getAnnotationBBox(obj)` still returns the local pre-rotation bbox plus angle for the single-select overlay path (which applies rotation via SVG transform).
- `getCircleBBox(obj)` in the same file has a counter-specific branch. When `obj.data.type === 'counter'` it treats the body as a true circle (radius scaled by `scaleX` only), then extends the bbox toward `data.pointerAngle` by `max(5, r * 0.5)` so the nub tip is inside the frame. This is the pose-following bbox used by hit-tests and ordinary selection chrome.
- In bbox edit mode, the counter selection chrome overrides the bbox passed to `SVGSelectionOverlay`: it supplies a canonical (nub-up) bbox with `height = 2r + tipExtension` plus `angle = (pointerAngle + 90) mod 360` and a `rotationCenter` at the bubble center. The overlay's rotation transform rotates the dashed frame + handles as one, so the mtr rotation handle naturally lands at the nub direction. The counter renderer never honors `obj.angle`, so the bubble and number stay upright regardless of what the overlay's rotation transform says.
- Rotation handle drag for a counter writes `data.pointerAngle = (newAngle - 90 + 360) % 360`. `newAngle` is the `normalizeAngle(atan2(dy,dx))` output which is already in Fabric-convention degrees (0 = up, 90 = right); the -90° offset converts to the 3-o'clock-based `pointerAngle` the renderer reads. Live drag saves via `checkpointPolicy: 'skip'`; a single `normal` checkpoint fires on pointerup.
- Rotation pill read path has a counter branch in `SVGAnnotationLayer.jsx` that computes displayed angle as `(pointerAngle + 90) mod 360`. `handleRotationInputCommit` for counters skips the optimistic paint (there's no obj.angle-driven SVG rotation transform to mirror) and writes `data.pointerAngle = (typed - 90) mod 360`.
- `handleHandlePointerDown` in `useSVGInteraction.js` computes the rotation pivot (`cx`, `cy`) from the bbox center by default, but for counters it overrides to the bubble center so the pin rotates in place around the bubble (not around the bbox centroid, which would be offset toward the nub side).
- Shift-drag orbit on a committed counter is a distinct drag mode (`'counter-orbit'`) armed at pointerdown BEFORE the generic Shift-click-to-toggle branch. Pointermove does `skip`-checkpoint live saves of position + angle; pointerup either commits a `normal` checkpoint (if moved past ~3 px) or treats the gesture as a plain Shift-click toggle.
- PDF arrow detection maps any `OpenArrow` / `ClosedArrow` / `RClosedArrow` / `ROpenArrow` line-ending to `tool: 'arrow'` on import in `convertLineToFabricLine`. When only the START slot has the arrow ending, endpoints are swapped so the rendered arrowhead lands at `(x2, y2)` which is what the existing renderer assumes.

## Next Task — Group / Ungroup

Full design spec already exists at `docs/superpowers/specs/2026-04-18-group-ungroup-design.md`. That was the ticket that was blocked on the rotation/selection work last session; the counter + multi-select rework in this session further stabilized the selection pipeline, so it's still the right time to pick this up.

Suggested kickoff:
1. Read the design spec end-to-end before writing code.
2. Run `/gsd:discuss-phase` to open a new phase CONTEXT for it.
3. Respect the "Always Protected" list in `CLAUDE.md`: `src/App.jsx`, `src/components/PageAnnotationLayer.jsx`, `src/components/SVGAnnotationLayer.jsx`, `src/components/FabricEditCanvas.jsx`, `src/utils/svgAnnotationRenderers.jsx` require explicit waiver or phase-owned scope to touch. The group/ungroup feature will almost certainly need changes to `SVGAnnotationLayer.jsx` and probably `useSVGInteraction.js` — flag that in the phase CONTEXT.md and get a waiver up front.

## Other Candidates Still in the Backlog

Not urgent. Pick these up between phases if you want small palate-cleansers.

1. **Dead `MiniToolbar` code in `src/components/FabricEditCanvas.jsx`.** No shape routes to `editType: 'shape'` anymore but the `MiniToolbar` component + related state still live in the file. Mechanical cleanup. Safe.
2. **Dormant AutoCAD-reference code cleanup.** Plan already exists at `docs/superpowers/plans/2026-04-17-autocad-window-crossing-selection.md`.

## Working Tree State

Source from this session is committed. Uncommitted items are scaffolding that pre-dates the session:

- `.claude/`, `.npm-cache/`, `test-results/`, `TestLogs/`, `1.log` — local caches + logs.
- `dist/index.html` — build artifact (pre-existing tracked file).
- `.planning/phases/14-...-VERIFICATION.md`, `.planning/phases/15-...-VERIFICATION.md` — phase writeups.
- `docs/superpowers/specs/2026-04-18-group-ungroup-design.md` — next-phase design doc (commit when the phase kicks off).
- `docs/superpowers/specs/2026-04-18-proprietary-vs-bbox-handles-design.md`, `docs/superpowers/plans/2026-04-17-autocad-window-crossing-selection.md` — design/plan docs.
- `src/utils/calloutGeometryDiag.js`, `src/utils/shapeBleedDiagnostics.js` — pre-existing diagnostic modules.
- `pdf-counter-playground/` — playground dir.
- A deleted `.planning/phases/19-.../\.continue-here.md` from an earlier pause.

None of the above block starting Group / Ungroup.

## Setup Required

- Dev server: `npm run dev`, then `http://localhost:5173/`. Login details in `~/.claude/projects/-Users-isaiahcalvo-Desktop-Survey-BetaSafeS2/memory/credentials.md`.
- Canonical test PDF: `~/Desktop/SE-011 Security Shop Drawing Rev2 - 05.06.25.pdf`.
- Electron shell required for the Save Log button to append to `1.log`.

## Warnings

- Plain-English chat rule is ENFORCED. HANDOFF.md is exempt, in-conversation text is not.
- `RotationInputField.jsx` is off-limits to this session's Claude lane per memory — it belongs to the parallel 12-02 GSD workflow. If a future Group/Ungroup change seems to need that file, stop and ask the user before touching it.
- Counter rotation wiring has three convention boundaries: (a) `pointerAngle` (3-o'clock = 0, clockwise) in storage, (b) Fabric `normalizeAngle` output (12-o'clock = 0, clockwise) used by the rotation handle, (c) displayed pill value (nub-up = 0, clockwise). Any future change that writes an angle to a counter must pick the right conversion — the -90°/+90° offsets are load-bearing.
- `getAnnotationWorldAABB(obj)` is ONLY used by the multi-select group union. Do not swap it into `getAnnotationBBox`'s callers — the single-select chrome relies on receiving the local bbox + angle separately so it can apply rotation via SVG transform.

## Resume Instructions

1. Skim this handoff.
2. Open `docs/superpowers/specs/2026-04-18-group-ungroup-design.md` and read it end-to-end.
3. Run `/gsd:discuss-phase` to open a new phase CONTEXT for Group / Ungroup. Include a `DO NOT CHANGE` list that carves out a waiver for the SVG interaction files you'll need, and lock the acceptance criteria Given/When/Then before any code lands.
