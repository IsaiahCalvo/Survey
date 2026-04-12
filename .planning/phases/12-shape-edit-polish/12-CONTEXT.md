# Phase 12: Shape Edit Polish - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Shape rotation feels precise and predictable, and the usable zoom range extends down to 10% for whole-page inspection. Three requirements in one phase:

1. **EDIT-11** — Soft Shift-snap to 45° increments on SVG shape rotation with a 3° threshold
2. **EDIT-12** — Inline numeric degree input field near the rotation handle for typed-angle commits
3. **ZOOM-09** — Lower the zoom floor from 50% to 10% on every zoom entry point

All work sits inside the v2.0 architecture (SVG display + Fabric.js edit-only + zero-timer zoom). No new dependencies, no data-model changes, no Syncfusion-viewer-layer changes.

</domain>

<decisions>
## Implementation Decisions

### EDIT-11 — Soft Shift-snap (LOCKED from research)

- Apply snap inside `src/hooks/useSVGInteraction.js:391-408` (rotate branch of `handlePointerMove`) — the ONLY SVG rotation integration point
- Promote `const newAngle` → `let newAngle` on line 396 so the snap can reassign it
- Snap formula: `if (e.shiftKey && Math.abs(newAngle - nearest45) <= 3) newAngle = nearest45 % 360` — soft threshold, not hard snap
- Shift at 41° stays free at 41° (outside 3° band)
- Shift at 44° snaps to 45° (inside 3° band)
- Shift at 23° stays free at 23° (outside 3° band)
- Releasing Shift always returns to free rotation
- `% 360` wrap is defensive: `Math.round(350/45)*45 = 360` becomes `0`, avoiding a persisted 360° value
- Mid-drag modifier behavior: Shift pressed/released mid-drag takes effect on the NEXT pointer move, not instantly. Matches Figma / Illustrator / Excalidraw convention. This is accepted behavior, not a defect.
- **Fabric edit path is OUT of scope** — shape rotation in `FabricEditCanvas.jsx` is commit-lossy (`loadShapeAnnotation` force-zeros angle on load at line 1036, `commitAndClose` restores pre-edit angle at 476-477). Adding `obj.snapAngle = 45` there would have zero user-visible effect.
- **PAL legacy rotation path is OUT of scope** — `src/PageAnnotationLayer.jsx:6080-6355` has a second rotation implementation gated on Pan tool + modifier key; not on the primary v2.0+ flow.

### ZOOM-09 — Zoom floor 10% (LOCKED from research)

- **ATOMIC two-file commit** — must land in the SAME commit:
  - `src/utils/zoomController.js:15` — `const MIN_SCALE = 0.5;` → `const MIN_SCALE = 0.1;`
  - `src/App.jsx:21999` — `Math.min(Math.max(parsed, 50), 500)` → `Math.min(Math.max(parsed, 10), 500)` inside `commitZoomInput`
- Splitting the commit leaves a broken intermediate state (typing `10` in the zoom input silently clamps to 50 via the pre-clamp)
- **Literal-swap only** — do NOT restructure `commitZoomInput`'s pre-clamp, do NOT delete the guard, do NOT introduce a helper. Change exactly one token.
- Every zoom entry point funnels through `clampScale` (22 call sites in App.jsx verified) — zero additional integration points
- Syncfusion's `coerceZoom` already accepts `[10, 1000]` — no viewer-side change needed
- No scale-division blow-ups at 0.1 (exhaustive grep verified — all `/scale` sites produce finite amplified values)
- `non-scaling-stroke` + inverseScale handle sizing mean pen strokes stay visible and handles stay constant-size at 10% zoom
- **Handles at <25% zoom are hard to target** — this is accepted table-stakes behavior matching Illustrator/Photoshop/Excalidraw. The user is expected to zoom back in to edit. NOT a defect. Record in RECONCILIATION.md as a known carry-forward so future sessions don't relitigate.

### EDIT-12 — Rotation degree input field (NEW decisions this session)

**Integration architecture:**
- **HTML portal, absolute-positioned** — new `RotationInputField.jsx` React component portaled to the page overlay div, positioned via CSS transforms from screen-space coords computed with `getBoundingClientRect()` on the rotation handle
- Native HTML `<input>` avoids SVG `<foreignObject>` focus/IME quirks and avoids the counter-rotation math that embedding inside the SVG `<g>` would require
- Lives as a sibling to `SVGAnnotationLayer` inside the same overlay container, rendered by the parent that already wires `SVGSelectionOverlay` and `useSVGInteraction`
- Component receives: `{ bbox, angle, annotationIndex, onCommit, inverseScale, handleRef }` — reads the handle's client rect to position itself
- Position recomputed on every `handlePointerMove` tick during rotation drag (cheap — one getBoundingClientRect call) so the input tracks the handle as it orbits the shape

**Visibility policy:**
- **Appears on rotation-drag start** — user clicks the mtr handle and starts dragging → input appears above the handle immediately, live-updating the angle as the shape rotates
- **Appears on mtr handle hover** — cursor enters the handle for >150ms → input appears. Gives the user a way to type without drag-rotating first.
- **Stays visible on handle leave** — 500ms grace period after cursor leaves the handle, so the user has time to move ~100px to the input and click into it. If cursor enters the input within 500ms, stays visible until focus is lost. Matches tooltip/menu hover-intent conventions.
- **Disappears** — on rotation commit + input blur + grace period expiry + click outside both the handle and the input
- Tracked via visibility state in the parent (not CSS `:hover`), since mtr handle is SVG and input is portaled HTML — `:hover` / `:focus-within` can't bridge the two

**Interaction semantics:**
- **Enter** = commit the typed value, normalized to `[0, 360)`, applied atomically to `obj.angle`
- **Escape** = cancel, revert to pre-edit angle, release focus
- **Blur** (Tab away, click elsewhere) = commit (matches Figma/Excalidraw inline input convention)
- **Invalid input** (non-numeric, empty) = silently revert on commit/blur
- **Mid-drag drag wins** — if user is actively dragging the rotation handle while the input has focus, the drag's live angle overwrites the typed value character-by-character. Drag always wins.
- **Shift-snap applies to drag only, never to typed values** — typing `44` into the input with Shift held still commits `44°`, not `45°`. Snap is a gesture modifier, not a value filter.

**Positioning & tracking:**
- **16px above mtr handle, in screen space**, always upright (never rotates with the shape)
- Tracks the rotation handle during drag — position recomputed on every pointer move from `handleRef.current.getBoundingClientRect()`
- Clamped to the PDF page viewport — if the handle is near the page edge, the input shifts to stay on-screen
- Position stays fixed relative to the viewport during keyboard nudging (no animation)

**Number format:**
- **Integer degrees only** — display and accept whole numbers 0-359
- Live-updating rotation rounds to nearest integer in the input display
- Internal angle stays as float — only the input's rendered value rounds
- Matches engineering-drawing intuition (target users are mechanical/electrical engineers)

**Keyboard nudging (inside the focused input):**
- **Arrow Up/Down** = ±1° increment, commits immediately
- **Shift+Arrow Up/Down** = ±45° increment (reuses the phase's 45° constant), commits immediately
- Scoped to the focused input — no global keyboard listeners, no conflict with Arrow keys anywhere else
- The Cmd+Arrow annotation-move shortcut the user mentioned is DEFERRED to a future phase (see <deferred>)

**Styling:**
- **Match existing toolbar/panel input style** — reuse the app's font family, border-radius, colors from current toolbar inputs
- Small pill-shaped field, ~60px wide, `°` suffix, subtle shadow
- Planner will scout `src/components/toolbar/**` and `src/sidebar/**` for existing input patterns during planning

### Claude's Discretion

- Exact grace-period state machine (timers vs React state + setTimeout)
- Whether to use a shared `useRotationInputVisibility` hook or inline the state in the parent
- Whether the input is always mounted with `display: none` / `opacity: 0` or conditionally rendered — whichever produces less flicker
- Debounce tuning for the hover-intent 150ms open delay and 500ms close grace period if they feel wrong in the dev server
- Exact z-index stacking for the input portal relative to SVGAnnotationLayer and Syncfusion page controls
- IME handling nuances for typed values (target users are US English — not a primary concern)
- Component file location: `src/components/RotationInputField.jsx` is the likely home but planner may place it alongside `SVGSelectionOverlay.jsx` if that matches conventions

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 12 requirements
- `.planning/REQUIREMENTS.md` — EDIT-11 (soft Shift-snap + 3° threshold), EDIT-12 (rotation degree input field), ZOOM-09 (zoom floor 10%)
- `.planning/ROADMAP.md` — Phase 12 goal, success criteria, dependency on Phase 11
- `.planning/PROJECT.md` — v2.1 milestone goal, Stage 0 scope boundary

### Phase 12 research (directly informs planning)
- `.planning/research/ARCHITECTURE.md` — exact integration points for EDIT-11 + ZOOM-09, file+line verification, exhaustive dependency sweep, reasoning for dropping Fabric-edit snap
- `.planning/research/PITFALLS.md` — 8 pitfalls with warning signs and recovery strategies, full 8-minute smoke test, "looks done but isn't" checklist
- `.planning/research/FEATURES.md` — competitor convention matrix, "just ship it" guidance, edge-case handling for low-zoom handles
- `.planning/research/STACK.md` — initial LOC estimate (~11 LOC, superseded by ARCHITECTURE.md's ~5 LOC for EDIT-11 + ZOOM-09; EDIT-12 adds ~60-120 LOC)
- `.planning/research/SUMMARY.md` — executive summary of all four research streams

### Prior phase context (patterns to follow)
- `.planning/phases/11-text-shape-editing-zoom-cleanup/11-CONTEXT.md` — FabricEditCanvas component architecture, Canvas mount/unmount discipline, zoomGeneration signal contract
- `.planning/phases/09-svg-selection-interaction/09-CONTEXT.md` — SVG selection, handle sizing via inverseScale, useSVGInteraction patterns
- `.planning/phases/08-svg-display-foundation/08-CONTEXT.md` — SVG rendering patterns, viewBox auto-scaling, non-scaling-stroke invariant

### Project-level discipline
- `CLAUDE.md` — "Always Protected" file list, container-aware sizing requirement, zoomGeneration signal rule, two existing gotchas (font fallback stacks, Canvas/SVG rasterizer differences)
- `.planning/STATE.md` — accumulated v2.1 decisions (research-first approach, 3° soft snap, EDIT-12 is a scope expansion, commit-lossy Fabric rotation, handles-at-low-zoom accepted)

### Exact integration points (verified, file:line)
- `src/hooks/useSVGInteraction.js:391-408` — rotate branch of `handlePointerMove` (EDIT-11 integration point)
- `src/hooks/useSVGInteraction.js:559-568` — rotate commit branch in `handlePointerUp` (reads ds.currentAngle, writes to annotation JSON — already persists snapped values, no edit needed)
- `src/utils/zoomController.js:15` — `MIN_SCALE = 0.5` → `0.1` (ZOOM-09 primary)
- `src/utils/zoomController.js:23` — `clampScale` funnel (reads MIN_SCALE constant, no edit)
- `src/App.jsx:21999` — `commitZoomInput` pre-clamp `50` → `10` (ZOOM-09 companion, atomic with zoomController change)
- `src/components/SVGSelectionOverlay.jsx:175-202` — rotation handle (mtr) SVG group. EDIT-12 component needs a ref/handle to this group's `getBoundingClientRect()` to position the portaled input.
- `src/components/SyncfusionPDFContainer.jsx:29-33` — `coerceZoom` already clamps `[10, 1000]` — proves 10% is supported upstream

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/hooks/useSVGInteraction.js`: Existing rotation drag lifecycle. Already tracks drag state, center, current angle, and commits via `onSaveAnnotations`. EDIT-12 piggybacks on the existing pointer-move hook to drive live angle updates into the input.
- `src/components/SVGSelectionOverlay.jsx`: Rotation handle (mtr) rendered at lines ~175-202 as a `<circle>` + `<image>` group inside the selection `<g>`. Needs a ref export or a parent-owned pointer for `RotationInputField` to read its client rect.
- `src/utils/svgTransformMath.js:36` — `normalizeAngle(radians)` helper. Already returns `[0, 360)`. Input can call it directly for typed-value normalization.
- Existing toolbar/panel input styling (location TBD during planning scout): planner must find the canonical `<input>` style used by the app's sidebar/toolbar controls and reuse it so the rotation input feels native.

### Established Patterns
- **`inverseScale`-based sizing** — all SVG handles multiply dimensions by `inverseScale` to stay constant in screen space. RotationInputField uses HTML not SVG, so it's naturally constant-size regardless of viewBox.
- **`zoomGeneration` signal contract** — CLAUDE.md invariant. EDIT-12 is an SVG+HTML overlay addition, does NOT touch the signal, does NOT interact with Fabric.js Canvas mounting. No risk.
- **Container-aware sizing** — CLAUDE.md invariant. EDIT-12 reads client rects at interaction time (not `pageSize * scale`), so it naturally honors the rule.
- **`useSVGInteraction` as single source of rotation truth** — no duplicate rotation state. RotationInputField subscribes to the parent's live-angle state, driven by pointer-move events in the hook.
- **Atomic commits via `onSaveAnnotations`** — existing pattern. RotationInputField's commit path calls the same `onSaveAnnotations(updated, { source: 'rotation-input', action: 'rotate', checkpointPolicy: 'normal' })` used by the drag commit at line 559-568.

### Integration Points
- `SVGAnnotationLayer` parent owns: rotation state (from useSVGInteraction), selection state, inverseScale, bbox. Passes these to `SVGSelectionOverlay` (existing) AND to the new `RotationInputField` (new).
- RotationInputField → parent via `onCommit(annotationIndex, newAngle)` → parent calls `onSaveAnnotations`.
- RotationInputField reads live angle from parent state that's updated by `useSVGInteraction.handlePointerMove` rotate branch.
- Portal target: the existing overlay div that hosts `SVGAnnotationLayer` (per v1.0 Phase 1 — persistent direct children of Syncfusion page divs). Input portals into the same div so it inherits the page's coordinate frame.

</code_context>

<specifics>
## Specific Ideas

- "Input stays visible 500ms after cursor leaves the handle so the user has time to move ~100px to the input and click into it" — matches tooltip hover-intent conventions; not an arbitrary value.
- The user-facing mental model for snap: "Shift makes my rotation prefer multiples of 45°, but only when I'm nearly there. It doesn't hijack me."
- The user-facing mental model for the degree input: "When I hover the rotation handle, a little angle input appears. I can drag the handle to rotate freely, or I can click into the input and type an exact value, or I can use arrow keys to nudge by 1° and Shift+Arrow to jump 45°."
- Visual reference for the input styling: whatever existing toolbar/panel inputs the app already ships — the rotation input should feel like a first-class part of the toolkit, not a bolt-on debug overlay.
- Target user persona: mechanical/electrical engineer stamping shapes on blueprints. Their rotation intuition is 0°/45°/90°, not 15° — confirms the 45° snap increment choice over the Figma 15° convention.

</specifics>

<acceptance_criteria>
## Acceptance Criteria

**Given/When/Then bullets per CLAUDE.md phase discipline. Each is independently verifiable.**

### EDIT-11 — Soft Shift-snap

- **Given** a shape is selected and the user drags the rotation handle (mtr), **when** the free angle computes to 41°, **then** releasing the mouse commits `41` — Shift not involved, no snap.
- **Given** a shape is selected and the user holds Shift while dragging the rotation handle, **when** the free angle is 44°, **then** the committed angle is `45` — inside the 3° threshold, snap engages.
- **Given** a shape is selected and the user holds Shift while dragging the rotation handle, **when** the free angle is 41°, **then** the committed angle is `41` — outside the 3° threshold, snap does NOT engage even though Shift is held.
- **Given** a shape is selected and the user holds Shift while dragging the rotation handle, **when** the free angle is 23°, **then** the committed angle is `23` — far from any 45° increment.
- **Given** a shape rotation drag is in progress with Shift held and currently snapped to 90°, **when** the user releases Shift mid-drag and keeps dragging, **then** free float rotation resumes from 90° (no stickiness, no snap-back).
- **Given** a shape rotation drag is in progress with no modifier, **when** the user presses Shift mid-drag without moving the pointer, **then** no visible snap occurs until the next pointer move — accepted behavior matching Figma/Illustrator/Excalidraw.
- **Given** the snap produces `360` from Math.round near 360°, **when** the value is persisted, **then** the stored angle is `0` — `% 360` defensive wrap applied.
- **Given** a shape is selected and the user holds Shift while dragging a resize handle (corner), **when** the drag completes, **then** aspect-lock resize still works — the adjacent Shift-key branch at `useSVGInteraction.js:361` was NOT touched.

### EDIT-12 — Rotation degree input field

- **Given** a shape is selected, **when** the user hovers over the rotation handle for ~150ms, **then** a degree input field appears 16px above the handle displaying the current rotation angle (integer, 0-359).
- **Given** the degree input is visible from handle hover, **when** the cursor leaves the handle but enters the input within 500ms, **then** the input stays visible and accepts focus.
- **Given** the degree input is visible from handle hover, **when** the cursor leaves the handle AND does not enter the input within 500ms, **then** the input fades out.
- **Given** a shape is selected, **when** the user starts dragging the rotation handle, **then** the degree input appears immediately and live-updates with the integer-rounded current angle as the shape rotates.
- **Given** the rotation input has focus, **when** the user types a numeric value and presses Enter, **then** the value is normalized to `[0, 360)` and applied atomically to the annotation angle, the input loses focus, and the SVG re-renders at the new angle.
- **Given** the rotation input has focus, **when** the user presses Escape, **then** the input loses focus, the annotation reverts to its pre-edit angle, and the input closes.
- **Given** the rotation input has focus with a typed value, **when** the user clicks outside both the handle and the input (blur), **then** the typed value commits (Figma/Excalidraw convention).
- **Given** the rotation input has focus, **when** the user types a non-numeric or empty value and blurs, **then** the annotation silently reverts to the pre-edit angle.
- **Given** the rotation input has focus and displays `90`, **when** the user presses Arrow Up, **then** the angle commits to `91` immediately.
- **Given** the rotation input has focus and displays `90`, **when** the user presses Shift+Arrow Up, **then** the angle commits to `135` immediately (45° jump).
- **Given** the rotation input has focus with a typed value of `44`, **when** the user holds Shift during the next drag pointer move, **then** the typed `44` does NOT snap to `45` — snap is a drag-only gesture modifier, not a value filter.
- **Given** the rotation input is displayed and the shape is being dragged, **when** the user types into the input mid-drag, **then** the drag's live angle overwrites the typed value — drag always wins.
- **Given** the rotation handle is near the page edge at low zoom, **when** the input would render off-screen, **then** the input clamps to the page viewport and stays on-screen.
- **Given** zoom is ≥ 25%, **when** the input is visible, **then** it remains positioned correctly relative to the handle without overlapping other handles.
- **Given** zoom is < 25%, **when** the user hovers the rotation handle, **then** the handle may be hard to grab — this is accepted table-stakes behavior matching Illustrator/Photoshop. The input still appears when the user successfully hovers it.

### ZOOM-09 — Zoom floor 10%

- **Given** the zoom input field has focus, **when** the user types `10` and presses Enter, **then** the PDF zooms to 10% and the displayed value reads `10%` (no silent clamp to 50%).
- **Given** the current zoom is 12%, **when** the user presses Cmd+- (zoom-out keyboard shortcut), **then** the zoom decrements toward 10% without snapping back to 50%.
- **Given** the current zoom is 10% (at floor), **when** the user presses Cmd+- again, **then** the zoom stays at 10% (floor respected).
- **Given** the current zoom is 10%, **when** the user clicks Fit-to-page or Fit-to-width, **then** the zoom recomputes through `clampScale` and respects the new `[0.1, 5.0]` range.
- **Given** the current zoom is 10%, **when** the user scrolls the mouse wheel to zoom, **then** zoom behavior is smooth with no jitter at the 10% boundary.
- **Given** the current zoom is 10%, **when** a pen stroke annotation is rendered, **then** the stroke is visible at its authored thickness (via `non-scaling-stroke`).
- **Given** the current zoom is 10%, **when** a shape annotation is selected, **then** selection handles are visible (constant screen size via inverseScale) but may be hard to target — accepted.
- **Given** zoom is at any value in `[0.1, 5.0]`, **when** any zoom path is exercised, **then** no code path bypasses `clampScale` — verified by grep.

### Regression guards (no existing behavior breaks)

- **Given** a shape is selected and the user drags the rotation handle without Shift, **when** the drag completes, **then** the committed angle is a free float (no unintended snap).
- **Given** a shape is selected and the user holds Shift while dragging a corner resize handle, **when** the drag completes, **then** aspect-lock resize works exactly as before (the new `let newAngle` change did NOT affect line 361's Shift branch).
- **Given** any zoom entry point, **when** the scale is set, **then** the value funnels through `clampScale` (22 call sites verified).
- **Given** a Canvas is mounted for pen/eraser/text/shape editing, **when** the user zooms during the edit session, **then** the `zoomGeneration` signal still fires and the auto-commit + CSS transform + remount flow still works (EDIT-12 does NOT touch `zoomGeneration`).
- **Given** container-aware sizing is the invariant for all Fabric canvases, **when** the zoom floor drops to 10%, **then** `effectiveScale ≈ 0.1` is still computed from `offsetWidth / pageWidth` (not from `pageSize * scale`) — existing code respects this.

</acceptance_criteria>

<do_not_change>
## DO NOT CHANGE

**Files OUT of scope for this phase. Touching any of these is a boundary violation and requires an explicit user waiver.**

### Always Protected (CLAUDE.md project-wide)
- `src/App.jsx` — **SCOPED CARVE-OUT**: single-line edit at line 21999 only (`50` → `10` inside `commitZoomInput`'s pre-clamp). Every other line of App.jsx remains Always Protected. No other edits to App.jsx.
- `src/components/PageAnnotationLayer.jsx` — ~9,858-line Fabric.js canvas overlay. Contains a legacy modifier-rotate path at lines 6080-6355 — DO NOT add Shift-snap there even though it duplicates rotation math. That path is effectively dead in v2.0+.
- `src/PageAnnotationLayer.jsx` — thin region-polygon wrapper. Unrelated to this phase.
- `src/components/FabricDrawingCanvas.jsx` — pen/highlighter Canvas. Uses `zoomGeneration` contract, unrelated to rotation/zoom-floor.
- `src/components/FabricEraserCanvas.jsx` — eraser Canvas. Uses `zoomGeneration` contract, unrelated.
- `src/components/FabricEditCanvas.jsx` — **FULLY PROTECTED for this phase.** Shape rotation here is commit-lossy (force-zero on load at line 1036, pre-edit restore on commit at 476-477). Adding `snapAngle = 45` would have zero user-visible effect and violate the Always Protected boundary. STACK.md originally suggested adding snap here; ARCHITECTURE.md Q1c dropped that suggestion.
- `src/components/SVGAnnotationLayer.jsx` — SVG renderer. viewBox owns all zoom scaling, do NOT reintroduce JavaScript zoom coordination here.
- `package.json` / `vite.config.js` — infra. Zero new dependencies.

### Phase-specific DO NOT CHANGE
- `src/components/SVGSelectionOverlay.jsx` — read-only for this phase. EDIT-12 needs a ref to the rotation handle group but should NOT modify the overlay's rendering. If a ref is needed, add it as a minimal export pattern (one-line), NOT a rewrite. If the minimal-export approach requires more than 3 LOC in this file, re-discuss before editing.
- `src/components/SyncfusionPDFContainer.jsx` — verified: `coerceZoom` already clamps `[10, 1000]`. No change needed.
- `src/utils/svgTransformMath.js` — pure math helpers (`normalizeAngle`, `getInverseScale`, `getCursorForHandle`). EDIT-12 can CALL these but must NOT modify them.
- `src/utils/svgAnnotationRenderers.jsx` — SVG renderer for each annotation type. Unrelated.
- `src/components/LightweightAnnotationOverlay.jsx` — legacy overlay, not touched in v2.1.
- `src/components/Callout/*` — callout subsystem. Unrelated (even though FabricEditCanvas callouts DO commit live angle, callout snap is explicitly out of scope).
- `src/contexts/*`, `src/sidebar/*` — unrelated subsystems.

### In-scope (edit allowed)
- `src/hooks/useSVGInteraction.js` — EDIT-11 snap integration (lines 391-408, ~3 LOC)
- `src/utils/zoomController.js` — ZOOM-09 MIN_SCALE constant (line 15, 1 LOC)
- `src/App.jsx` — ZOOM-09 single-line pre-clamp (line 21999, 1 LOC) [SCOPED CARVE-OUT above]
- `src/components/RotationInputField.jsx` — NEW FILE for EDIT-12 (~60-120 LOC)
- `src/components/SVGAnnotationLayer.jsx` parent wiring — TBD during planning; may require ~5-15 LOC to pass the live angle state + bbox to RotationInputField. If this exceeds a minimal wiring pattern, re-discuss.

</do_not_change>

<deferred>
## Deferred Ideas

**Captured here so they're not lost. Explicitly out of scope for this phase.**

- **Cmd+Arrow annotation nudging** — user wants users to be able to press Cmd+Up/Down/Left/Right to move selected annotations around the canvas with precision (like Adobe Acrobat, Drawboard PDF convention). The pixel-increment value should match industry standards (typically 1pt per press, 10pt with Shift). This is a separate keyboard-shortcut surface for MOVEMENT, distinct from the degree input's local Arrow keys which nudge ROTATION. Belongs in a new phase focused on keyboard shortcuts or annotation precision editing.
- **Selection box handles sit directly on text border, not offset outside it** — carryover todo from v2.0 cleanup (listed in STATE.md "Pending Todos"). Concerns text annotation bbox offsets. Unrelated to rotation/zoom-floor. Belongs in a separate UX polish phase.
- **Configurable snap increment (15°/22.5°/45°/90°)** — would match Illustrator's Constrain Angle preference. Requires a Preferences surface that doesn't exist yet. Defer to v2.2+ Preferences → Annotations tab.
- **Cursor angle readout during rotate** — Figma shows angle in the sidebar, not at the cursor. No surveyed tool ships cursor-adjacent readout. The EDIT-12 input field is a superior alternative. No action needed.
- **Handle auto-scaling at low zoom** — Figma hides handles below a threshold, Sketch enlarges the bbox, Illustrator/Photoshop stack them. v2.1 ships the Illustrator/Photoshop model (stacks, user zooms back in). If users complain after shipping, add Figma-style hide-below-threshold in v2.2 (~20-40 LOC in SVGAnnotationLayer).
- **Snap indicator animation (tick flash, highlight on snap)** — anti-feature. No surveyed annotation tool ships this. Do not build.
- **Shift-snap on the FabricEditCanvas shape rotation preview** — would require first fixing the commit-lossy `json.angle` override at FabricEditCanvas.jsx:476-477. Mechanically possible but creates scope creep. Defer until a user actively complains.
- **Shift-snap on the PAL legacy Pan+modifier rotate path** — effectively dead code in v2.0+. Should be deleted, not upgraded with snap logic. Defer as tech debt cleanup.

</deferred>

---

*Phase: 12-shape-edit-polish*
*Context gathered: 2026-04-12*
*Research informed by: .planning/research/ (ARCHITECTURE.md, PITFALLS.md, FEATURES.md, STACK.md, SUMMARY.md)*
