# Phase 14: Unified SVG Callout Render + Shared Tool Foundation - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Move the text callout off its current HTML-overlay React system (`src/components/Callout/*`) onto the SVG pipeline that every other annotation type already uses — rendering text content via `<foreignObject>`, mirroring the `renderText` pattern at `svgAnnotationRenderers.jsx:413`. Ride-along: land three cross-tool interaction foundations (crosshair cursor, Delete/Backspace, dashed creation preview) in the SVG interaction layer that callouts are moving into, so Phases 15-18 (line/arrow curvature, mini-toolbar, callout collisions/resize/auto-route) build forward against a single unified interaction surface.

**In scope:** CALL-10, UX-01, KBD-01, CREATE-01.

**Out of scope (phase boundary guardrail — all belong to later phases):**
- Line/arrow middle curvature handle and curved-bezier rendering — Phase 15 (LINE-01..03, ARROW-01..03)
- 6-style arrowhead picker / `arrowheadStyle` field on line/arrow — Phase 15 (ARROW-04)
- Line/arrow mini-toolbar, typeable curvature pill, min-drag threshold — Phase 16 (LINE-04..06, ARROW-05..07)
- 30-px handle collision clamps (arrowTip↔knee, knee↔box, box↔knee) — Phase 17 (CALL-01..03)
- On-drop rollback for invalid callout drag configurations — Phase 17 (CALL-04)
- Callout corner-resize correctness (four underlying bugs) — Phase 17 (CALL-05)
- Hover-reveal handles with 50 ms hide-delay — Phase 18 (CALL-06)
- Liang-Barsky auto-routing for connector wrap-around — Phase 18 (CALL-07)
- Empty-text self-destruct on edit-mode exit — Phase 18 (CALL-08)
- Selection-preview hover glow — Phase 18 (CALL-09)

</domain>

<decisions>
## Implementation Decisions

### Area 1 — Data model & state scope (minimal migration)

- **Keep the existing separate `callouts[]` React state** in `App.jsx:11024`. Do NOT merge callouts into `annotations.objects[]` in Phase 14. The separate array stays the source of truth for the whole v2.3 milestone.
- **Keep normalized (0-1) coordinates** in the stored callout data. Coordinate-space conversion happens at the renderer/interaction boundary, not at the data layer.
- **Delete `src/components/Callout/CalloutCanvas.jsx`, `CalloutComponent.jsx`, `CalloutContextMenu.jsx`, `CalloutEditModal.jsx`, and `index.jsx`.** These five files (~3424 LOC) are the HTML-overlay UI being replaced.
- **Keep `src/components/Callout/types.js` (224 LOC) as a type/enum shim.** It owns `ARROWHEAD_STYLES` (the 6-value enum `NONE | SOLID_TRIANGLE | V_SHAPE | OPEN_CIRCLE | OPEN_TRIANGLE | HORIZONTAL_LINE`) and the `createCallout()` factory. Phase 15 ARROW-04 lifts the enum into the line/arrow data model — keeping it available avoids a mid-milestone re-port.
- **Revise `renderCallout` at `svgAnnotationRenderers.jsx:500`** — it's currently dead code gated off by the `filteredCallouts = []` short-circuit at `SVGAnnotationLayer.jsx:779`. Phase 14 turns on the dispatch AND revises the renderer:
  - Change the signature to take **page coordinates directly** (caller does normalized→page conversion at dispatch time). The renderer should not multiply by `pageWidth`/`pageHeight` internally — it should trust inputs.
  - Add `data-callout-id="{id}"` on the outermost `<g>` wrapper and `data-callout-part="{arrowTip|knee|textBox|line1|line2|text}"` on each sub-element. Phases 17-18 need these attributes for event-delegation hit-testing (same pattern as v2.2 EDIT-13 rotation-handle `data-rotation-handle="mtr"` delegation).
  - Keep the `<foreignObject>` text rendering aligned with `renderText`'s style contract (font fallback as a single font name per the 2026-04-08 Fabric.js gotcha, anti-aliasing properties, lineHeight).
- **Dispatch model: parallel `callouts` prop + separate render list.** `SVGAnnotationLayer` already imports `calculateCalloutConnection` at line 36 and has a `callouts` prop wired. Unwind the `filteredCallouts` `useMemo` at `:779` to actually map over the `callouts` array and produce an array of `<renderCallout>` elements rendered in a sibling `<g className="callouts-layer">` within the same SVG root, below the annotations layer (or above — render-order decision deferred to implementation, no visual dependency in Phase 14).
- **Selection state: new `selectedCalloutIds: string[]` parallel to the existing `selectedIds: number[]`.** Clicking a callout part sets `selectedCalloutIds = [calloutId]` and clears `selectedIds` (and vice versa). Multi-select across annotation-and-callout is OUT of scope for Phase 14. `useSVGInteraction` gets a parallel dispatch branch for callout hit-tests via the `data-callout-id` attribute on pointer events.

### Area 2 — Edit-mode entry path (FabricEditCanvas adapter)

- **Edit-mode entry routes through the existing `FabricEditCanvas` with `editType: 'callout'`.** Phase 11 shipped `loadCalloutAnnotation` at `FabricEditCanvas.jsx:1937` which already handles legacy PAL Fabric-Group callouts via `fabric.util.enlivenObjects`. Phase 14 reuses this code path for React callouts via an adapter.
- **Adapter lives in a new file: `src/utils/calloutEditAdapter.js`.** Pure utility — no FabricEditCanvas.jsx edits required. The adapter converts a React callout `{id, arrowTip, knee, textBoxPosition, textBoxWidth, textBoxHeight, text, style}` (normalized coords) into the Fabric.js Group shape that `loadCalloutAnnotation` already expects (page-coord Line + Line + Triangle + Rect + Textbox children, grouped). On edit exit, the adapter converts the edited Fabric Group back to the React callout shape (normalized coords, same field set).
- **Commit path: wrapper at the FabricEditCanvas caller site in `App.jsx`.** The existing `onSaveAnnotations` callback commits to `annotationsByPage`. For callouts, a small wrapper function in `App.jsx` (where `<FabricEditCanvas>` is mounted in the render loop) detects `editType === 'callout'` + React-callout-shaped payload and routes the save to `setCallouts` instead of `setAnnotationsByPage`. This is a **narrow-lane `src/App.jsx` waiver — ~10-20 LOC expected**. No FabricEditCanvas waiver.
- **Canvas sizing: keep the full-page Canvas + SVG-hidden pattern from Phase 11.** Callout edit mode mounts `FabricEditCanvas` at full page dimensions and hides the `SVGAnnotationLayer` during edit (same pattern as the eraser tool, via `svgInteractive=false`). Rationale: callout parts span large areas (arrowTip can be far from the textbox), and Phase 11 already validated this pattern for the legacy PAL callouts. Container-aware sizing via `containerEl.offsetWidth / pageSize.width` for `effectiveScale` is mandatory per CLAUDE.md.
- **Double-click dispatch: overload `onRequestEditMode`.** `useSVGInteraction.handleAnnotationDoubleClick` at `:255` currently fires `onRequestEditMode(annotationIndex, annotationType)`. Phase 14 extends this handler to hit-test the `data-callout-id` attribute (added in Area 1) and fire `onRequestEditMode(calloutId, 'callout')` with the ID in the index slot. Callers disambiguate by checking `type === 'callout'`. No new callback prop.

### Area 3 — Phase 14 drag/select MVP (basic drag, collisions deferred)

**In scope for Phase 14 (basic drag + whole-move):**

- **arrowTip handle drag** — user can grab the arrowTip handle on a selected callout and drag the tip. Raw positioning, no 30 px clamp vs the knee (that's Phase 17 CALL-01).
- **knee handle drag** — user can grab the knee handle and drag the bend. Raw positioning, no textbox-border clamp, no auto-routing (Phases 17/18).
- **textBox body drag** — user clicks-and-drags the textbox body (not the corners) to reposition the whole textbox. Raw move, no knee-collision avoidance (Phase 17 CALL-03).
- **Whole-move (two triggers):**
  1. **Connector-line drag** (primary, natural path) — clicking and dragging `line1` or `line2` moves the entire callout as a unit. Direct parity with combined-tools' "drag the connector = drag the whole thing" pattern at `FabricPDFCanvas.tsx:2569-2603`.
  2. **Cmd/Ctrl + any-part drag** — modifier-key path for keyboard-aware users. Cmd on macOS, Ctrl on Windows. Detected via `e.metaKey || e.ctrlKey` at pointer-down time.

**Out of scope for Phase 14 (hard-OUT — downstream agents: do not build these):**

- Corner-resize of textbox (CALL-05) — Phase 17
- 30-px collision clamps between arrowTip/knee/textbox (CALL-01, CALL-02, CALL-03) — Phase 17
- On-drop rollback to drag-start positions when drag ends in invalid configuration (CALL-04) — Phase 17
- Hover-reveal handles with 50 ms hide delay (CALL-06) — Phase 18
- Liang-Barsky connector auto-routing (CALL-07) — Phase 18
- Empty-text self-destruct on edit-mode exit (CALL-08) — Phase 18
- Selection-preview hover glow (CALL-09) — Phase 18

**Drag-mode architecture in `useSVGInteraction.js`:**

- **Single new mode: `'callout-part'`** with a `dragStateRef.partType: 'arrowTip' | 'knee' | 'textBox' | 'whole'` field. The pointer-move branch switches on `partType`. Rationale: fewer mode constants, matches combined-tools' dispatch-on-`partType` pattern at `FabricPDFCanvas.tsx:2569-2603`. Plan should follow the four-place invariant from v2.1 (mode added in `handlePointerDown`, `handlePointerMove`, `handlePointerUp`, AND `dragStateRef` shape — miss one and the drag state gets stuck).
- For `partType: 'whole'`, the pointer-move handler applies `dx/dy` deltas to all four callout positions (arrowTip, knee, textBoxPosition) before committing via `setCallouts`.

### Area 4 — Shared foundation wiring (Delete, crosshair, preview)

**UX-01 — Crosshair cursor for line/arrow/callout tool mode:**

- **Layer: CSS class on portal host via prop.** Both `SVGAnnotationLayer` and `FabricDrawingCanvas` already receive `activeTool` as a prop (confirmed at `App.jsx:25692`, `:26396`, `:26857` and the `FabricDrawingCanvas` mount sites). Each component conditionally applies a `toolCrosshair` class (or equivalent inline `cursor: crosshair` style) on its own SVG/canvas root when `activeTool === 'line' || activeTool === 'arrow' || activeTool === 'callout'`. Reset to `cursor: default`/`move` when the tool deactivates or a creation drag starts.
- **Zero App.jsx waiver** — both components already have the `activeTool` prop; this is purely a conditional-class change inside each component.

**KBD-01 — Delete/Backspace for selected line/arrow/callout:**

- **Location: new `useEffect` hook in `SVGAnnotationLayer.jsx`.** Attaches a window-level `keydown` listener. Handler checks (in order):
  1. `isUserTyping()` focus guard — return early if `document.activeElement` is a text input, textarea, contentEditable, or a Fabric.js hidden textarea (matching the combined-tools pattern). No changes to text-editing behavior.
  2. `e.key === 'Delete' || e.key === 'Backspace'` — otherwise return.
  3. If `selectedIds.length > 0` → fire `onDeleteSelected(selectedIds)` (new prop, handled by the annotations save pipeline).
  4. If `selectedCalloutIds.length > 0` → fire `onDeleteSelectedCallouts(selectedCalloutIds)` (new prop, handled by a callout-specific setCallouts call).
- Single-select scope for Phase 14 — multi-select delete works trivially because the selectedIds array iterates, but Phase 14 only needs single-select correctness per the requirement (KBD-01 says "single-select").
- **Undo support** — the delete callbacks must call `saveAnnotationCheckpoint` per the existing per-action undo pattern (Phase 9 decision).
- **Zero App.jsx waiver** — the handler lives inside `SVGAnnotationLayer` and dispatches through new props. App.jsx only adds `onDeleteSelectedCallouts={handler}` alongside the existing `onDeleteSelected` prop at the existing mount sites (pure prop-drilling, no waiver needed).

**CREATE-01 — Dashed preview at 0.6 opacity (split wiring):**

- **Line/arrow preview** — Stays in `FabricDrawingCanvas.jsx` where line/arrow creation already lives (`:287-292` mousedown, `:322` mousemove, `:340` mouseup). Add two fields to the preview `fabric.Line` at creation time: `strokeDashArray: [5, 5]`, `opacity: 0.6`. Reset `strokeDashArray: null`, `opacity: 1` (or the tool's default opacity) at commit time (`:340`) before saving. **Narrow-lane `FabricDrawingCanvas.jsx` waiver — ~5 LOC expected.** Do NOT touch the `zoomGeneration` signal.
- **Callout preview** — Transient React state in `SVGAnnotationLayer` (or a new small hook `useCalloutCreation` consumed by `SVGAnnotationLayer`). During `activeTool === 'callout'` + mouse-down-drag, track `{ arrowTip, currentPointer }` in React state and render a transient `<g className="callout-preview">` child containing:
  - A dashed `<rect>` for the previewed textbox at the current pointer position (hardcoded 120×40 size matching combined-tools' default, scaled to the correct units).
  - Two dashed `<line>` segments for the connector (textbox-edge → knee → arrowTip), with knee computed via the combined-tools creation formula (`knee = { x: (arrowTip.x + currentPointer.x)/2, y: arrowTip.y - 40 }` — see `COMBINED-TOOLS-AUDIT.md` "Text Callout Tool → Creation flow").
  - A preview arrowhead `<polygon>` at the arrowTip.
  - All elements at `opacity={0.6}` and `strokeDasharray="5,5"`.
  - On mouseup, fire `setCallouts(prev => [...prev, newCallout])` via a new `onCreateCallout` callback prop, clear the preview state.
- **No FabricDrawingCanvas callout branch** — contradicts the "split preview" decision and puts callout logic back into the canvas layer we're moving away from.

### Waivers summary (flag for planner)

Phase 14 requires two **narrow-lane waivers** against the Always-Protected file list in `CLAUDE.md`:

1. **`src/App.jsx`** — add a ~10-20 LOC wrapper function around the existing `FabricEditCanvas`'s `onSaveAnnotations` callback that detects callout-shaped commits and routes them to `setCallouts` instead of `setAnnotationsByPage` (Area 2b commit-path decision). Also add the `onDeleteSelectedCallouts` prop at the `SVGAnnotationLayer` mount sites (pure prop-drilling, no-op change). The `setCallouts` state itself already exists at `App.jsx:11024` — no new state.
2. **`src/components/FabricDrawingCanvas.jsx`** — add `strokeDashArray: [5, 5]` and `opacity: 0.6` to the preview `fabric.Line` at creation (`:287-292`) and reset at commit (`:340`) for CREATE-01. ~5 LOC. Do not touch the `zoomGeneration` signal or the existing mousedown/move/up event shapes.

All other Always-Protected files stay untouched: `PageAnnotationLayer.jsx`, `FabricEditCanvas.jsx`, `FabricEraserCanvas.jsx`, `SVGAnnotationLayer.jsx` (wait — SVGAnnotationLayer is not Always-Protected per the CLAUDE.md list; it's the primary edit surface for this phase), `package.json`, `vite.config.js`.

### Claude's Discretion

- Exact field names for the new props (`onDeleteSelectedCallouts` vs `onCalloutDelete`, `onCreateCallout` vs `onCalloutCreate`, etc.).
- Whether `useCalloutCreation` is a separate hook or inlined into `useSVGInteraction`.
- Exact CSS class name(s) for the crosshair (`tool-crosshair` vs `tool-cursor-crosshair`).
- Exact shape of the new Fabric.js Group returned by `calloutEditAdapter.toFabricGroup(reactCallout, pageSize)` — must match what `loadCalloutAnnotation` already expects, otherwise the adapter is the wrong abstraction.
- Render order of `<g className="callouts-layer">` relative to `<g className="annotations-layer">` — no visual dependency in Phase 14.
- How the transient callout-preview state is cleared on tool switch (e.g., user hits `V` mid-drag) — consistent with how the existing line/arrow preview handles the same race.
- Whether `isUserTyping()` is imported from a new shared utility or inlined in the `SVGAnnotationLayer` keydown effect.
- Plan decomposition: Phase 14 probably decomposes into 2-3 plans (Plan 14-01: render + dispatch + selection + data-attr wiring; Plan 14-02: FabricEditCanvas adapter + edit-mode entry + commit-path wrapper; Plan 14-03: shared foundation hooks — crosshair, delete, preview split). Decomposition is the planner's call, not locked here.

</decisions>

## Acceptance Criteria

**Given** a callout saved from the legacy HTML-overlay system before Phase 14, **when** the user loads the PDF after Phase 14 ships, **then** the callout renders through `svgAnnotationRenderers.jsx:renderCallout` (new unified path) with `<foreignObject>` text content and is byte-identical in its stored normalized-coord JSON fields (zero data migration).

**Given** a callout is on the page, **when** the user activates the Select tool and clicks the callout's textbox, connector line, or arrowTip, **then** `selectedCalloutIds = [calloutId]` and the existing `selectedIds` is cleared, with the callout visually marked as selected via data attributes available for future phase chrome.

**Given** the user has any callout, line, or arrow selected (single-select) and no text input is focused, **when** the user presses `Delete` or `Backspace`, **then** the selected annotation is removed from its store (`setCallouts` for callouts, `setAnnotationsByPage` for line/arrow) with an undo checkpoint captured, and the selection state clears.

**Given** the user activates the line, arrow, or callout tool, **when** no creation drag is in progress, **then** the SVG interaction surface shows a `cursor: crosshair` cursor until the tool deactivates or the first creation drag starts; the cursor reverts to `default`/`move` immediately on tool deactivation.

**Given** the line, arrow, or callout tool is active, **when** the user starts a click-drag for creation, **then** a preview shape is drawn at `strokeDasharray: [5, 5]` and `opacity: 0.6` following the pointer in real time, using the same color/thickness settings as the committed annotation will have. **Given** the user releases the mouse, **then** the preview disappears and the committed annotation replaces it with solid stroke and tool-default opacity.

**Given** a callout is selected and the user drags its arrowTip handle, knee handle, textbox body, the connector line, or any part while holding Cmd/Ctrl, **then** the corresponding drag branch (`'arrowTip' | 'knee' | 'textBox' | 'whole'`) updates the callout state and renders immediately, with NO 30-px collision clamp and NO on-drop rollback (those belong to Phase 17).

**Given** the user double-clicks a selected callout's textbox, **when** the `onRequestEditMode(calloutId, 'callout')` dispatch fires, **then** `FabricEditCanvas` mounts at full page dimensions with SVG annotation layer hidden, `loadCalloutAnnotation` loads the adapter-converted Fabric.js Group, and the user can type into the textbox; on edit-mode exit, the adapter writes the edited state back to `setCallouts` via the App.jsx callback wrapper with an undo checkpoint.

**Given** Phase 14 has shipped, **when** the 113-test Playwright baseline runs, **then** all 113 tests still pass (no regression to rotation handle, shape edit, pen/eraser, text editing, or zoom behavior).

## DO NOT CHANGE

Files in Phase 14's DO NOT CHANGE list — touching any of these is a boundary violation without an explicit per-file user waiver:

- `src/App.jsx` — **narrow-lane waiver GRANTED for Phase 14**: ~10-20 LOC for the FabricEditCanvas save-callback wrapper (Area 2b) + prop drilling for `onDeleteSelectedCallouts` and `onCreateCallout`. Any change outside those narrow edits is a boundary violation.
- `src/components/PageAnnotationLayer.jsx` — PROTECTED. PAL's legacy callout code is untouched; this phase moves the NEW React callout system, not PAL's. Do not read from or write to PAL-related state.
- `src/components/FabricEditCanvas.jsx` — **PROTECTED, no waiver.** The adapter (Area 2a) lives in a new sibling file `src/utils/calloutEditAdapter.js` specifically to avoid touching FabricEditCanvas. The existing `loadCalloutAnnotation` at `:1937` is reused as-is. Do not extend the callout branch.
- `src/components/FabricEraserCanvas.jsx` — PROTECTED. Unrelated to this phase.
- `src/components/FabricDrawingCanvas.jsx` — **narrow-lane waiver GRANTED for Phase 14**: ~5 LOC for CREATE-01 (strokeDashArray + opacity on preview Fabric.Line + reset at commit). Do not touch the `zoomGeneration` signal, do not rename/remove the mousedown/move/up event shapes, do not change the line/arrow data model (`tool: 'line'|'arrow'` tag stays as-is).
- `package.json` / `vite.config.js` — PROTECTED. Zero new dependencies for Phase 14.
- `src/utils/lineGeometry.js` — CONSUME-only. Only consumer today is PAL; Phase 14 does not touch line curvature at all (that's Phase 15). Do not read from this file for Phase 14 work.
- `src/utils/svgTransformMath.js` `snapAngleToNearest45` — used only for rotation handle. Not relevant to Phase 14.
- Rotation pill machinery in `SVGAnnotationLayer.jsx` lines 215-312 (EDIT-13 event delegation) — Phase 13 lane. Do not modify the `data-rotation-handle="mtr"` dispatch or its eslint-disable rules; callout event delegation uses separate `data-callout-*` attributes to avoid collision.

## Canonical References

**Downstream agents (researcher, planner, implementer) MUST read these before planning or implementing.**

### v2.3 requirements and roadmap
- `.planning/REQUIREMENTS.md` — CALL-10, UX-01, KBD-01, CREATE-01 acceptance bullets, Out of Scope table, v2.3 scope framing (rewrite permission, combined-tools as baseline)
- `.planning/ROADMAP.md` §"Phase 14: Unified SVG Callout Render + Shared Tool Foundation" — goal, depends-on, success criteria, boundary notes, why-this-order rationale
- `.planning/PROJECT.md` — v2.3 milestone context, SVG display + Fabric-edit-on-demand architecture lock, Fabric 5.5.2 lock, feature parity accepted over pixel parity

### v2.3 research (HIGH confidence — dual-codebase port audit)
- `.planning/research/COMBINED-TOOLS-AUDIT.md` — **READ FIRST.** Callout data model, creation flow, edit flow, composite structure (seven separate Fabric objects), handle distance constraints, on-drop rollback, resize math, connector routing (`calculateCalloutConnection`), keyboard shortcut map. The baseline behavior Phase 14 ports from.
- `.planning/research/CURRENT-REPO-AUDIT.md` — **READ FIRST.** File map, current render path, data model, edit flow, risk areas, Gap analysis. Includes the exact file:line integration points for CALL-10 unified render and the waiver flags for App.jsx / FabricDrawingCanvas.
- `.planning/research/SUMMARY.md` — Executive summary of both audits.
- `.planning/research/ARCHITECTURE.md` — v2.0 SVG display + Fabric-edit-on-demand architecture (still load-bearing).
- `.planning/research/PITFALLS.md` — Historical pitfalls from v2.0-v2.2 (zoomGeneration signal, BBOX_PADDING, Canvas vs SVG rasterizer delta).

### Prior phase context (patterns, conventions, carry-forward)
- `.planning/phases/11-text-shape-editing-zoom-cleanup/11-CONTEXT.md` — `FabricEditCanvas` architecture with `editType` prop (text/shape/callout), full-page callout Canvas + SVG-hidden pattern, 200ms settle debounce, per-action undo via `saveAnnotationCheckpoint`, Supabase sync debounce (2-3s), `useFabricCanvas` hook, container-aware sizing via `effectiveScale`.
- `.planning/phases/13-rotation-handle-edit-mode-polish/13-CONTEXT.md` — v2.2 event-delegation hover-intent pattern via `e.target.closest('[data-rotation-handle="mtr"]')`. Phase 14's `data-callout-id` / `data-callout-part` attributes follow this exact pattern for Phases 17-18 to reuse.
- `.planning/phases/12-shape-edit-polish/12-CONTEXT.md` — v2.1 optimistic-paint helper (`applyOptimisticRotation`), full-click-cycle stopPropagation for portaled UI (needed when Phase 16 curvature pill lands), plan 12-01 dual-path SVG↔Fabric edit parity.
- `.planning/phases/09-svg-selection-interaction/09-CONTEXT.md` — Selection model, double-click edit trigger at `useSVGInteraction.js:255`, selected-ID state, undo per action.
- `.planning/phases/10-canvas-mount-unmount-pen-eraser/10-CONTEXT.md` — Canvas mount/unmount lifecycle, `flushSync` during dispose, `zoomGeneration` signal contract (mandatory for any Canvas component — DO NOT remove).

### Integration surface (read when planning)
- `src/utils/svgAnnotationRenderers.jsx` — `renderText` at line 413 (foreignObject template to mirror), `renderCallout` at line 500 (dead-code renderer being revised for Phase 14)
- `src/components/SVGAnnotationLayer.jsx` — `filteredCallouts` early-return at line 779 (the gate being opened), `calculateCalloutConnection` import at line 36, existing selection state, isLineType branch at 1221-1264 (DO NOT touch — Phase 15 lane)
- `src/hooks/useSVGInteraction.js` — drag mode architecture (existing modes: `move`, `group-move`, `endpoint`, `resize`, `rotate`), `handleAnnotationDoubleClick` at ~255, `dragStateRef` shape at ~44
- `src/components/FabricEditCanvas.jsx:1937` — `loadCalloutAnnotation` (existing, reused via adapter — do NOT edit)
- `src/components/FabricDrawingCanvas.jsx:287-340` — line/arrow creation state machine (narrow-lane edit for CREATE-01 only)
- `src/App.jsx:11024` — `const [callouts, setCallouts] = useState([])` (existing state, reused)
- `src/App.jsx:20756, :20820, :20877` — callout save/load pipeline (read-only for Phase 14 to understand the existing dataflow)
- `src/App.jsx:22480-22503` — existing L/A/Q shortcut block (reference only — Phase 14 does NOT add Delete/Backspace here; that lives in SVGAnnotationLayer per Area 4a)
- `src/components/Callout/types.js` — `ARROWHEAD_STYLES` enum (preserved as shim for Phase 15 ARROW-04)

### Code gotchas (CLAUDE.md rules applied to Phase 14)
- **Container-aware canvas sizing** — any new Canvas mount must measure `containerEl.offsetWidth / pageSize.width` to compute `effectiveScale`, NOT `pageSize.width * syncfusionViewerScale`. Applies to the FabricEditCanvas mount for callout edit (Area 2c).
- **Fabric.js Textbox `fontFamily` must be a single font name** — no CSS fallback stacks. Applies to the Textbox inside the Fabric Group produced by `calloutEditAdapter` (Area 2a) and to the `<foreignObject>` font-family in the revised `renderCallout` (Area 1b).
- **`zoomGeneration` signal is load-bearing** — do NOT remove or rename in `FabricDrawingCanvas.jsx` during the CREATE-01 edit.

## Existing Code Insights

### Reusable Assets

- **`renderCallout` at `svgAnnotationRenderers.jsx:500`** — dead-code implementation ALREADY exists with `<foreignObject>` text, `<line>` connector segments, arrowhead circle, and textbox rect. Phase 14 revises it for page coords + data attributes rather than writing a new function from scratch.
- **`renderText` at `svgAnnotationRenderers.jsx:413`** — template for the foreignObject text pattern. Phase 14's revised `renderCallout` mirrors its foreignObject structure exactly.
- **`calculateCalloutConnection` in `src/utils/calloutGeometry.js`** — already imported in `SVGAnnotationLayer.jsx:36` and consumed by the existing `renderCallout`. Reused as-is for Phase 14 connector routing. NOTE: the full Liang-Barsky auto-routing logic inside this file is only hooked up after Phase 18 ships CALL-07. For Phase 14, the existing routing behavior is good enough.
- **`FabricEditCanvas.jsx:loadCalloutAnnotation` at `:1937`** — existing function that loads a Fabric.js Group callout into the edit canvas, used by legacy PAL callouts. Reused verbatim via the new `calloutEditAdapter` (no FabricEditCanvas edits).
- **`useFabricCanvas` hook (`src/hooks/useFabricCanvas.js`)** — shared Canvas lifecycle hook with `onBeforeDispose` commit-before-unmount. Already used by `FabricEditCanvas`; no changes needed.
- **`saveAnnotationCheckpoint` (App.jsx)** — per-action undo checkpoint. Called on every commit (drag-end, delete, edit-exit). Phase 14 calls it in the delete handler (KBD-01) and the callout edit commit wrapper (Area 2b).
- **`isUserTyping()` pattern from combined-tools** (`Index.tsx:31-49`) — focus guard for keyboard shortcuts. Phase 14 ports this into the SVGAnnotationLayer Delete/Backspace handler; may be inlined or extracted as a small shared utility.
- **`src/components/Callout/types.js`** — preserved as a types/enum shim. Owns `ARROWHEAD_STYLES`, `createCallout()` factory, `defaultCalloutStyle`. Phase 15 ARROW-04 will lift `ARROWHEAD_STYLES` out of this file into the line/arrow data model.

### Established Patterns

- **foreignObject for text rendering** — Phase 8+11 pattern. Use `<foreignObject>` with an inner HTML `<div>` for all text in SVG. Applies to the revised `renderCallout` textbox text.
- **Data-attribute event delegation** — Phase 13 EDIT-13 pattern (`data-rotation-handle="mtr"` + `e.target.closest()` in a delegated listener). Phase 14 adds `data-callout-id` and `data-callout-part` for the same reason.
- **Full-page Canvas mount + SVG hidden during edit** — Phase 10/11 eraser + callout pattern. Applies to the callout edit-mode entry path.
- **Container-aware effective scale** — CLAUDE.md mandatory rule. Any new Canvas mount in this phase must follow it.
- **Per-action undo via `saveAnnotationCheckpoint`** — Phase 9 pattern. Every commit (delete, drag-end, edit-exit) captures a checkpoint.
- **Supabase sync debounce 2-3 seconds after local commit** — Phase 9 pattern. Callout saves already use this; Phase 14 preserves it via the existing setCallouts pipeline.
- **Tool activation via prop, not context** — `activeTool` is prop-drilled everywhere. Phase 14 reads it in `SVGAnnotationLayer` and `FabricDrawingCanvas` for the crosshair class (Area 4b).
- **Parallel state arrays for independent concerns** — Phase 14's `selectedCalloutIds` mirrors the existing `selectedIds` pattern rather than trying to unify.
- **FabricEditCanvas `editType` branch pattern** — `'text' | 'shape' | 'callout'` already established in Phase 11. Phase 14 reuses the `'callout'` branch via the adapter, does NOT add a new branch.

### Integration Points

- **`SVGAnnotationLayer` ← `callouts` prop from `App.jsx`** — already wired, currently unused downstream of the `filteredCallouts = []` short-circuit.
- **`SVGAnnotationLayer` → `useSVGInteraction`** — pointer events dispatched through the hook. New `callout-part` drag mode + `data-callout-id` hit-testing plug in here.
- **`useSVGInteraction` → `onRequestEditMode(id, type)` callback → `App.jsx` → `<FabricEditCanvas>`** — existing edit-mode entry pipeline. Phase 14 extends the dispatch to route callouts through the same pipeline via the adapter + the `'callout'` type tag.
- **`FabricEditCanvas` → `onSaveAnnotations` callback → `App.jsx` setCallouts wrapper → `setCallouts`** — new callout commit path via the App.jsx wrapper function.
- **`SVGAnnotationLayer` → window keydown listener → `onDeleteSelected` / `onDeleteSelectedCallouts` callbacks → `App.jsx` → `setAnnotationsByPage` / `setCallouts`** — new deletion pipeline (KBD-01).
- **`SVGAnnotationLayer` / `FabricDrawingCanvas` → `activeTool` prop → CSS class toggle** — new crosshair pipeline (UX-01). Zero new state.
- **`SVGAnnotationLayer` → `onCreateCallout` callback → `setCallouts`** — new callout creation path (CREATE-01 callout half). Line/arrow creation stays in `FabricDrawingCanvas` with the narrow-lane dashed-preview edit (CREATE-01 line/arrow half).
- **`App.jsx:20877` data loader** — existing `if (data.callouts) setCallouts(data.callouts)` unchanged. Existing saved callouts roundtrip through Phase 14 without migration (data-model-continuity success criterion).

## Specific Ideas

- "Revise `renderCallout` once, use it everywhere from Phase 14 onward" — don't keep normalized coords inside the renderer, convert at the dispatch boundary, so Phase 17 collision math and Phase 18 hover affordances build against a single page-coord surface.
- "Adapter file keeps FabricEditCanvas untouched" — user is deliberately preserving the FabricEditCanvas.jsx no-waiver boundary, accepting a small App.jsx waiver instead. This is consistent with the Phase 13 EDIT-14 rescope lesson: surgical edits to the smaller-surface file, not the larger-surface one.
- "All 4 drag parts in Phase 14, all 4 exclusions hard-OUT" — the user wants a usable callout select/drag experience in Phase 14 even without collision constraints or resize, so downstream phases build against real interaction (not a read-only preview). The tradeoff is that intermediate states may look visually broken until Phase 17 lands collision clamps — acceptable because the target audience for the intermediate state is Claude building Phase 15-18, not end users.
- "Split preview wiring reflects the architectural reality" — line/arrow creation physically lives in `FabricDrawingCanvas` post-v2.0 (it didn't move to SVG during the migration because the interactive canvas was already mounted for other drawing tools). Callout creation is being moved OUT of `CalloutCanvas.jsx` and INTO the SVG layer because callouts are rendering there now. The split is not inconsistent — it reflects where each tool's creation state machine lives.
- "Data attributes are Phase 17's gift, wrap them in Phase 14" — adding `data-callout-id` / `data-callout-part` costs ~10 LOC in Phase 14 but saves a full renderer revision in Phase 17 when collision math needs to hit-test handles via event delegation (same story as v2.2 rotation-handle delegation).
- "Single `'callout-part'` mode with partType field" — matches combined-tools' switch-on-partType dispatch at `FabricPDFCanvas.tsx:2569-2603`. Fewer mode constants means less branching in the four-place drag-mode invariant (handlePointerDown / handlePointerMove / handlePointerUp / dragStateRef).

## Deferred Ideas

- **Merging callouts into `annotations.objects[]`** — decided against for Phase 14 (minimal migration). Could be revisited in a future v3.x cleanup milestone once all five callout phases (14-18) ship against the current data-model shape. Not urgent.
- **Multi-select delete across annotations + callouts** — Phase 14's delete handler is single-select only (per KBD-01 spec). Multi-select works trivially via array iteration but is not tested in Phase 14. Backlog for a future polish pass.
- **Touch event parity for callout drag** — combined-tools has touch support in `CalloutCanvas.jsx` (now being deleted). Phase 14 is mouse/pointer only. Touch support for the new unified SVG callout is backlog.
- **Keyboard nudge (arrow keys) on selected callout** — combined-tools doesn't have it; out of scope per v2.3 Out of Scope table. Permanently backlog.
- **Copy/paste for callouts** — not in combined-tools, not in current repo. Permanently backlog.
- **CalloutContextMenu** — current `src/components/Callout/CalloutContextMenu.jsx` (233 LOC) is being deleted in Phase 14. Context menu is not re-implemented in the unified SVG path. If user wants it back, new phase.
- **CalloutEditModal** — current `src/components/Callout/CalloutEditModal.jsx` (820 LOC) is being deleted in Phase 14. The inline text-editing-on-double-click path replaces it. If user wants the modal-style editor back, new phase.

---

*Phase: 14-unified-svg-callout-render-shared-tool-foundation*
*Context gathered: 2026-04-15*
