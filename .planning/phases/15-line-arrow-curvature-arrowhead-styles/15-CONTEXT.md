# Phase 15: Line/Arrow Curvature + Arrowhead Styles - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire the already-ported `src/utils/lineGeometry.js` curvature math (`getCurvedPath`, `getCurveEndAngle`, `shouldSnapToLinear`, `getControlPoint`) into the SVG renderers + `useSVGInteraction.js` (as a new `'midpoint'` drag mode), and lift the 6-style arrowhead enum from the callout system (`src/components/Callout/types.js:ARROWHEAD_STYLES`) into the line/arrow data model + render.

**In scope:** LINE-01, LINE-02, LINE-03, ARROW-01, ARROW-02, ARROW-03, ARROW-04.

**Out of scope (phase boundary guardrail — all belong to later phases or lanes):**
- Curvature-indicator pill (hover-reveal typeable pill near midpoint) — **Phase 16** (LINE-04, ARROW-05).
- Line/arrow mini-toolbar (color / thickness / arrowhead picker UI) — **Phase 16** (LINE-06, ARROW-07).
- Arrowhead style **picker UI** — **Phase 16**. Phase 15 ships data model + renderer; styles are readable/writable programmatically and render correctly.
- Minimum-drag-length creation threshold — **Phase 16** (LINE-05, ARROW-06).
- Any callout collision / rollback / resize / auto-routing / hover / self-destruct work — **Phases 17-18**.
- Cleanup of the 5 null-stub Callout files from Phase 14 — **separate cleanup lane**, not Phase 15.
- Rewrite of `lineGeometry.js` — it is **CONSUME ONLY**. Math is already correct.

</domain>

<decisions>
## Implementation Decisions

### Area 1 — Midpoint curvature handle (visual + interaction)

- **Shape: same white-fill / blue-ring circle as the existing p1/p2 endpoint handles** (`SVGAnnotationLayer.jsx:1783-1803`), **smaller radius.** Endpoints use `r = 7 × √(inverseScale)`; midpoint handle uses `r = 5 × √(inverseScale)` (≈70% of endpoint size). Same `fill="#ffffff"`, `stroke="#4a90e2"`, `strokeWidth={1.5}`, `vectorEffect="non-scaling-stroke"`, same drop-shadow filter. The smaller-but-same-shape cue matches combined-tools convention and reads as "secondary control" next to the two endpoint handles.
- **Visibility: only when the line/arrow is selected.** Same rule as the existing endpoint handles — hovering an unselected line does NOT reveal the midpoint handle. Hover-reveal belongs to Phase 18 (callouts) and Phase 16 (curvature-pill), not here.
- **Cursor: `grab` / `grabbing`**, identical to the endpoint handles. All three line handles (p1 / midpoint / p2) share unified grab semantics so the user treats the whole line as a grabbable primitive.
- **No tether line between the straight baseline and the midpoint handle.** The handle sits directly on the curve at `t=0.5` (that's where `getCurvedPath`'s derivation makes the curve pass through the midpoint). No dashed "control-point tether" like vector-graphics editors. Cleaner.
- **Handle position at `t=0.5` on the curve**, not at the geometric mean of start/end. When curved, the midpoint handle IS the point the curve passes through. When straight, it coincides with the geometric midpoint anyway.
- **Drag dispatch: new `'midpoint'` handleId dispatched through the existing `handleHandlePointerDown` hook alongside `'p1'` and `'p2'`.** Four-place invariant applies in `useSVGInteraction.js`: (1) `dragStateRef` shape extended, (2) `handlePointerDown` picks up the new handleId, (3) `handlePointerMove` has a `'midpoint'` branch, (4) `handlePointerUp` commits via `shouldSnapToLinear` check.

### Area 2 — Snap-to-straight threshold & feedback

- **Silent snap — no visual indicator while dragging in the 10px threshold zone.** Line just straightens when the threshold crosses. Matches combined-tools behavior. No handle-color change, no curve-preview interpolation, no "sticky" animation. User "feels" the snap through the rendered curve going straight.
- **Auto-revert to straight with recomputed geometric midpoint** when an endpoint drag produces naturally collinear geometry (`shouldSnapToLinear(midpoint, newStart, newEnd) === true`). Clears `data.midpoint` from the annotation. Per **LINE-03** and **ARROW-03**. Next midpoint drag starts fresh from the geometric center of the new straight line.
- **Threshold is 10px in SVG units (page coordinates)**, not screen pixels. Matches the `shouldSnapToLinear(midpoint, start, end, threshold=10)` port default. At 50% zoom the threshold looks ~5px on screen; at 200% it looks ~20px. Consistent with how the rest of the annotation math operates in page coords.
- **Drag-snap threshold (10px) and render hysteresis (1px) are hardcoded constants inside `lineGeometry.js`** — not tunable per-annotation, per-tool, or via settings. Keeps the pure math library pure. `shouldSnapToLinear` already accepts `threshold` as an arg — Phase 15 callers pass the default; tunability stays available for future phases without exposing it now.
- **Render hysteresis (1px):** distinct from the drag-snap threshold. When rendering, if `distanceToLineSegment(midpoint, start, end) <= 1`, the renderer emits a plain `<line>` instead of a curved `<path>`, even if `data.midpoint` is still set. Prevents visible "1-pixel curve" artifacts from floating-point noise. During an active drag the 10px snap actually clears the midpoint; the 1px hysteresis protects the idle-render path.

### Area 3 — Arrowhead style system (data model, sizing, render dispatch)

- **`arrowheadStyle` is the single source of truth for head rendering; `tool` field stays as-drawn.** A line drawn with the line tool stays `tool: 'line'` forever, but its `arrowheadStyle` field can be any of the 6 values. Renderer dispatches head rendering by `arrowheadStyle`, NOT by `tool`. Result: Phase 16's mini-toolbar can offer the same style picker equally to line and arrow annotations, and the 6 render paths are unified.
- **6 styles reused from `src/components/Callout/types.js:ARROWHEAD_STYLES`:** `NONE`, `SOLID_TRIANGLE`, `V_SHAPE`, `OPEN_CIRCLE`, `OPEN_TRIANGLE`, `HORIZONTAL_LINE`. Import the enum; do not redefine it. The enum values (string literals) persist through save/reload exactly as the callout field does.
- **Head-size base formula: `headSize = max(8, strokeWidth * 3)`** — same formula currently used by `renderLine` in `svgAnnotationRenderers.jsx:163`. All 6 styles scale their geometry proportionally from this base (triangle width, circle radius, V-shape legs, horizontal-bar length). Preserves visual consistency with existing arrows pre-Phase 15 — user should not see existing arrow arrowheads suddenly grow or shrink.
- **New helper function: `renderArrowhead(style, tipX, tipY, angleDeg, strokeColor, strokeWidth)` in `src/utils/svgAnnotationRenderers.jsx`** returning a `<g>` of SVG elements. Called from `renderLine`'s arrow branch (replacing the current hardcoded `<polygon>` at `:177-181`) and reusable for future callouts/callsites. Keeps `renderLine` thin and testable in isolation.
- **Rendering defaults (fallback): renderer treats missing `arrowheadStyle` as `tool === 'arrow' ? 'SOLID_TRIANGLE' : 'NONE'`.** Loose contract — old annotations saved before Phase 15 (no field) render correctly. Phase 15 does NOT require `FabricDrawingCanvas.jsx` to tag new line/arrow JSON with `arrowheadStyle` at creation time — the renderer fallback covers new and old data uniformly. This avoids the narrow-lane FabricDrawingCanvas waiver the ROADMAP flagged as optional.
- **Curved-arrow tangent swap (ARROW-01/02/03):** when `data.midpoint` is present, `renderArrowhead` is called with `angleDeg = getCurveEndAngle(start, end, midpoint)` instead of `Math.atan2(dy, dx) * 180/π`. Arrowhead rotates to the curve's tangent at t=1. Straightening (midpoint cleared or within render hysteresis) returns the tangent to the linear start→end angle automatically because the renderer re-enters the straight-line branch.
- **Line + path rendering branch:** when `data.midpoint` is present, renderer emits `<path d="M x1 y1 Q cx cy x2 y2">` where `(cx, cy) = getControlPoint(start, end, midpoint)`. When `data.midpoint` is absent (or within 1px render hysteresis), renderer emits the existing `<line>` — zero regression for straight-line annotations.

### Area 4 — Verification strategy

- **Manual JSON edit + reload is the primary verification path for ARROW-04 (6 styles).** Write a curved-arrow annotation with each of the 6 `arrowheadStyle` values directly in saved JSON, reload the PDF, visually confirm each renders correctly at straight and curved tangent angles. Matches ROADMAP note. No temporary dev-only picker / key-shortcut UI in Phase 15 — Phase 16's mini-toolbar is the real picker.
- **Smoke Playwright coverage: one scenario per success criterion** (≈5 new scenarios): curve creation via midpoint drag, endpoint-preserves-midpoint under curved drag, auto-snap-to-straight via proximity, curved-arrow tangent, no-regression straight line visual parity. Plus manual UAT with `Package 2 - Rev 4 -- IC.pdf` at Page 6 per project memory. Grows the 113-test baseline modestly (~5 tests).
- **No-regression on straight lines/arrows verified via visual-regression screenshot, before vs after Phase 15.** Take a Playwright screenshot of a few straight lines and arrows on Page 6 BEFORE starting Phase 15 implementation (as part of the plan kickoff). After Phase 15 ships, re-capture and diff. Any visual delta on straight lines is a bug. Definitive proof the `<line>` branch is untouched when `data.midpoint` is undefined.
- **Cleanup of 5 null-stub Callout files is NOT included in Phase 15.** Phase 15 consumes `ARROWHEAD_STYLES` from `src/components/Callout/types.js` — that shim file must stay. The other 4 stubs (CalloutCanvas, CalloutComponent, CalloutContextMenu, CalloutEditModal, index.jsx) depend on PAL + App.jsx no longer importing from `./components/Callout` — a separate cleanup lane, not Phase 15's concern.

### Claude's Discretion

- **Plan decomposition.** Phase 15 likely fits in 1-2 plans (single plan if the midpoint drag + render branch + arrowhead helper decompose cleanly; two plans if the arrowhead system is large enough to ride its own lane after curvature lands first). Planner's call, not locked here.
- **Data layout of `data.midpoint`.** Could live as `obj.midpoint = { x, y }` directly on the Fabric Line JSON, or inside a `data: { midpoint: {x, y} }` sub-object — choose whichever keeps CUSTOM_PROPS list tidy. Saved coords are absolute page coordinates (not normalized, not relative to bbox).
- **Bounding-box recomputation for curved paths.** For curved `<path>`, the SVG `getBBox` on the element yields the tight bbox including the curve bulge. For coordinate-space calcs (selection outline, hit-test), Claude chooses whether to (a) call `getBBox` on the rendered path, (b) compute the bbox analytically from start/end/midpoint/control-point, or (c) approximate from the 3 points. Recommended: (b) analytical, because it's deterministic and works even when the path isn't yet rendered (creation preview, selection-outline pre-mount).
- **Live-commit vs checkpoint policy for midpoint drag.** Endpoint drag uses `checkpointPolicy: 'skip'` with live JSON commits (see `useSVGInteraction.js:462-466`). Midpoint drag should follow the same pattern for consistency: live commits on every `pointermove`, single checkpoint on `pointerup`. Planner verifies this is consistent with the Phase 12-03 optimistic-paint pattern.
- **Exact helper signature / naming for `renderArrowhead`.** Suggested `renderArrowhead(style, { tipX, tipY, angleDeg, strokeColor, strokeWidth })`; planner may vary.
- **Line-child position inside a `type: 'group'` arrow (pre-unification arrow format).** Some existing arrows may be stored as Fabric `Group { objects: [Line, Triangle] }` (see `renderArrow` at `svgAnnotationRenderers.jsx:209`). Phase 15 renderer path needs to handle both `type: 'line' + tool: 'arrow'` (current default) and the legacy group format. Claude chooses whether to upgrade legacy groups to flat lines at load-time or keep both render paths.

</decisions>

## Acceptance Criteria

- **Given** a saved straight line with no `data.midpoint` field, **when** the SVG renderer mounts it, **then** it renders via the existing `<line>` branch at byte-identical visual output to v2.2 — no rendering delta confirmed via before/after Playwright screenshot diff.
- **Given** a line is selected, **when** the user inspects the selection overlay, **then** three handles are visible: p1 endpoint, midpoint (smaller circle, `r = 5 × √inverseScale`), p2 endpoint, all at the same white-fill/blue-ring style with `cursor: grab`.
- **Given** a selected straight line, **when** the user drags the midpoint handle more than 10px off the straight baseline, **then** the line renders as `<path d="M x1 y1 Q cx cy x2 y2">` with `(cx, cy) = getControlPoint(start, end, midpoint)` and the curve visibly passes through the handle position (t=0.5).
- **Given** a curved line with `data.midpoint` set, **when** the user drags the midpoint handle back within 10px of the straight start→end baseline, **then** the line auto-snaps straight: `data.midpoint` is cleared, renderer re-enters the `<line>` branch, and the midpoint handle snaps to the geometric center of the new straight line.
- **Given** a curved line/arrow, **when** the user drags the p1 or p2 endpoint to a new position, **then** the curve reshapes with `data.midpoint` held fixed in absolute page coords; if the resulting `shouldSnapToLinear(midpoint, newStart, newEnd) === true`, the annotation auto-reverts to straight with recomputed geometric midpoint.
- **Given** an arrow with `data.midpoint` set, **when** the renderer mounts it, **then** the arrowhead is rotated by `getCurveEndAngle(start, end, midpoint)` degrees (tangent at t=1), not by the straight start→end angle; straightening returns the arrowhead to the linear tangent without a separate code path.
- **Given** a saved line or arrow with `arrowheadStyle = 'V_SHAPE'` (or any of the 6 values), **when** the renderer dispatches the head, **then** `renderArrowhead('V_SHAPE', tipX, tipY, angleDeg, strokeColor, strokeWidth)` emits the correct SVG geometry at `headSize = max(8, sw × 3)`, scaling proportionally to stroke width.
- **Given** a line or arrow with NO `arrowheadStyle` field (legacy pre-Phase-15 data), **when** the renderer mounts it, **then** the head fallback `arrowheadStyle ?? (tool === 'arrow' ? 'SOLID_TRIANGLE' : 'NONE')` applies and the annotation renders identically to v2.2 visual output.
- **Given** Phase 15 has shipped, **when** the 113-test Playwright baseline + ≈5 new Phase 15 smoke tests run, **then** all 118 tests pass (no regression to rotation handle, shape edit, pen/eraser, text editing, zoom behavior, or callout render path from Phase 14).

## DO NOT CHANGE

Files outside Phase 15's scope — touching any of these without an explicit per-file user waiver is a boundary violation:

**Always-Protected (project-wide, per `CLAUDE.md`):**
- `src/App.jsx` — no waiver expected for Phase 15. All line/arrow curvature work happens inside `SVGAnnotationLayer.jsx`, `useSVGInteraction.js`, and `svgAnnotationRenderers.jsx`. If a waiver is needed (e.g., for a new prop on the SVG layer mount site), flag loudly at plan CONTEXT time.
- `src/components/PageAnnotationLayer.jsx` — PAL is the only current consumer of `src/utils/lineGeometry.js`. Do NOT entangle PAL with the new SVG-side wiring. Leave PAL's curved-line codepath alone.
- `src/components/FabricEditCanvas.jsx` — no line/arrow edit-mode entry in Phase 15. Untouched.
- `src/components/FabricEraserCanvas.jsx` — untouched.
- `src/components/FabricDrawingCanvas.jsx` — no waiver expected. Decision captured above: renderer handles default arrowheadStyle, no creation-time tag needed. Do NOT remove or rename the `zoomGeneration` signal.
- `package.json`, `vite.config.js` — untouched.

**Phase-15-specific DO NOT CHANGE:**
- `src/utils/lineGeometry.js` — **CONSUME ONLY, do not rewrite.** `getCurvedPath`, `getCurveEndAngle`, `shouldSnapToLinear`, `getControlPoint`, `projectPointToLine`, `distanceToLineSegment`, `getMidpoint`, `getPointOnCurve`, `getCurveStartAngle` are already correct ports of combined-tools math. If a bug surfaces, fix at the call site or file a follow-up issue — do not rewrite the math.
- `src/components/Callout/types.js` — the `ARROWHEAD_STYLES` enum and label map are CONSUMED by Phase 15 and MUST NOT be modified. The rest of the file (createCallout factory, defaults) is legacy callout domain — leave it alone. When Phase 15 imports the enum, it imports only the exported `ARROWHEAD_STYLES` constant.
- `src/components/Callout/CalloutCanvas.jsx`, `CalloutComponent.jsx`, `CalloutContextMenu.jsx`, `CalloutEditModal.jsx`, `index.jsx` — null-render stubs from Phase 14. Do NOT delete in Phase 15 (separate cleanup lane). Do NOT re-expand.
- SVGAnnotationLayer zones adjacent to the line-type handle branch: rotation-handle / counter / callout zones. Line-type handle edit is bounded to `:1763-1806`.
- Working-tree WIP carried over from Phase 14 session (App.jsx tool-switch diagnostics + SVGAnnotationLayer polygon/polyline PDF import) — belongs to separate lanes. Phase 15 should NOT commit or revert this as a side effect; decide stance before starting implementation.

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 15 specification
- `.planning/ROADMAP.md` §"Phase 15: Line/Arrow Curvature + Arrowhead Styles" — goal, dependencies, boundary notes, 5 success criteria, why-these-seven-together rationale.
- `.planning/REQUIREMENTS.md` §"v2.3 Requirements → Line Tool" (LINE-01, LINE-02, LINE-03) and §"Arrow Tool" (ARROW-01, ARROW-02, ARROW-03, ARROW-04) — requirement statements with acceptance criteria.

### Math library (CONSUME ONLY)
- `src/utils/lineGeometry.js` — full port of combined-tools' line/curve math. Phase 15 consumes: `getCurvedPath` (quadratic bezier SVG path), `getCurveEndAngle` (tangent at t=1 for arrowhead rotation), `shouldSnapToLinear` (10px threshold), `getControlPoint` (control-point math), `projectPointToLine`, `distanceToLineSegment`, `getMidpoint`, `getPointOnCurve`, `getCurveStartAngle`.

### Arrowhead enum (CONSUME ONLY)
- `src/components/Callout/types.js:9-16` — `ARROWHEAD_STYLES` constant (NONE / SOLID_TRIANGLE / V_SHAPE / OPEN_CIRCLE / OPEN_TRIANGLE / HORIZONTAL_LINE) + label map `:18-25`.
- `src/components/Callout/CalloutComponent.jsx:951-1089` — legacy arrowhead render switch for all 6 styles. Reference only for geometry — Phase 15 implements its own `renderArrowhead` helper with proportional `max(8, sw × 3)` sizing, not callout's sizing formulas.

### Existing integration points
- `src/utils/svgAnnotationRenderers.jsx:141-199` — `renderLine` function, current straight line + hardcoded arrow-head polygon path. Phase 15's curved-path branch + `renderArrowhead` helper go here.
- `src/utils/svgAnnotationRenderers.jsx:209-` — `renderArrow` function for Fabric Group arrow format. Legacy path — verify behavior for any `type: 'group'` + arrow annotations that may exist in saved data.
- `src/components/SVGAnnotationLayer.jsx:1763-1806` — line-type selection-wrapper branch with p1/p2 endpoint handles. Phase 15 adds the midpoint handle inside this branch.
- `src/hooks/useSVGInteraction.js:427-466` — current `'endpoint'` drag mode in `handlePointerMove`. Phase 15 adds the parallel `'midpoint'` branch following the same live-commit + `checkpointPolicy: 'skip'` pattern.
- `src/hooks/useSVGInteraction.js:748-764` — current `'endpoint'` commit in `handlePointerUp`. Phase 15 adds a parallel `'midpoint'` commit that also applies `shouldSnapToLinear` for auto-clear of `data.midpoint`.
- `src/hooks/useSVGInteraction.js:926-966` — `handleHandlePointerDown` dispatch for `p1` / `p2`. Phase 15 extends to `'midpoint'`.

### Phase 14 patterns that carry forward
- `.planning/phases/14-unified-svg-callout-render-shared-tool-foundation/14-CONTEXT.md` §"Claude's Discretion" and §"Area 3" — four-place invariant for new drag modes, data-attribute event delegation, optimistic-paint commit pattern from Phase 12-03.
- `.planning/research/COMBINED-TOOLS-AUDIT.md` and `.planning/research/CURRENT-REPO-AUDIT.md` — full dual-codebase port audit. Phase 15 math is the "pure port" section.

### Project-wide guardrails
- `CLAUDE.md` §"CRITICAL — DO NOT BREAK" — canvas-container-aware sizing (not relevant to Phase 15 SVG-only work, but noted); `zoomGeneration` signal contract (not to be removed); SVG viewBox handles zoom scaling (no JS zoom coordination).
- `CLAUDE.md` §"Gotchas" 2026-04-08 — Fabric.js Textbox fontFamily must be a single font name (not relevant to Phase 15, which does not touch text).
- `~/.claude/CLAUDE.md` §"GSD Phase Discipline" — Acceptance Criteria + DO NOT CHANGE sections mandatory; RECONCILIATION.md at phase close mandatory.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/utils/lineGeometry.js`** — all required math (`getCurvedPath`, `getCurveEndAngle`, `shouldSnapToLinear`, `getControlPoint`) already ported. Import and call.
- **Endpoint-handle render pattern** at `SVGAnnotationLayer.jsx:1783-1803` — `r = 7 × √inverseScale`, `fill="#ffffff"`, `stroke="#4a90e2"`, `vectorEffect="non-scaling-stroke"`, drop-shadow filter, `cursor: grab`, `e.stopPropagation()` + `handleHandlePointerDown(e, handleId)`. Midpoint handle copies this shape with smaller radius.
- **Endpoint drag state machine** at `useSVGInteraction.js:427-466` + `:748-764` + `:926-966` — four-place invariant template: `dragStateRef` shape, `handlePointerDown` mode wiring, `handlePointerMove` branch, `handlePointerUp` commit. Midpoint drag follows the same pattern with a `'midpoint'` mode.
- **`ARROWHEAD_STYLES` enum** at `Callout/types.js:9-16` — 6 string-literal values. Import directly.
- **Data-attribute event delegation** — Phase 13 `data-rotation-handle="mtr"` and Phase 14 `data-callout-id` / `data-callout-part`. If the midpoint handle dispatches via event delegation (rather than direct `onPointerDown` binding), use `data-handle="midpoint"` on the circle element.

### Established Patterns
- **Optimistic-paint commit (Plan 12-03).** Live JSON commits on every `pointermove` with `checkpointPolicy: 'skip'`; single checkpoint at `pointerup`. Applied to rotation, endpoint drag, and callout-part drag. Midpoint drag follows suit.
- **`vector-effect: non-scaling-stroke`** on handle strokes so the visual weight is constant across zoom levels.
- **`e.stopPropagation()` before dispatch** on handle pointer events so Syncfusion doesn't see SVG events (SVGAnimatedString crash).
- **Handle radius dampening: `Math.sqrt(inverseScale)`**, not raw `inverseScale`. Handles shrink more gracefully as the user zooms in, matching the SVGSelectionOverlay convention at `:1773`.

### Integration Points
- **`renderLine` in `svgAnnotationRenderers.jsx`** — switch on `data.midpoint` presence: `<path d="M Q">` branch (with `renderArrowhead` for arrows) vs existing `<line>` branch.
- **Selection overlay in `SVGAnnotationLayer.jsx`** — the line-type branch at `:1763-1806` adds a third `<circle>` at the midpoint position (computed at `t=0.5` from the curve or geometric center if straight).
- **Drag dispatch in `useSVGInteraction.js`** — `handleHandlePointerDown` accepts `'p1' | 'p2' | 'midpoint'`.
- **Save path** — `onSaveAnnotations(updatedAnnotations, { source: 'object:modified', action: 'midpoint-move', checkpointPolicy: 'skip' })` during drag, commit checkpoint at `pointerup`.

</code_context>

<specifics>
## Specific Ideas

- **Combined-tools convention for midpoint handle**: smaller-than-endpoint circle. Confirmed by user preference. No tether line from baseline to handle — the handle sits on the curve at t=0.5, which is intuitive.
- **Silent snap feel** is intentional — no color feedback, no "magnetic" animation. The curve going straight IS the feedback.
- **6-style arrowhead sizing** stays anchored on the existing `max(8, sw × 3)` formula so pre-Phase-15 arrows are visually unchanged when re-rendered after Phase 15 ships. No cross-tool visual unification with callout arrowheads in Phase 15 — that's a future concern.
- **Verification is JSON-edit + reload + visual snapshot** — no temporary picker UI. Keeps Phase 15 free of throw-away code.
- Test PDF: `Package 2 - Rev 4 -- IC.pdf` at Page 6 (per project memory — known-good test setup).

</specifics>

<deferred>
## Deferred Ideas

- **Curvature-indicator pill + typeable curvature input** — Phase 16 (LINE-04, ARROW-05). Mirrors v2.1 `RotationInputField` + `applyOptimisticRotation` pattern verbatim.
- **Line/arrow mini-toolbar** (color / thickness / arrowhead picker) — Phase 16 (LINE-06, ARROW-07).
- **Minimum-drag-length creation threshold** — Phase 16 (LINE-05, ARROW-06). Prevents zero-length degenerate line/arrow creation on accidental tool clicks.
- **Cross-tool arrowhead visual parity** (line/arrow heads sized to match callout heads on the same page) — not in v2.3 scope. Each tool sizes its own heads from its own strokeWidth.
- **User-configurable curvature-snap threshold** — not in scope. Constants stay hardcoded at 10 / 1 in `lineGeometry.js`.
- **Handle z-order polish for overlapping lines** — not in scope. If two selected lines have handles overlapping at the same point, natural SVG paint order applies. Revisit if UAT surfaces a real-world collision.
- **Cleanup of the 4 non-enum null-stub Callout files** (`CalloutCanvas.jsx`, `CalloutComponent.jsx`, `CalloutContextMenu.jsx`, `CalloutEditModal.jsx`, `index.jsx`) — separate cleanup lane, blocked on PAL + App.jsx removing their `./components/Callout` imports. Phase 15 keeps `types.js` as the shim for `ARROWHEAD_STYLES`.
- **Temporary dev-only 6-style picker / keyboard shortcut** for faster iteration during Phase 15 — rejected. Manual JSON edit + reload is acceptable. Real picker ships in Phase 16.

</deferred>

---

*Phase: 15-line-arrow-curvature-arrowhead-styles*
*Context gathered: 2026-04-16*
