# Phase 14: Unified SVG Callout Render + Shared Tool Foundation - Research

**Researched:** 2026-04-15
**Domain:** SVG render unification + shared cross-tool interaction foundation (in-repo port, no new dependencies)
**Confidence:** HIGH — every assertion below is grounded in verified file:line reads of the current codebase plus a complete CONTEXT.md from `/gsd:discuss-phase 14` that already locked the architecture.

## Summary

Phase 14 is a code-archaeology + targeted-port phase, not a domain-research phase. The user has already locked four implementation areas in `14-CONTEXT.md` (data model + renderer revision, edit-mode adapter, Phase-14 drag MVP, and shared-foundation wiring), and the v2.3 audit pair (`CURRENT-REPO-AUDIT.md` + `COMBINED-TOOLS-AUDIT.md`) provides the baseline behavior to match. There is no library to research, no version to verify, no new dependency to add — Phase 14 stays on Fabric.js 5.5.2, React 18, no new packages (per `## DO NOT CHANGE`).

What this research document adds on top of the locked CONTEXT:

1. **Verified file:line offsets** for every integration point the planner needs (`renderCallout` at `svgAnnotationRenderers.jsx:500-613`, `renderText` at `:413-485`, `filteredCallouts` short-circuit at `SVGAnnotationLayer.jsx:779-812`, the dispatch table at `:679-735`, the existing Delete/Backspace handler at `:194-206`, line/arrow creation in `FabricDrawingCanvas.jsx:265-360`, `loadCalloutAnnotation` in `FabricEditCanvas.jsx:1937-2010`, the keyboard shortcut block in `App.jsx:23064-23205`, and the `setCallouts` wiring at `App.jsx:11024` + load at `:21333`).
2. **Three corrections** to assumptions in CONTEXT.md that would have bitten the planner: (a) `App.jsx:22480` is a search/scroll handler, not the keyboard handler — the real keyboard handler lives at `App.jsx:23064`; (b) `FabricDrawingCanvas` already hard-codes `cursor: 'crosshair'` at line 510 unconditionally, so the UX-01 task on the line/arrow side is a no-op for FabricDrawingCanvas itself but matters for the SVG layer because it currently has `pointerEvents: 'none'` when activeTool is line/arrow/callout; (c) `commitShape` in `FabricDrawingCanvas.jsx:243-263` calls `shape.toJSON(CUSTOM_PROPS)` BEFORE `canvas.remove(shape)` — so the dashed-preview reset for CREATE-01 must happen between the `hasSize` check and the `commitShape` call, otherwise the dashed style will be persisted into Supabase.
3. **One critical regression risk** that CONTEXT did not flag explicitly: `defaultCalloutStyle.fontFamily` at `src/components/Callout/types.js:122` is `'Inter, Arial, sans-serif'` — a CSS fallback stack. Per the 2026-04-08 cursor-drift gotcha, this value MUST be sanitized to a single font name before being assigned to the Fabric.js Textbox inside `calloutEditAdapter.toFabricGroup()`, otherwise we'll regress the cursor drift bug Phase 12 fought for two weeks. The same sanitization applies to the new `<foreignObject>` font-family in the revised `renderCallout`.
4. **A ready-to-execute Validation Architecture section** that maps each of the five Phase 14 success criteria to specific test surfaces.

**Primary recommendation:** Trust the CONTEXT.md locked decisions verbatim, but adopt the three corrections above when writing PLAN.md. Plan decomposition almost certainly lands at three plans (14-01: render unification + dispatch + selection + data-attrs; 14-02: edit-mode adapter + commit-path App.jsx waiver; 14-03: shared foundation — UX-01 + KBD-01 + CREATE-01 split wiring) — but the planner owns that call.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Area 1 — Data model & state scope (minimal migration)**

- Keep the existing separate `callouts[]` React state at `App.jsx:11024`. Do NOT merge callouts into `annotations.objects[]` in Phase 14. The separate array stays the source of truth for the whole v2.3 milestone.
- Keep normalized (0-1) coordinates in the stored callout data. Coordinate-space conversion happens at the renderer/interaction boundary, not at the data layer.
- Delete `src/components/Callout/CalloutCanvas.jsx`, `CalloutComponent.jsx`, `CalloutContextMenu.jsx`, `CalloutEditModal.jsx`, and `index.jsx`. These five files (~3424 LOC) are the HTML-overlay UI being replaced.
- Keep `src/components/Callout/types.js` (224 LOC) as a type/enum shim. It owns `ARROWHEAD_STYLES` (the 6-value enum `NONE | SOLID_TRIANGLE | V_SHAPE | OPEN_CIRCLE | OPEN_TRIANGLE | HORIZONTAL_LINE`) and the `createCallout()` factory. Phase 15 ARROW-04 lifts the enum into the line/arrow data model — keeping it available avoids a mid-milestone re-port.
- Revise `renderCallout` at `svgAnnotationRenderers.jsx:500` — currently dead code gated off by `filteredCallouts = []` short-circuit at `SVGAnnotationLayer.jsx:779-784`. Phase 14 turns on the dispatch AND revises the renderer:
  - Change the signature to take **page coordinates directly** (caller does normalized→page conversion at dispatch time). The renderer should not multiply by `pageWidth`/`pageHeight` internally.
  - Add `data-callout-id="{id}"` on the outermost `<g>` wrapper and `data-callout-part="{arrowTip|knee|textBox|line1|line2|text}"` on each sub-element (Phases 17-18 need these for event-delegation hit-testing — same pattern as v2.2 EDIT-13 rotation-handle delegation).
  - Keep the `<foreignObject>` text rendering aligned with `renderText`'s style contract (font fallback as a single font name per the 2026-04-08 Fabric.js gotcha, anti-aliasing properties, lineHeight).
- **Dispatch model:** parallel `callouts` prop + separate render list. `SVGAnnotationLayer` already imports `calculateCalloutConnection` at `:36` and has a `callouts` prop wired (already passed at `App.jsx:26258`). Unwind the `filteredCallouts` `useMemo` at `:779` to actually map over the `callouts` array and render in a sibling `<g className="callouts-layer">` within the same SVG root.
- **Selection state:** new `selectedCalloutIds: string[]` parallel to `selectedIds: number[]`. Clicking a callout part sets `selectedCalloutIds = [calloutId]` and clears `selectedIds` (and vice versa). Multi-select across annotation-and-callout is OUT of scope for Phase 14. `useSVGInteraction` gets a parallel dispatch branch for callout hit-tests via the `data-callout-id` attribute.

**Area 2 — Edit-mode entry (FabricEditCanvas adapter)**

- Edit-mode entry routes through the existing `FabricEditCanvas` with `editType: 'callout'`. Phase 11 shipped `loadCalloutAnnotation` at `FabricEditCanvas.jsx:1937` which already handles legacy PAL Fabric-Group callouts via `fabric.util.enlivenObjects`. Phase 14 reuses this code path for React callouts via an adapter.
- Adapter lives in a new file: `src/utils/calloutEditAdapter.js`. Pure utility — no FabricEditCanvas.jsx edits. The adapter converts a React callout `{id, arrowTip, knee, textBoxPosition, textBoxWidth, textBoxHeight, text, style}` (normalized coords) into the Fabric.js Group shape that `loadCalloutAnnotation` already expects (page-coord Line + Line + Triangle + Rect + Textbox children, grouped). On edit exit, the adapter converts the edited Fabric Group back to the React callout shape.
- **Commit path:** wrapper at the FabricEditCanvas caller site in `App.jsx`. The existing `onSaveAnnotations` callback commits to `annotationsByPage`. For callouts, a small wrapper function in `App.jsx` (where `<FabricEditCanvas>` is mounted in the render loop) detects `editType === 'callout'` + React-callout-shaped payload and routes the save to `setCallouts` instead of `setAnnotationsByPage`. **Narrow-lane `src/App.jsx` waiver — ~10-20 LOC expected.** No FabricEditCanvas waiver.
- **Canvas sizing:** keep the full-page Canvas + SVG-hidden pattern from Phase 11. Container-aware sizing via `containerEl.offsetWidth / pageSize.width` for `effectiveScale` is mandatory per CLAUDE.md.
- **Double-click dispatch:** overload `onRequestEditMode`. `useSVGInteraction.handleAnnotationDoubleClick` at `:255-260` currently fires `onRequestEditMode(annotationIndex, annotationType)`. Phase 14 extends this handler to hit-test the `data-callout-id` attribute and fire `onRequestEditMode(calloutId, 'callout')` with the ID in the index slot. Callers disambiguate by checking `type === 'callout'`. No new callback prop.

**Area 3 — Phase 14 drag/select MVP (basic drag, collisions deferred)**

In scope:
- arrowTip handle drag — raw positioning, no 30 px clamp (Phase 17 CALL-01).
- knee handle drag — raw positioning, no textbox-border clamp, no auto-routing (Phases 17/18).
- textBox body drag — raw move, no knee-collision avoidance (Phase 17 CALL-03).
- Whole-move (two triggers): connector-line drag (primary) + Cmd/Ctrl + any-part drag (modifier-key path).

Drag-mode architecture in `useSVGInteraction.js`:
- Single new mode: `'callout-part'` with a `dragStateRef.partType: 'arrowTip' | 'knee' | 'textBox' | 'whole'` field. The pointer-move branch switches on `partType`. Plan should follow the four-place invariant from v2.1 (mode added in `handlePointerDown`, `handlePointerMove`, `handlePointerUp`, AND `dragStateRef` shape — miss one and the drag state gets stuck).

Hard-OUT for Phase 14 (downstream agents: do not build):
- Corner-resize (CALL-05) — Phase 17
- 30-px collision clamps (CALL-01/02/03) — Phase 17
- On-drop rollback (CALL-04) — Phase 17
- Hover-reveal handles + 50ms hide delay (CALL-06) — Phase 18
- Liang-Barsky auto-routing (CALL-07) — Phase 18
- Empty-text self-destruct (CALL-08) — Phase 18
- Selection-preview hover glow (CALL-09) — Phase 18

**Area 4 — Shared foundation wiring (Delete, crosshair, preview)**

- **UX-01 crosshair:** CSS class on portal host via prop. Each component conditionally applies a `toolCrosshair` class on its own SVG/canvas root when `activeTool === 'line' || activeTool === 'arrow' || activeTool === 'callout'`. Zero App.jsx waiver — both components already have the `activeTool` prop.
- **KBD-01 Delete/Backspace:** new `useEffect` hook in `SVGAnnotationLayer.jsx`. Window-level `keydown` listener with `isUserTyping()` focus guard. Single-select scope for Phase 14. Undo support via `saveAnnotationCheckpoint`. Zero App.jsx waiver — the handler lives inside SVGAnnotationLayer and dispatches through new props.
- **CREATE-01 dashed preview (split wiring):**
  - **Line/arrow preview:** stays in `FabricDrawingCanvas.jsx` where line/arrow creation already lives (`:287-292` mousedown, `:322` mousemove, `:340` mouseup). Add `strokeDashArray: [5, 5]`, `opacity: 0.6` to the preview `fabric.Line` at creation time. Reset before commit. **Narrow-lane `FabricDrawingCanvas.jsx` waiver — ~5 LOC expected.** Do NOT touch `zoomGeneration` signal.
  - **Callout preview:** transient React state in `SVGAnnotationLayer` (or new small `useCalloutCreation` hook). During `activeTool === 'callout'` + mouse-down-drag, track `{ arrowTip, currentPointer }` and render a transient `<g className="callout-preview">` with dashed `<rect>` + two dashed `<line>` segments + preview arrowhead `<polygon>`, all at `opacity={0.6}` and `strokeDasharray="5,5"`. On mouseup, fire `setCallouts(prev => [...prev, newCallout])` via a new `onCreateCallout` callback prop and clear preview state.

**Waivers**

Phase 14 requires two narrow-lane waivers against CLAUDE.md Always-Protected:
1. **`src/App.jsx`** — ~10-20 LOC FabricEditCanvas save-callback wrapper for callout commits + `onDeleteSelectedCallouts` and `onCreateCallout` prop drilling at the SVGAnnotationLayer mount sites. The `setCallouts` state itself already exists at `App.jsx:11024` — no new state.
2. **`src/components/FabricDrawingCanvas.jsx`** — ~5 LOC for CREATE-01 dashed preview on `fabric.Line` (creation `:287-292` + reset before commit at `:340`).

### Claude's Discretion

- Exact field names for new props (`onDeleteSelectedCallouts` vs `onCalloutDelete`, `onCreateCallout` vs `onCalloutCreate`).
- Whether `useCalloutCreation` is a separate hook or inlined into `useSVGInteraction`.
- Exact CSS class name(s) for the crosshair (`tool-crosshair` vs `tool-cursor-crosshair`).
- Exact shape of the new Fabric.js Group returned by `calloutEditAdapter.toFabricGroup(reactCallout, pageSize)` — must match what `loadCalloutAnnotation` expects.
- Render order of `<g className="callouts-layer">` relative to `<g className="annotations-layer">` — no visual dependency in Phase 14.
- How transient callout-preview state is cleared on tool switch mid-drag.
- Whether `isUserTyping()` is imported from a new shared utility or inlined in the SVGAnnotationLayer keydown effect.
- Plan decomposition (2-3 plans expected, planner's call).

### Deferred Ideas (OUT OF SCOPE)

- Merging callouts into `annotations.objects[]` (future v3.x cleanup)
- Multi-select delete across annotations + callouts (Phase 14 is single-select per KBD-01)
- Touch event parity for callout drag (mouse/pointer only in Phase 14)
- Keyboard nudge (arrow keys) on selected callout (out of scope per v2.3)
- Copy/paste for callouts (not in combined-tools, not in current repo, permanently backlog)
- CalloutContextMenu (233 LOC, deleted in Phase 14, no re-implementation)
- CalloutEditModal (820 LOC, deleted in Phase 14, replaced by inline edit-on-double-click)

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CALL-10 | Callout renders via SVG (using same `<foreignObject>`+HTML-text pattern that text annotations use today) instead of separate HTML-overlay React system | `renderText` template at `svgAnnotationRenderers.jsx:413-485` is the canonical foreignObject pattern. Existing `renderCallout` at `:500-613` is already 90% built, just dead-coded behind the `filteredCallouts = []` short-circuit at `SVGAnnotationLayer.jsx:779-784`. Revise (not rewrite) and unwind the gate. |
| UX-01 | While line/arrow/callout tool active, SVG interaction layer shows `crosshair` cursor; default returns on deactivation | `SVGAnnotationLayer.jsx:1099-1114` shows the SVG root has explicit `cursor` style, but it's gated only on `interactionState`. Currently `pointerEvents: isInteractive ? 'auto' : 'none'` at `:1109` means the cursor won't show through when tool is line/arrow/callout (because `isInteractive` is `select`/`text-select` only at `:142`). Plan must address pointerEvents gating, not just cursor styling. `FabricDrawingCanvas.jsx:510` already hard-codes `cursor: 'crosshair'` unconditionally, so the line/arrow side is already covered when that canvas is mounted. |
| KBD-01 | Delete/Backspace removes selected line/arrow/callout (single-select), with undo, suppressed when text input focused | An existing handler ALREADY exists at `SVGAnnotationLayer.jsx:194-206` for annotations (uses `deleteSelected` from the hook). Pattern is correct (focus guard, `e.preventDefault()`, `keydown` listener). Phase 14 extends this single handler to also dispatch `onDeleteSelectedCallouts` when `selectedCalloutIds.length > 0`. The existing `<CalloutOverlay>` at `src/components/Callout/index.jsx:55-80` has its own duplicate Delete/Backspace handler that MUST be killed when `<CalloutOverlay>` is removed. |
| CREATE-01 | Dashed preview at 0.6 opacity during click-drag creation of line/arrow/callout, replaced by committed annotation on mouseup | Line/arrow creation lives at `FabricDrawingCanvas.jsx:265-360` (a single `mouse:down`/`mouse:move`/`mouse:up` state machine). The existing `commitShape` at `:243-263` serializes via `shape.toJSON(CUSTOM_PROPS)` — meaning dashed-preview style WILL be persisted into Supabase if not reset before commit. Callout creation currently lives in `CalloutCanvas.jsx:230-468` (being deleted) — Phase 14 ports the `arrowTip / knee / currentMouse` creation state machine into SVGAnnotationLayer's React state. |

## Standard Stack

### Core (no changes)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.x (existing) | Component model | Existing project standard. Revised `renderCallout` is a pure render function consumed by `SVGAnnotationLayer`. |
| Fabric.js | 5.5.2 (LOCKED) | Canvas edit mode (text/shape/callout edit) | LOCKED per v2.3 decision. Phase 14 reuses `fabric.util.enlivenObjects` via `loadCalloutAnnotation` — does NOT touch Fabric internals. |
| Vite | (existing) | Dev server / build | Untouched. |

### Supporting (existing utilities, all reused)

| Library / Module | Path | Purpose | Reuse Strategy |
|------------------|------|---------|----------------|
| `calculateCalloutConnection` | `src/utils/calloutGeometry.js` | Connector geometry between textbox and arrowTip | Already imported in `SVGAnnotationLayer.jsx:36`. Already consumed by the existing dead `renderCallout`. Reused as-is. Liang-Barsky auto-routing inside this file is hooked up later in Phase 18 — Phase 14 uses existing routing behavior. |
| `useFabricCanvas` | `src/hooks/useFabricCanvas.js` | Shared Canvas lifecycle hook with `onBeforeDispose` | Already used by FabricEditCanvas. No changes needed. |
| `saveAnnotationCheckpoint` | App.jsx | Per-action undo checkpoint | Called on every commit (drag-end, delete, edit-exit). Phase 14 calls it in delete handler (KBD-01) and callout edit commit wrapper (Area 2b). |
| `screenToSVG`, `getInverseScale`, `constrainToPage` | `src/utils/svgTransformMath.js` | Coordinate space conversions | Already used by useSVGInteraction. Phase 14's callout-part drag mode reuses the same `ctmInverse`-cached pattern. |
| `getAnnotationBBox` | `src/utils/svgBoundingBox.js` | BBox computation | Used by selection overlay positioning. Not needed for Phase 14 callout work directly but referenced if any planner adds a temporary callout bbox helper. |

### NOT Adding

| Library | Why Not |
|---------|---------|
| Fabric.js 6.x | LOCKED on 5.5.2 per v2.3 decision. Port behavior, not engine. |
| New SVG library | Native SVG via React JSX is sufficient. No need for d3/snap.svg/etc. |
| New keyboard library | `isUserTyping()` is ~10 lines, not worth a dependency. |
| State management library | Existing React `useState` + prop-drilling is the project pattern. |

**Installation:** None. Phase 14 adds zero dependencies.

**Version verification:** Not applicable — this phase changes no `package.json` entries (CLAUDE.md Always-Protected). Existing `fabric@5.5.2` and `react@18.x` from prior phases are confirmed load-bearing and locked.

## Architecture Patterns

### Existing project structure (relevant subset)

```
src/
├── App.jsx                              # ~28000 LOC, ALWAYS-PROTECTED, narrow-lane waiver granted
├── components/
│   ├── SVGAnnotationLayer.jsx           # 1428 LOC, IN SCOPE for this phase
│   ├── FabricEditCanvas.jsx             # 2587 LOC, ALWAYS-PROTECTED, NO waiver
│   ├── FabricDrawingCanvas.jsx          # 520 LOC, ALWAYS-PROTECTED, narrow-lane waiver granted
│   ├── FabricEraserCanvas.jsx           # ALWAYS-PROTECTED, untouched
│   ├── PageAnnotationLayer.jsx          # 9858 LOC, ALWAYS-PROTECTED, untouched
│   ├── SVGSelectionOverlay.jsx          # Selection chrome; not touched in Phase 14 (no new chrome)
│   ├── RotationInputField.jsx           # Phase 12 portal pattern; reference only for Phase 16
│   └── Callout/
│       ├── CalloutCanvas.jsx            # 800 LOC, DELETED in Phase 14
│       ├── CalloutComponent.jsx         # 1445 LOC, DELETED in Phase 14
│       ├── CalloutContextMenu.jsx       # 233 LOC, DELETED in Phase 14
│       ├── CalloutEditModal.jsx         # 820 LOC, DELETED in Phase 14
│       ├── index.jsx                    # 126 LOC, DELETED in Phase 14
│       └── types.js                     # 224 LOC, KEPT as enum/type shim (ARROWHEAD_STYLES, createCallout factory)
├── hooks/
│   ├── useSVGInteraction.js             # 898 LOC, IN SCOPE — adds 'callout-part' drag mode + callout hit-test
│   └── useFabricCanvas.js               # Reused as-is
└── utils/
    ├── svgAnnotationRenderers.jsx       # 697 LOC, IN SCOPE — revise renderCallout signature + add data attrs
    ├── calloutGeometry.js               # Reused as-is
    ├── svgTransformMath.js              # Reused as-is
    ├── svgBoundingBox.js                # Reused as-is
    └── calloutEditAdapter.js            # NEW FILE — adapter between React callout shape and Fabric Group shape
```

### Pattern 1: foreignObject text rendering (the renderText template)

**What:** SVG `<foreignObject>` containing an inner HTML `<div>` that uses CSS for text layout. This is the project's standard approach for any text-in-SVG since Phase 8.

**When to use:** All text content rendered inside the SVG annotation layer.

**Reference (verbatim from `svgAnnotationRenderers.jsx:413-485`):**

```jsx
export const renderText = (obj, index) => {
  const scaleX = Math.abs(obj.scaleX ?? 1);
  const scaleY = Math.abs(obj.scaleY ?? 1);
  const objType = String(obj.type || '').toLowerCase();

  let effectiveWidth, effectiveHeight;
  if (objType === 'textbox' && obj.width && obj.height && !obj.isPdfImported) {
    effectiveWidth = obj.width * scaleX;
    effectiveHeight = obj.height * scaleY;
  } else {
    const measured = measureTextBounds(obj);
    effectiveWidth = measured.width;
    effectiveHeight = measured.height;
  }
  const left = obj.left || 0;
  const top = obj.top || 0;
  const angle = obj.angle || 0;

  const key = `text-${obj.id || index}`;
  const fontSize = obj.fontSize || 16;
  const descenderBuffer = fontSize * 0.35;
  const displayHeight = effectiveHeight + descenderBuffer;
  const rotateTransform = angle !== 0
    ? `rotate(${angle}, ${left + effectiveWidth / 2}, ${top + displayHeight / 2})`
    : undefined;

  return (
    <g key={key} opacity={obj.opacity ?? 1} transform={rotateTransform}>
      <foreignObject
        x={left}
        y={top}
        width={effectiveWidth}
        height={displayHeight}
        overflow="visible"
      >
        <div
          xmlns="http://www.w3.org/1999/xhtml"
          style={{
            width: '100%',
            height: '100%',
            fontSize: `${fontSize}px`,
            fontFamily: obj.fontFamily || 'sans-serif',
            fontWeight: obj.fontWeight || 'normal',
            fontStyle: obj.fontStyle || 'normal',
            color: obj.fill || '#000',
            textAlign: obj.textAlign || 'left',
            lineHeight: obj.lineHeight || 1.16,
            overflow: 'visible',
            wordWrap: 'break-word',
            whiteSpace: 'pre-wrap',
            padding: 0,
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
          }}
        >
          {obj.text || ''}
        </div>
      </foreignObject>
    </g>
  );
};
```

**Key contract bits the revised `renderCallout` must mirror:**
- Outer `<g>` carries opacity + rotateTransform
- `<foreignObject>` carries x/y/width/height in viewBox coords
- Inner `<div>` has the `xmlns="http://www.w3.org/1999/xhtml"` declaration (load-bearing for Safari + Electron)
- Font-smoothing properties for visual parity with Fabric Textbox at edit time
- `overflow: 'visible'` on the foreignObject (not just inner div) — text must escape the box for descenders

### Pattern 2: Renderer dispatch table (the type switch)

**What:** A linear if/else chain in `SVGAnnotationLayer.jsx:683-727` that maps each `obj.type` to a renderer function.

**Verbatim (from `:679-735`):**

```jsx
// --- Type dispatch ---
const objectType = String(obj.type || '').toLowerCase();
let element = null;

if (obj.data && obj.data.type === 'counter') {
  element = renderCounter(obj, i);
} else if (objectType === 'path' && Array.isArray(obj.path) && obj.path.length > 0) {
  element = renderPath(obj, i);
} else if (objectType === 'rect') {
  element = renderRect(obj, i);
} else if (objectType === 'line') {
  element = renderLine(obj, i);
} else if (
  objectType === 'group' &&
  Array.isArray(obj.objects) &&
  obj.objects.length > 0
) {
  const hasLineChild = obj.objects.some(
    (o) => o && (o.type === 'line' || o.type === 'polyline' || o.type === 'path')
  );
  if (hasLineChild) {
    element = renderArrow(obj, i);
  }
} else if (objectType === 'circle' || objectType === 'ellipse') {
  element = renderEllipse(obj, i);
} else if (
  objectType === 'polygon' &&
  Array.isArray(obj.points) &&
  obj.points.length > 0
) {
  element = renderPolygon(obj, i);
} else if (
  objectType === 'polyline' &&
  Array.isArray(obj.points) &&
  obj.points.length > 0
) {
  element = renderPolyline(obj, i);
} else if (
  objectType === 'textbox' ||
  objectType === 'i-text' ||
  objectType === 'text'
) {
  element = renderText(obj, i);
}

if (element) {
  results.push({ obj, index: i, element, isObjectInteractive });
  count++;
}
```

**Why callouts don't go through this dispatch:** The annotation dispatch table iterates `annotations.objects[]`. Callouts live in a separate `callouts[]` array (decision: do not merge in Phase 14). So Phase 14 builds a SECOND dispatch — the `filteredCallouts` `useMemo` at `:779-812` — that iterates `callouts` and calls the new `renderCallout`. Both result lists are then rendered into the SVG root at `:1125-1126` (`{wrappedAnnotations} {filteredCallouts}`).

### Pattern 3: filteredCallouts short-circuit (the gate to open)

**What:** A `useMemo` at `SVGAnnotationLayer.jsx:779-812` that currently returns `[]` immediately, after a comment claiming "CalloutOverlay (in PageAnnotationLayer) handles ALL callout rendering". The full implementation already exists below the early return — it just isn't reached.

**Verbatim (from `:779-812`):**

```jsx
const filteredCallouts = useMemo(() => {
  if (!Array.isArray(callouts) || callouts.length === 0) return [];
  // CalloutOverlay (in PageAnnotationLayer) handles ALL callout rendering and interaction
  // across all tool modes (callout, select, pan). SVG layer must never render callouts
  // to avoid doubled visuals.
  return [];

  const elements = [];
  let count = 0;

  for (let i = 0; i < callouts.length; i++) {
    if (count >= MAX_PREVIEW_CALLOUTS) break;

    const callout = callouts[i];
    if (!callout) continue;

    // Page filter
    if (callout.pageNumber !== pageNumber) continue;

    // Module filtering: when survey panel open with module selected,
    // only show callouts matching that module
    if (showSurveyPanel && selectedModuleId) {
      if (callout.moduleId !== selectedModuleId) continue;
    }

    const element = renderCallout(callout, i, width, height, calculateCalloutConnection);
    if (element) {
      elements.push(element);
      count++;
    }
  }

  return elements;
}, [callouts, pageNumber, showSurveyPanel, selectedModuleId, width, height, activeTool]);
```

**Phase 14 changes:** delete the `return [];` early return AND the obsolete comment, then update the call to `renderCallout` to match its new page-coord signature (caller multiplies by `pageWidth`/`pageHeight` BEFORE the renderer call, so the renderer receives page-space numbers, not normalized 0-1). The dependency array is already correct.

### Pattern 4: Existing `renderCallout` to revise (NOT rewrite)

**What:** A 113-line implementation at `svgAnnotationRenderers.jsx:500-613` that already produces line + line + circle + rect + foreignObject elements. Phase 14 revises it for: (a) page-coordinate inputs, (b) `data-callout-id` and `data-callout-part` attributes, (c) single-name fontFamily.

**Critical existing structure (from `:541-612`):**

```jsx
return (
  <g key={key} opacity={borderOpacity}>
    {/* Line 1: knee to border (skip if shouldHideLine1) */}
    {!connection.shouldHideLine1 && (
      <line
        x1={connection.line1Start.x}
        y1={connection.line1Start.y}
        x2={connection.effectiveKnee.x}
        y2={connection.effectiveKnee.y}
        {...lineStyle}
      />
    )}
    {/* Line 2: knee to arrowTip */}
    <line
      x1={connection.line2Start.x}
      y1={connection.line2Start.y}
      x2={arrowTip.x}
      y2={arrowTip.y}
      {...lineStyle}
    />
    {/* ArrowTip circle */}
    <circle cx={arrowTip.x} cy={arrowTip.y} r={Math.max(2, lineThickness + 0.4)} fill={lineColor} />
    {/* Text box rect */}
    <rect x={textBox.x} y={textBox.y} width={textBox.width} height={textBox.height}
          fill={fillColor} fillOpacity={fillOpacity}
          stroke={lineColor} strokeWidth={Math.max(1, lineThickness * 0.7)}
          rx={4} ry={4} vectorEffect="non-scaling-stroke" />
    {/* Text box text (if callout has text) */}
    {callout.text && (
      <foreignObject x={textBox.x} y={textBox.y} width={textBox.width} height={textBox.height}>
        <div xmlns="http://www.w3.org/1999/xhtml" style={{ ... fontFamily: callout.style?.fontFamily || 'sans-serif', ... }}>
          {callout.text}
        </div>
      </foreignObject>
    )}
  </g>
);
```

**Phase 14 revision instructions for the planner:**

1. Add `data-callout-id={callout.id}` to the outermost `<g>`.
2. Add `data-callout-part="line1"` to Line 1, `"line2"` to Line 2, `"arrowTip"` to the circle, `"textBox"` to the rect, `"text"` to the foreignObject.
3. Change function signature from `renderCallout(callout, index, pageWidth, pageHeight, calculateConnection)` to `renderCallout(callout, index, pageSize, calculateConnection)` where `pageSize = { width, height }` is used at the dispatch boundary instead. Or even simpler: pass already-multiplied `arrowTipPx`, `kneePx`, `textBoxPx` and require the caller to do the math. Either way, the renderer trusts inputs.
4. **Sanitize `callout.style?.fontFamily`** before passing to the inner div — strip CSS fallback stacks. Helper: `const safeFontFamily = (callout.style?.fontFamily || 'Arial').split(',')[0].trim().replace(/['"]/g, '')`. Apply the SAME sanitization in `calloutEditAdapter.toFabricGroup()` when building the Fabric Textbox.
5. Add `WebkitFontSmoothing: 'antialiased'` and `MozOsxFontSmoothing: 'grayscale'` to the inner div style — visual parity with `renderText` so callouts don't look font-rendered differently from text annotations.
6. Mirror `renderText`'s `rotateTransform` only if a future requirement adds rotation to callouts (Phase 14 doesn't). Leave a TODO comment.

### Pattern 5: Data-attribute event delegation (Phase 13 EDIT-13 inheritance)

**What:** One pair of pointerover/pointerout listeners on the stable `svgRef.current` that uses `e.target.closest('[data-callout-id]')` to dispatch hits, so React reconciliation can unmount/remount the callout `<g>` without re-attaching listeners.

**Reference pattern (verbatim from `SVGAnnotationLayer.jsx:225-340`):** The Phase 13 rotation pill delegation. The full ~115 lines establish: stable ancestor listener, `closest()` lookup, `relatedTarget && el.contains(...)` enter/leave emulation, ref-based visibility reads to keep the effect dep array minimal, `eslint-disable react-hooks/exhaustive-deps` is LOAD-BEARING.

**Phase 14 inherits this pattern** for callout hit-testing in `useSVGInteraction.js`. The new `callout-part` drag mode's `handlePointerDown` uses `e.target.closest('[data-callout-id]')` to extract the callout ID and `closest('[data-callout-part]')` to extract the part type. Same pattern, separate data-attribute namespace (`data-callout-*` vs `data-rotation-handle="mtr"`) — they don't collide.

### Pattern 6: Drag-mode invariant (the four-place rule)

**What:** Adding a new drag mode to `useSVGInteraction.js` requires touching FOUR places. Miss one and the drag state gets stuck.

**The four places** (verified in current useSVGInteraction.js source):
1. **`dragStateRef` shape** at `~:44-59` — add `partType`, `originalCalloutPositions` fields
2. **`handlePointerDown`** at `~:160-236` (annotation entry) — add a parallel callout entry path triggered by `e.target.closest('[data-callout-id]')`
3. **`handlePointerMove`** at `:276-...` — add `if (ds.mode === 'callout-part') { switch (ds.partType) { ... } }` branch
4. **`handlePointerUp`** — add the corresponding commit branch that calls `onSaveCallouts` (new prop) and clears `dragStateRef.active`

The current modes (existing): `'move'`, `'group-move'`, `'endpoint'`, `'resize'`, `'rotate'`. Phase 14 adds exactly one: `'callout-part'`.

### Pattern 7: Per-action undo (saveAnnotationCheckpoint)

**What:** Every commit (drag-end, delete, edit-exit) calls `saveAnnotationCheckpoint` so the undo stack captures one entry per user action.

**Phase 14 requirements:**
- KBD-01 delete handler MUST call `saveAnnotationCheckpoint` for both annotation deletes (already wired via `deleteSelected` from the hook) and the new callout deletes.
- The callout edit commit wrapper in App.jsx MUST call `saveAnnotationCheckpoint` after `setCallouts`.
- The callout drag-end commit must do the same.
- The callout creation (CREATE-01 callout half) on mouseup must do the same.

The pattern is "checkpoint AFTER state update, not before". See Phase 9 decisions in `09-CONTEXT.md` for the rationale.

### Anti-Patterns to Avoid

- **Anti-pattern: rebuilding renderCallout from scratch.** A 113-line implementation already exists at `svgAnnotationRenderers.jsx:500`. Revise it. Treating it as greenfield wastes effort and risks reintroducing bugs Phase 8 already fixed (style extraction, line-thickness clamping, fillOpacity bounds).
- **Anti-pattern: merging callouts into `annotations.objects[]`.** Locked OUT in CONTEXT Area 1. Merging would cascade across the entire save/load pipeline (`App.jsx:21333` data loader, Supabase round-trip, history fingerprinting, page filtering — Plan blast radius >2000 LOC). Keep them separate.
- **Anti-pattern: extending FabricEditCanvas with a new callout branch.** The existing `loadCalloutAnnotation` at `:1937-2010` already handles Fabric Group callouts. Wrap React callouts via the adapter; do NOT add a sibling branch. (CONTEXT explicitly preserves the FabricEditCanvas no-waiver boundary.)
- **Anti-pattern: window-level keydown handler in App.jsx for callout delete.** App.jsx waiver is for the callout-commit-wrapper ONLY. Routing Delete/Backspace through App.jsx would balloon the waiver and tangle the focus-guard logic. Keep the new keydown effect inside SVGAnnotationLayer (already has the precedent at `:194-206`).
- **Anti-pattern: leaving the duplicate Delete/Backspace handler in `src/components/Callout/index.jsx:55-80`.** When `<CalloutOverlay>` is deleted, the handler MUST go with it. A leftover would race with the new SVGAnnotationLayer handler.
- **Anti-pattern: persisting `strokeDashArray` and `opacity: 0.6` in the committed Fabric.Line JSON.** `commitShape` at `FabricDrawingCanvas.jsx:243-263` calls `shape.toJSON(CUSTOM_PROPS)` BEFORE removing the shape. The reset MUST happen between the `hasSize` check at `:337-343` and the `commitShape(s)` call at `:353`. Otherwise every saved line/arrow will be persisted as dashed at 0.6 opacity.
- **Anti-pattern: assigning `fontFamily: 'Inter, Arial, sans-serif'` to a Fabric Textbox.** This is exactly the cursor drift bug from 2026-04-08. Sanitize to single name in `calloutEditAdapter` AND in the revised `renderCallout` foreignObject.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SVG-side hit-testing for callout parts | Bounding-box math + manual point-in-shape checks | `e.target.closest('[data-callout-id]')` + `closest('[data-callout-part]')` event delegation | Phase 13 EDIT-13 already proved this pattern is reliable across React reconciliation. SVG element subtree natively dispatches pointer events; `closest()` does the rest. |
| Connector geometry (textbox edge → knee → arrowTip) | Re-derive intersection / clipping math | `calculateCalloutConnection(textBox.x, textBox.y, textBox.width, textBox.height, knee, arrowTip, lineThickness)` from `src/utils/calloutGeometry.js` | Already imported in SVGAnnotationLayer at `:36`. Already used by the dead `renderCallout`. Battle-tested. Liang-Barsky auto-routing inside the same file is hooked up later in Phase 18 — Phase 14 uses existing routing. |
| Callout-edit Canvas mount lifecycle | Build a new Canvas component | Reuse `FabricEditCanvas` via `editType: 'callout'` + adapter | Phase 11 already shipped this. The `loadCalloutAnnotation` function at `:1937` handles `fabric.util.enlivenObjects` correctly. Adapter pattern keeps FabricEditCanvas untouched. |
| Drag-mode pointer event handling | New event listeners on each callout sub-element | Extend `useSVGInteraction.js` with one `'callout-part'` mode + delegation | Aligns with the existing `'move'` / `'group-move'` / `'endpoint'` / `'resize'` / `'rotate'` modes. Single CTM-cached pointer-move loop. Avoids per-element listener proliferation. |
| Keyboard shortcut handler | Window-level handler in App.jsx | New `useEffect` in SVGAnnotationLayer next to the existing one at `:194-206` | Existing pattern proves it works. Focus guard is co-located with the handler. App.jsx waiver stays narrow. |
| Per-action undo state machine | New checkpoint stack | `saveAnnotationCheckpoint` (existing App.jsx helper) | Phase 9 standard. Already wired to undo UI. Just call it. |
| `isUserTyping()` focus guard | Cross-platform focus detection logic | Inline `el.tagName === 'INPUT' \|\| el.tagName === 'TEXTAREA' \|\| el.isContentEditable` (matches the existing handler at `SVGAnnotationLayer.jsx:200`) | The existing pattern is already 4 lines and matches both the React and combined-tools convention. Don't extract a util just to extract a util — inline it consistently. |
| Coordinate space conversions for callout drag | Custom screen-to-page math | `screenToSVG` from `svgTransformMath.js` + cached `ctmInverse` from `dragStateRef` (existing useSVGInteraction pattern) | Already proven in `'move'` mode. CTM caching from `RESEARCH.md Pitfall 1` (Phase 9). Reuse exactly. |

**Key insight:** Phase 14 is deliberately a "wire existing parts" phase, not a "build new parts" phase. The dead `renderCallout` exists. The callout state exists. The connection geometry exists. The edit canvas + load function exist. The Delete handler exists for annotations. The four-place drag-mode pattern exists. The data-attribute delegation pattern exists. The per-action undo exists. Phase 14's job is to LINK them — not to build any of them from scratch.

## Common Pitfalls

### Pitfall 1: `commitShape` serializes preview style into Supabase

**What goes wrong:** `FabricDrawingCanvas.jsx:243-263` calls `shape.toJSON(CUSTOM_PROPS)` to serialize the shape, THEN removes the shape from the canvas. If `strokeDashArray: [5, 5]` and `opacity: 0.6` are still set on the shape at the moment of `toJSON`, those properties land in the saved JSON and the line/arrow renders as dashed-at-60%-opacity forever.

**Why it happens:** The natural place to add the dashed style is at creation time at `:288-292`. The natural place to forget the reset is "I'll handle that later" at `:340`. The toJSON happens at `:244` inside `commitShape`, called from `:353` AFTER the size check.

**How to avoid:** Reset BOTH properties at `:336` (after `hasSize` is computed but before `commitShape(s)` is called). Concretely:
```jsx
if (hasSize) {
  // CREATE-01 reset: dashed preview style must NOT persist into Supabase
  s.set({ strokeDashArray: null, opacity: 1 });
  commitShape(s);
}
```

**Warning signs:** Run a Playwright scenario that creates a line, reloads the page, and asserts the saved line has solid stroke. If the dashed style persists, the reset was missed.

### Pitfall 2: Single-name fontFamily regression (cursor drift bug 2026-04-08)

**What goes wrong:** `defaultCalloutStyle.fontFamily = 'Inter, Arial, sans-serif'` (CSS fallback stack) at `Callout/types.js:122`. If this string is assigned directly to a Fabric.js Textbox in `calloutEditAdapter.toFabricGroup()`, the callout edit mode will reproduce the exact cursor drift bug Phase 12 fought.

**Why it happens:** Fabric.js Textbox measures characters at `CACHE_FONT_SIZE=400px`. The browser may resolve different fonts in the fallback chain at 400px vs the actual size, producing wrong width measurements, which cumulatively drift the cursor caret position to the right of where you're typing.

**How to avoid:** Sanitize before assignment in BOTH places:
1. `calloutEditAdapter.toFabricGroup()` when constructing the Fabric Textbox child
2. The revised `renderCallout` when setting the foreignObject inner div's `style.fontFamily`

Helper:
```jsx
const sanitizeFontFamily = (raw) => {
  if (!raw) return 'Arial';
  return String(raw).split(',')[0].trim().replace(/['"]/g, '');
};
```

**Warning signs:** UAT step "Type 30 characters into a callout textbox in edit mode" — the cursor caret should remain exactly under the last typed character. If it drifts right, the sanitization was missed.

### Pitfall 3: SVG `pointerEvents: 'none'` blocks crosshair cursor

**What goes wrong:** UX-01 says "show crosshair cursor while line/arrow/callout tool active". The natural impl is `cursor: 'crosshair'` on the SVG root. But `SVGAnnotationLayer.jsx:1109` sets `pointerEvents: isInteractive ? 'auto' : 'none'` and `isInteractive` at `:142` is true ONLY for `select` / `text-select`. So when the user activates the line tool, the SVG root's `pointerEvents` is `'none'`, which means the cursor style WILL NOT show through — the cursor falls through to whatever element is below the SVG layer.

**Why it happens:** The `pointerEvents: none` was added in Phase 9 to make non-select tools fall through to the Fabric drawing canvas below. The crosshair cursor was never a Phase 9 concern.

**How to avoid:** Two options for the planner:
1. **Option A (preferred):** Detect callout/line/arrow tool active and set `pointerEvents: 'auto'` on the SVG root, but route ALL pointer events to a no-op handler unless they hit a callout (for the callout tool's create-drag) or fall through via stopPropagation. This re-enables the cursor without breaking the line/arrow tools that drop into FabricDrawingCanvas.
2. **Option B (fallback):** Set the `cursor: 'crosshair'` on the FabricDrawingCanvas portal host (already does) AND on a dedicated overlay div that the SVGAnnotationLayer renders ONLY when callout tool is active. The line/arrow side is then covered by FabricDrawingCanvas (already does this at `:510`), and the callout side is covered by a thin overlay.

Either way: do NOT just set `cursor: 'crosshair'` on the SVG root and walk away — verify with manual UAT that the cursor actually appears.

**Warning signs:** Activate line tool; cursor should be crosshair. If it's the default arrow, the pointerEvents gate is blocking the cursor style.

### Pitfall 4: The four-place drag-mode invariant

**What goes wrong:** Adding a new drag mode to `useSVGInteraction.js` and forgetting one of the four places (`dragStateRef` shape, `handlePointerDown`, `handlePointerMove`, `handlePointerUp`). The drag starts but never ends, or ends but never commits, or pointermove never updates state.

**Why it happens:** The drag state machine is split across ~700 lines and four functions. There's no compile-time check.

**How to avoid:** The plan must explicitly call out all four places as separate task items. Reviewer (or PLAN-CHECK gate) verifies the new mode appears in all four.

**Warning signs:** Drag starts, mouse moves, no visual change → handlePointerMove branch missing. Drag ends, click again, drag still active → handlePointerUp branch missing.

### Pitfall 5: Duplicate Delete handler race

**What goes wrong:** The existing `<CalloutOverlay>` at `src/components/Callout/index.jsx:55-80` has its OWN window-level keydown handler that deletes the selected callout. SVGAnnotationLayer at `:194-206` has its OWN window-level keydown handler that deletes selected annotations. Phase 14 deletes the CalloutOverlay file BUT extends the SVGAnnotationLayer handler to also delete callouts. If the deletion of CalloutOverlay is incomplete (e.g., the file is removed but a stray import remains, or the component is conditionally re-mounted somewhere), the two handlers will race and Delete will fire twice — once removing the callout, once trying to remove an already-removed callout.

**Why it happens:** The CalloutOverlay system was the entire callout subsystem; it has 5 files and ~3424 LOC of dependencies. Deleting it cleanly requires removing the import in App.jsx, removing the `<CalloutOverlay>` JSX in the render loop, and verifying nothing else imports from `src/components/Callout/` except `types.js` (which is kept).

**How to avoid:** Plan task explicitly: "Grep for `from './components/Callout'` and `from './Callout/index'` and verify only `types.js` survives the cleanup". Run grep before AND after the deletion.

**Warning signs:** Press Delete with a callout selected → no error, but Supabase shows two save events fired in 100ms with the same callout removed twice, or a "callout not found" warning appears in the console.

### Pitfall 6: filteredCallouts useMemo dependency array is incomplete after the gate is opened

**What goes wrong:** The current dep array at `:812` includes `[callouts, pageNumber, showSurveyPanel, selectedModuleId, width, height, activeTool]`. After the gate opens and the inner code path runs, additional dependencies appear (`renderCallout`, `calculateCalloutConnection`). React's lint would catch `renderCallout` as a missing dep but `calculateCalloutConnection` is module-scope so it's stable.

**Why it happens:** Dead code paths don't get lint warnings.

**How to avoid:** After unwinding the gate, run `npx eslint src/components/SVGAnnotationLayer.jsx --rule 'react-hooks/exhaustive-deps: error'` and add any missing deps. `renderCallout` is module-scope (imported at `:31`) so it should be stable — verify.

**Warning signs:** Callouts disappear when toggling tools or panning between pages — the memo is recomputing too eagerly, or not eagerly enough.

### Pitfall 7: Adapter inverse function loses precision

**What goes wrong:** `calloutEditAdapter.toFabricGroup(reactCallout, pageSize)` converts normalized → page coords. `calloutEditAdapter.fromFabricGroup(fabricGroup, pageSize)` converts back. If the inverse is off by even 0.1 page-space pixels, the round-trip will drift the callout position every edit cycle, and the success criterion "byte-identical Fabric.js JSON fields after round-trip" will fail.

**Why it happens:** Floating-point math + Fabric internal coordinate transforms (group origin, child positioning) + JSON serialization rounding.

**How to avoid:** Write a unit test for the adapter that does N=10 round-trips and asserts the final coordinates equal the initial coordinates within 1e-9 (or exactly, if the math is integer-clean). Phase 14 should ship this test as part of Plan 14-02.

**Warning signs:** UAT step "open a callout for edit, click outside to commit, open it again, repeat 5 times — the callout should not have moved". If it walks across the page, the adapter inverse is wrong.

### Pitfall 8: `App.jsx:22480` is NOT the keyboard handler — `:23064` is

**What goes wrong:** CONTEXT.md cites `App.jsx:22480-22503` as the "existing L/A/Q shortcut block (reference only)". Verified read shows `:22480` is inside a search-result navigation function (`scrollToMatch`). The actual keyboard handler is at `App.jsx:23064-23205` (`useEffect` with `handleKeyDown`, the `isFormField` guard at `:23067-23072`, and the L/A/Q/V/P/C tool-switch shortcuts).

**Why it happens:** Line numbers drift across sessions; CONTEXT was gathered before the current state.

**How to avoid:** Planner uses `:23064` as the reference point for the existing keyboard handler shape. The new SVGAnnotationLayer keydown handler does NOT modify `:23064` — it lives in a separate component file — but the planner should match the `isFormField` pattern at `:23067-23072` for consistency.

**Warning signs:** Plan mentions modifying App.jsx at `:22480` for keyboard work — STOP and re-read.

## Code Examples

### Example 1: revised renderCallout signature (page-coordinate inputs + data attributes)

```jsx
// Source: revision of src/utils/svgAnnotationRenderers.jsx:500-613
// Signature change: caller multiplies normalized → page BEFORE call.
// New props: data-callout-id on outer <g>, data-callout-part on each child.

export const renderCallout = (callout, index, pageSize, calculateConnection) => {
  if (!callout || !callout.arrowTip || !callout.knee) return null;

  const { width: pageWidth, height: pageHeight } = pageSize;

  // Coordinate conversion now happens at the renderer boundary (was inside earlier).
  // Future Phase 17 collision math operates in page coords — same surface.
  const arrowTip = {
    x: callout.arrowTip.x * pageWidth,
    y: callout.arrowTip.y * pageHeight,
  };
  const knee = {
    x: callout.knee.x * pageWidth,
    y: callout.knee.y * pageHeight,
  };
  const textBox = {
    x: (callout.textBoxPosition?.x ?? 0) * pageWidth,
    y: (callout.textBoxPosition?.y ?? 0) * pageHeight,
    width: Math.max(18, (callout.textBoxWidth ?? 0.1) * pageWidth),
    height: Math.max(18, (callout.textBoxHeight ?? 0.05) * pageHeight),
  };

  // Sanitize fontFamily — see Pitfall 2 (cursor drift bug 2026-04-08).
  // Single font name only, no CSS fallback stacks.
  const safeFontFamily = (callout.style?.fontFamily || 'Arial')
    .split(',')[0]
    .trim()
    .replace(/['"]/g, '');

  // ... existing style extraction unchanged ...

  const connection = calculateConnection(
    textBox.x, textBox.y, textBox.width, textBox.height,
    knee, arrowTip, lineThickness
  );

  const key = `callout-${callout.id || index}`;

  return (
    <g
      key={key}
      data-callout-id={callout.id}
      opacity={borderOpacity}
    >
      {!connection.shouldHideLine1 && (
        <line
          data-callout-part="line1"
          x1={connection.line1Start.x} y1={connection.line1Start.y}
          x2={connection.effectiveKnee.x} y2={connection.effectiveKnee.y}
          {...lineStyle}
        />
      )}
      <line
        data-callout-part="line2"
        x1={connection.line2Start.x} y1={connection.line2Start.y}
        x2={arrowTip.x} y2={arrowTip.y}
        {...lineStyle}
      />
      <circle
        data-callout-part="arrowTip"
        cx={arrowTip.x} cy={arrowTip.y}
        r={Math.max(2, lineThickness + 0.4)}
        fill={lineColor}
      />
      <rect
        data-callout-part="textBox"
        x={textBox.x} y={textBox.y}
        width={textBox.width} height={textBox.height}
        fill={fillColor} fillOpacity={fillOpacity}
        stroke={lineColor} strokeWidth={Math.max(1, lineThickness * 0.7)}
        rx={4} ry={4} vectorEffect="non-scaling-stroke"
      />
      {callout.text && (
        <foreignObject
          data-callout-part="text"
          x={textBox.x} y={textBox.y}
          width={textBox.width} height={textBox.height}
          overflow="visible"
        >
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            style={{
              width: '100%',
              height: '100%',
              fontSize: `${callout.style?.fontSize || 12}px`,
              fontFamily: safeFontFamily,
              color: callout.style?.fontColor || '#000',
              overflow: 'visible',
              wordWrap: 'break-word',
              whiteSpace: 'pre-wrap',
              padding: '4px',
              boxSizing: 'border-box',
              WebkitFontSmoothing: 'antialiased',
              MozOsxFontSmoothing: 'grayscale',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {callout.text}
          </div>
        </foreignObject>
      )}
    </g>
  );
};
```

### Example 2: Unwinding the filteredCallouts gate

```jsx
// Source: revision of src/components/SVGAnnotationLayer.jsx:779-812
// DELETE: the `return [];` early return, the obsolete CalloutOverlay comment.
// CHANGE: pass pageSize object to the new renderCallout signature.

const filteredCallouts = useMemo(() => {
  if (!Array.isArray(callouts) || callouts.length === 0) return [];

  const elements = [];
  let count = 0;

  for (let i = 0; i < callouts.length; i++) {
    if (count >= MAX_PREVIEW_CALLOUTS) break;

    const callout = callouts[i];
    if (!callout) continue;
    if (callout.pageNumber !== pageNumber) continue;

    if (showSurveyPanel && selectedModuleId) {
      if (callout.moduleId !== selectedModuleId) continue;
    }

    const element = renderCallout(
      callout,
      i,
      { width, height },
      calculateCalloutConnection
    );
    if (element) {
      elements.push(element);
      count++;
    }
  }

  return elements;
}, [callouts, pageNumber, showSurveyPanel, selectedModuleId, width, height]);
// Note: activeTool removed from deps — it doesn't affect rendering, only interaction.
// renderCallout and calculateCalloutConnection are module-scope, stable.
```

### Example 3: Extended Delete/Backspace handler in SVGAnnotationLayer

```jsx
// Source: revision of src/components/SVGAnnotationLayer.jsx:194-206
// EXTEND the existing handler to also handle callout deletes via new prop.

useEffect(() => {
  if (selectedIds.size === 0 && (!selectedCalloutIds || selectedCalloutIds.length === 0)) return;
  const handleKeyDown = (e) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;

    // Focus guard — match the existing pattern + Fabric hidden textarea
    const el = document.activeElement;
    if (el && (
      el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.isContentEditable ||
      el.contentEditable === 'true'
    )) return;

    e.preventDefault();
    if (selectedIds.size > 0) {
      deleteSelected(); // existing path — annotations
    } else if (selectedCalloutIds && selectedCalloutIds.length > 0) {
      onDeleteSelectedCallouts(selectedCalloutIds); // new path — callouts
    }
  };
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [selectedIds, selectedCalloutIds, deleteSelected, onDeleteSelectedCallouts]);
```

### Example 4: CREATE-01 dashed preview reset for line/arrow

```jsx
// Source: revision of src/components/FabricDrawingCanvas.jsx:287-292 + :340
// CREATE-01: add dashed preview at creation, reset BEFORE commit so it's not persisted.

// CREATION (line 287-292) — add dashed style + 0.6 opacity to preview line
} else if (tool === 'line' || tool === 'arrow') {
  state.shape = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
    stroke: color,
    strokeWidth: sw,
    strokeUniform: true,
    // CREATE-01 (Phase 14): dashed preview at 0.6 opacity during click-drag.
    // Reset to solid + opacity 1 BEFORE commitShape() so the preview style
    // does NOT persist into Supabase. See Phase 14 RESEARCH Pitfall 1.
    strokeDashArray: [5, 5],
    opacity: 0.6,
  });
}

// COMMIT (line 340) — reset BEFORE commitShape() serializes via toJSON()
if (hasSize) {
  // CREATE-01 reset: dashed preview style must NOT persist into Supabase.
  // commitShape() at :243 calls shape.toJSON(CUSTOM_PROPS) BEFORE removing
  // the shape — if these props are still set, they land in saved JSON.
  if (tool === 'line' || tool === 'arrow') {
    s.set({ strokeDashArray: null, opacity: 1 });
  }
  commitShape(s);
}
```

### Example 5: New `onCreateCallout` prop and creation-state pattern in SVGAnnotationLayer

```jsx
// Source: NEW addition to src/components/SVGAnnotationLayer.jsx
// CREATE-01 (callout half): transient React state + dashed preview.

const [calloutCreation, setCalloutCreation] = useState(null);
// Shape: { arrowTip: {x, y}, currentPointer: {x, y} } in page coords, or null

// In an existing pointer-down handler, branch on activeTool === 'callout':
const handleSvgPointerDownExtended = useCallback((e) => {
  if (activeTool === 'callout' && e.target === svgRef.current) {
    // Convert click point to viewBox coords
    const pt = screenToSVG(svgRef.current, e.clientX, e.clientY);
    setCalloutCreation({ arrowTip: pt, currentPointer: pt });
    return;
  }
  // ...existing handleSvgPointerDown logic...
}, [activeTool, svgRef]);

// In handlePointerMove, update the preview:
useEffect(() => {
  if (!calloutCreation) return;
  const onMove = (e) => {
    const pt = screenToSVG(svgRef.current, e.clientX, e.clientY);
    setCalloutCreation(prev => prev ? { ...prev, currentPointer: pt } : null);
  };
  const onUp = (e) => {
    if (!calloutCreation) return;
    // Build the new callout (mirrors CalloutCanvas.jsx:410-431 logic)
    const arrowTipNorm = { x: calloutCreation.arrowTip.x / width, y: calloutCreation.arrowTip.y / height };
    const textBoxNorm = { x: calloutCreation.currentPointer.x / width, y: calloutCreation.currentPointer.y / height };
    const kneeNorm = {
      x: (arrowTipNorm.x + textBoxNorm.x) / 2,
      y: arrowTipNorm.y - 40 / height,
    };
    const newCallout = createCallout(
      pageNumber, arrowTipNorm, kneeNorm, textBoxNorm,
      120 / width, 32 / height
    );
    onCreateCallout(newCallout); // new prop, dispatched up to App.jsx setCallouts
    setCalloutCreation(null);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  return () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
}, [calloutCreation, width, height, pageNumber, onCreateCallout]);

// Render the dashed preview as a sibling to <wrappedAnnotations> + <filteredCallouts>:
{calloutCreation && (
  <g className="callout-preview" opacity={0.6}>
    <rect
      x={calloutCreation.currentPointer.x}
      y={calloutCreation.currentPointer.y}
      width={120}
      height={32}
      fill="none"
      stroke="#1e293b"
      strokeWidth={2}
      strokeDasharray="5,5"
      rx={4}
    />
    {/* Two dashed connector segments + arrowhead — see CalloutCanvas.jsx for reference */}
  </g>
)}
```

### Example 6: calloutEditAdapter sketch (the missing piece)

```jsx
// NEW FILE: src/utils/calloutEditAdapter.js
// Pure utility — no React, no Fabric imports at module top level.
// Adapter between React callout shape (normalized coords)
// and Fabric.js Group shape (page coords) that loadCalloutAnnotation expects.

import { fabric } from 'fabric';

const sanitizeFontFamily = (raw) =>
  (raw || 'Arial').split(',')[0].trim().replace(/['"]/g, '');

/**
 * Convert React callout (normalized 0-1 coords) to Fabric Group with page coords.
 * The returned object's `.toJSON()` produces a shape compatible with
 * loadCalloutAnnotation in FabricEditCanvas.jsx:1937.
 */
export function toFabricGroup(reactCallout, pageSize) {
  const { width: W, height: H } = pageSize;
  const at = reactCallout.arrowTip;
  const k = reactCallout.knee;
  const tb = reactCallout.textBoxPosition;
  const tbW = reactCallout.textBoxWidth * W;
  const tbH = reactCallout.textBoxHeight * H;
  const style = reactCallout.style || {};

  const line1 = new fabric.Line(
    [tb.x * W + tbW / 2, tb.y * H + tbH / 2, k.x * W, k.y * H],
    { stroke: style.borderColor || '#1e293b', strokeWidth: style.lineThickness || 2, strokeUniform: true }
  );
  const line2 = new fabric.Line(
    [k.x * W, k.y * H, at.x * W, at.y * H],
    { stroke: style.borderColor || '#1e293b', strokeWidth: style.lineThickness || 2, strokeUniform: true }
  );
  const tipDot = new fabric.Circle({
    left: at.x * W - 3, top: at.y * H - 3, radius: 3,
    fill: style.borderColor || '#1e293b',
  });
  const rect = new fabric.Rect({
    left: tb.x * W, top: tb.y * H, width: tbW, height: tbH,
    fill: style.fillColor || '#ffffff',
    stroke: style.borderColor || '#1e293b',
    strokeWidth: style.lineThickness || 2,
    rx: 4, ry: 4, strokeUniform: true,
  });
  const textbox = new fabric.Textbox(reactCallout.text || '', {
    left: tb.x * W + 4, top: tb.y * H + 4,
    width: tbW - 8,
    fontSize: style.fontSize || 14,
    // Pitfall 2: single font name only — no CSS fallback stacks
    fontFamily: sanitizeFontFamily(style.fontFamily),
    fill: style.fontColor || '#1e293b',
  });

  const group = new fabric.Group([line1, line2, rect, tipDot, textbox], {
    // The 'callout' tag lets loadCalloutAnnotation identify this as the target
    // for selection — review FabricEditCanvas.jsx:1937 selection loop for the
    // exact shape it expects. Adapter MAY need a `data: { type: 'callout' }` field.
  });
  // Stash original ID so we can route the commit back to setCallouts
  group.set('reactCalloutId', reactCallout.id);
  return group;
}

/**
 * Reverse: convert an edited Fabric Group back to React callout shape.
 * Iterate group children to extract textbox content + recompute normalized coords.
 */
export function fromFabricGroup(fabricGroup, pageSize, originalReactCallout) {
  const { width: W, height: H } = pageSize;
  const children = fabricGroup.getObjects ? fabricGroup.getObjects() : fabricGroup._objects;
  const textbox = children.find(c => c.type === 'textbox');
  const rect = children.find(c => c.type === 'rect');
  // ... extract positions, compute new normalized coords ...
  return {
    ...originalReactCallout,
    text: textbox?.text || '',
    textBoxPosition: { x: rect.left / W, y: rect.top / H },
    textBoxWidth: rect.width / W,
    textBoxHeight: rect.height / H,
    // arrowTip and knee may or may not move during edit — depends on whether
    // the user can interact with them in edit mode (Phase 14 says NO — edit
    // mode is content editing only; transforms happen in select mode).
  };
}
```

## State of the Art

**No state-of-the-art shifts apply to Phase 14.** This is an in-repo port phase, not a domain-tracking phase. The relevant "state" is the project's own architecture as of v2.2 (shipped 2026-04-14), which is fully documented in the audit pair:

- `.planning/research/CURRENT-REPO-AUDIT.md` — full file map, current render path, data model, edit flow, risk areas, Gap analysis. The exact file:line integration points for CALL-10 unified render.
- `.planning/research/COMBINED-TOOLS-AUDIT.md` — combined-tools' callout data model, creation flow, edit flow, composite structure (seven separate Fabric objects), handle distance constraints, on-drop rollback, resize math, connector routing (`calculateCalloutConnection`), keyboard shortcut map. The baseline behavior Phase 14 ports from.

Locked technical decisions (from STATE.md, no shifts in Phase 14):
- Fabric.js stays at 5.5.2 (LOCKED, do NOT upgrade to 6.x)
- SVG display + Fabric-edit-on-demand architecture is unchanged
- Same Fabric.js JSON data model; zero Supabase migration
- Per-action undo via `saveAnnotationCheckpoint`
- Container-aware canvas sizing via `containerEl.offsetWidth / pageWidth`
- `zoomGeneration` signal stays load-bearing for any mounted Canvas component

**Deprecated / outdated** (to be removed in Phase 14):
- The entire `src/components/Callout/` HTML-overlay React system (CalloutCanvas, CalloutComponent, CalloutContextMenu, CalloutEditModal, index.jsx)
- The `filteredCallouts = []` short-circuit at `SVGAnnotationLayer.jsx:779-784`
- The duplicate Delete/Backspace handler at `Callout/index.jsx:55-80` (goes with the file)

## Open Questions

### 1. Where should the new `useCalloutCreation` hook live?

**What we know:** CONTEXT marks this as Claude's discretion. The transient creation state has a clear bounded lifetime (mouse-down to mouse-up while `activeTool === 'callout'`), and is naturally co-located with SVGAnnotationLayer's existing `useSVGInteraction` consumer.

**What's unclear:** Whether to inline the creation state (~30 LOC) directly into `SVGAnnotationLayer.jsx` or extract it into `src/hooks/useCalloutCreation.js`. Inlining is faster; extracting is more testable.

**Recommendation:** Inline for Phase 14. Extract in Phase 18 if the creation logic grows (e.g., empty-text self-destruct CALL-08 needs to track "newly created" state).

### 2. Should `selectedCalloutIds` be a Set<string> or Array<string>?

**What we know:** The existing `selectedIds` is `Set<number>`. The CONTEXT specifies `selectedCalloutIds: string[]` (array).

**What's unclear:** Whether the array shape is intentional (because callout IDs are strings, easier to JSON-serialize) or accidental (because the CONTEXT author was thinking from a UX perspective, not a state-shape perspective).

**Recommendation:** Use `Set<string>` for symmetry with `selectedIds`. Single-select scope means it's always size 0 or 1 — no semantic difference, but consistent shape across the two state surfaces makes the parallel dispatch branches more readable.

### 3. Should `data-callout-part="text"` on the foreignObject be hit-testable?

**What we know:** The textbox `<rect>` has `data-callout-part="textBox"` and is the natural drag handle. The text `<foreignObject>` is rendered ON TOP of the rect.

**What's unclear:** Whether clicking the text content should: (a) drag the textbox like clicking the rect, (b) enter text edit mode, or (c) be ignored and let the rect underneath catch the click.

**Recommendation:** Phase 14 — option (a), drag the textbox. The foreignObject inner div should have `pointer-events: none` so the rect's hit area underneath catches the click. This matches the Phase 8 `renderText` precedent and avoids text edit being triggered on every drag attempt. Double-click for edit mode is unambiguous because `useSVGInteraction.handleAnnotationDoubleClick` is dispatched from a separate handler.

### 4. Should `loadCalloutAnnotation` receive the adapter's Fabric Group via a different mechanism than `annotations.objects[]`?

**What we know:** `loadCalloutAnnotation` at `:1937-2010` reads from `annotationsRef.current?.objects || []`. This means the adapter would need to inject the converted Fabric Group into a transient annotations array, OR FabricEditCanvas needs a new code path.

**What's unclear:** How exactly the adapter hands off to FabricEditCanvas without touching FabricEditCanvas. One option: at the App.jsx mount site, when `editingAnnotation.editType === 'callout'` and the data is a React callout, build a transient `annotations = { objects: [adaptedFabricGroup] }` and pass it to FabricEditCanvas with `annotationIndex: 0`. The existing `loadCalloutAnnotation` then loads it as if it were a one-element annotation array. Slightly hacky but keeps FabricEditCanvas untouched.

**Recommendation:** Use the transient-annotations approach. The plan should call this out explicitly. It's the cleanest path that respects the FabricEditCanvas no-waiver boundary.

### 5. What happens if a user starts a callout creation drag, switches tool mid-drag (presses V), and releases?

**What we know:** The text-tool overlay at `App.jsx:26352-26432` shows the project's pattern for handling tool switches during drag — it tracks the drag start in `textToolDragRef` and clears it on tool change. The CalloutCanvas being deleted has its own dedup guard at `:399-407`.

**What's unclear:** Whether the planner should add an explicit `useEffect` to clear `calloutCreation` state when `activeTool` changes mid-drag, or rely on the natural pointerup-to-clear path.

**Recommendation:** Add the explicit clear. Tool-switch-mid-drag is a real UX path (user starts callout, realizes they wanted a line, presses L). Without an explicit clear, the next pointerup (which may be inside another tool's surface) would commit a stray callout.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Unit test framework | Node native test runner (`node --test tests/*.test.mjs`) |
| Unit test config file | None — package.json `"test"` script directly invokes `node --test` |
| Quick run command | `npm test` |
| Full unit suite command | `npm test` |
| E2E test framework | Playwright @latest, projects: chromium |
| E2E test config file | `debug/playwright.config.mjs` |
| E2E run command | `npx playwright test --config=debug/playwright.config.mjs` |
| E2E full suite | `npx playwright test --config=debug/playwright.config.mjs` |
| Phase gate command | `npm test && npx playwright test --config=debug/playwright.config.mjs` (113-test baseline must remain green) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CALL-10 | New `renderCallout` produces SVG with required data attributes (`data-callout-id`, `data-callout-part`) for a given React callout input | unit | `node --test tests/calloutRenderer.test.mjs` (NEW) | ❌ Wave 0 |
| CALL-10 | `calloutEditAdapter.toFabricGroup` + `fromFabricGroup` round-trip preserves React callout shape within float tolerance over N=10 cycles | unit | `node --test tests/calloutEditAdapter.test.mjs` (NEW) | ❌ Wave 0 |
| CALL-10 | Existing legacy callouts (saved before Phase 14) load and render through unified path; round-trip via save+reload+save produces byte-identical Fabric.js JSON | E2E + manual UAT | `npx playwright test debug/scenarios/callout-render-roundtrip.spec.mjs` (NEW) + manual on Page 6 | ❌ Wave 0 |
| UX-01 | Activating line/arrow/callout tool switches SVG layer cursor to crosshair; deactivation reverts to default | E2E (visual + cursor inspection) | `npx playwright test debug/scenarios/tool-cursor-crosshair.spec.mjs` (NEW) | ❌ Wave 0 |
| KBD-01 | Pressing Delete/Backspace with a single-selected callout dispatches the new `onDeleteSelectedCallouts` callback and the callout is removed from `setCallouts` state with an undo checkpoint | unit (handler logic) + E2E (full keyboard flow) | `node --test tests/svgKeyboardHandlers.test.mjs` (NEW) + `npx playwright test debug/scenarios/delete-callout-keyboard.spec.mjs` (NEW) | ❌ Wave 0 |
| KBD-01 | Delete/Backspace is suppressed when document.activeElement is an INPUT, TEXTAREA, contentEditable, or Fabric editing field | unit | `node --test tests/svgKeyboardHandlers.test.mjs` (NEW) — same file | ❌ Wave 0 |
| CREATE-01 | Line creation in FabricDrawingCanvas shows dashed stroke + 0.6 opacity during drag; committed line has solid stroke + opacity 1 in saved JSON | E2E | `npx playwright test debug/scenarios/create-preview-line.spec.mjs` (NEW) | ❌ Wave 0 |
| CREATE-01 | Arrow creation in FabricDrawingCanvas shows dashed preview; committed arrow has solid stroke in saved JSON | E2E | (same file as line) | ❌ Wave 0 |
| CREATE-01 | Callout creation in SVGAnnotationLayer shows dashed rect + dashed connector + dashed arrowhead during drag; committed callout has solid stroke | E2E | `npx playwright test debug/scenarios/create-preview-callout.spec.mjs` (NEW) | ❌ Wave 0 |
| Regression baseline | All 113/113 v2.2 tests remain green | unit + E2E | `npm test && npx playwright test --config=debug/playwright.config.mjs` | ✅ |
| Phase 14 drag MVP | Selecting a callout part (arrowTip / knee / textBox / line1 / line2) and dragging updates the React callout state; whole-move via connector-line-drag and Cmd/Ctrl+drag both work | manual UAT | Manual test plan documented in 14-VALIDATION.md | N/A |
| Cursor drift regression | Type 30 chars into a callout textbox in edit mode; caret stays under last typed char | manual UAT | Manual test plan documented in 14-VALIDATION.md | N/A |

### Sampling Rate

- **Per task commit:** `npm test` (Node unit suite — fast, ~5 seconds)
- **Per wave merge:** `npm test && npx playwright test debug/scenarios/callout-render-roundtrip.spec.mjs debug/scenarios/delete-callout-keyboard.spec.mjs debug/scenarios/create-preview-*.spec.mjs debug/scenarios/tool-cursor-crosshair.spec.mjs` (Phase 14 scenario subset)
- **Phase gate:** Full unit + full E2E suite green before `/gsd:verify-work`

### Wave 0 Gaps

The planner must include a Wave 0 task that creates these test scaffolds BEFORE implementation tasks land:

- [ ] `tests/calloutRenderer.test.mjs` — covers CALL-10 renderer signature + data attribute output
- [ ] `tests/calloutEditAdapter.test.mjs` — covers CALL-10 adapter round-trip precision
- [ ] `tests/svgKeyboardHandlers.test.mjs` — covers KBD-01 handler logic + focus guard
- [ ] `debug/scenarios/callout-render-roundtrip.spec.mjs` — covers CALL-10 full save+reload+save E2E
- [ ] `debug/scenarios/tool-cursor-crosshair.spec.mjs` — covers UX-01 cursor switching
- [ ] `debug/scenarios/delete-callout-keyboard.spec.mjs` — covers KBD-01 E2E flow
- [ ] `debug/scenarios/create-preview-line.spec.mjs` — covers CREATE-01 line/arrow preview
- [ ] `debug/scenarios/create-preview-callout.spec.mjs` — covers CREATE-01 callout preview

No new test framework or shared fixture install is needed — both `node --test` and Playwright are already in `package.json` (verified via `"test": "node --test tests/*.test.mjs"` script and `debug/playwright.config.mjs`).

## Sources

### Primary (HIGH confidence) — verified file:line reads

- `src/utils/svgAnnotationRenderers.jsx:1-697` — full file. `renderText` template at `:413-485`, `renderCallout` dead-code at `:500-613`, `renderCounter` at `:632-697`.
- `src/components/SVGAnnotationLayer.jsx:1-1428` — full file. Imports + props at `:23-112`, interaction hook usage at `:126-138`, isInteractive gate at `:142`, existing Delete handler at `:194-206`, EDIT-13 event delegation at `:225-340`, dispatch table at `:679-735`, filteredCallouts gate at `:779-812`, SVG root render at `:1097-1124`.
- `src/hooks/useSVGInteraction.js:1-898` — full file. dragStateRef shape at `:44-59`, handleAnnotationPointerDown at `:160-236`, handleAnnotationDoubleClick at `:255-260`, handleSvgPointerDown at `:266-270`, handlePointerMove at `:276+`, deleteSelected at `:774-791`.
- `src/components/FabricDrawingCanvas.jsx:1-520` — full file. Line/arrow creation state machine at `:265-360`, commitShape at `:243-263`, hard-coded crosshair cursor at `:510`, container-aware sizing at `:412-440`, zoomGeneration handler at `:482-494`.
- `src/components/FabricEditCanvas.jsx:1937-2010` — `loadCalloutAnnotation` function. Reads from `annotationsRef.current.objects`, uses `fabric.util.enlivenObjects`, sets `selectable: true`, `evented: true`, `hasControls: false`, `hasBorders: false` per Phase 13 EDIT-14 decision.
- `src/components/Callout/types.js:1-224` — full file. `ARROWHEAD_STYLES` enum at `:9-16`, `defaultCalloutStyle` at `:115-130` (note: `fontFamily: 'Inter, Arial, sans-serif'` — Pitfall 2), `createCallout` factory at `:211-224`, `hexToRgba` at `:184-191`.
- `src/components/Callout/index.jsx:1-126` — full file. CalloutOverlay shell with duplicate Delete/Backspace handler at `:55-80`.
- `src/components/Callout/CalloutCanvas.jsx:230-468` — handleMouseDown / handleMouseMove / handleMouseUp pattern for callout creation + drag (the system being deleted; reference for the SVG port).
- `src/utils/calloutGeometry.js:1-60` — `findClosestBorderPoint` and constants (`MIN_KNEE_TO_ARROW_DISTANCE`, etc.). The Phase 17/18 collision math sources.
- `src/App.jsx:11020-11045` — callout state declaration (`callouts`, `selectedCalloutId`, clipboard).
- `src/App.jsx:21333` — data loader: `if (data.callouts) setCallouts(data.callouts)`.
- `src/App.jsx:23064-23205` — keyboard shortcut handler with `isFormField` guard pattern (the L/A/Q/V/P/C tool switches; reference only — Phase 14 does NOT modify this block).
- `src/App.jsx:26253-26309` — SVGAnnotationLayer mount site with `callouts={callouts}` and `activeTool={activeTool}` already wired.
- `src/App.jsx:26313-26332` — FabricDrawingCanvas mount site with `activeTool` and `zoomGeneration` props (where the CREATE-01 line/arrow waiver lands).
- `.planning/phases/14-unified-svg-callout-render-shared-tool-foundation/14-CONTEXT.md:1-258` — full file. All four locked decision areas, acceptance criteria, DO NOT CHANGE list, canonical references, reusable assets, integration points, deferred ideas.
- `.planning/REQUIREMENTS.md:1-119` — full file. CALL-10, UX-01, KBD-01, CREATE-01 verbatim acceptance bullets, Out of Scope table, Traceability table.
- `.planning/STATE.md:1-137` — full file. v2.3 decisions, blocker/concerns, last-session resume instructions.
- `.planning/ROADMAP.md:1-200` — Phase 14 details at `:170-199`. Goal, depends-on, success criteria, boundary notes.
- `.planning/config.json` — `nyquist_validation: true` (validation architecture section IS required).
- `debug/playwright.config.mjs` — Playwright config (chromium project, 1400x900 viewport, 120s timeout, baseURL http://localhost:5173).
- `tests/` directory listing — 10 unit test files (`*.test.mjs`) using `node --test` runner.

### Secondary (MEDIUM confidence) — referenced but not exhaustively read

- `.planning/research/CURRENT-REPO-AUDIT.md` (326 lines) — referenced in CONTEXT canonical references; planner must read for Gap analysis. Not loaded into this RESEARCH document due to context budget; the line:file integration points were re-verified directly from the source files above.
- `.planning/research/COMBINED-TOOLS-AUDIT.md` (887 lines) — referenced in CONTEXT canonical references; planner must read for combined-tools baseline. Same approach.
- `.planning/phases/11-text-shape-editing-zoom-cleanup/11-CONTEXT.md` — Phase 11 context for FabricEditCanvas pattern + `editType` prop + per-action undo conventions. Referenced but not re-read in this session.
- `.planning/phases/13-rotation-handle-edit-mode-polish/13-CONTEXT.md` — Phase 13 EDIT-13 event delegation pattern. The current `SVGAnnotationLayer.jsx:225-340` implementation was read directly and is consistent with the documented pattern.

### Tertiary (LOW confidence) — none

This research did not rely on WebSearch or external documentation. Phase 14 is fully grounded in the project's own codebase + the v2.3 audit pair + the locked CONTEXT.md.

## Metadata

**Confidence breakdown:**

- **User Constraints (CONTEXT decisions):** HIGH — copied verbatim from a complete CONTEXT.md gathered 2026-04-15.
- **Standard stack:** HIGH — no new libraries; existing versions locked and verified via direct source reads.
- **Architecture patterns:** HIGH — every pattern (foreignObject template, dispatch table, gate short-circuit, event delegation, four-place drag invariant, per-action undo) was verified by reading the actual source code at the cited line numbers.
- **Don't hand-roll matrix:** HIGH — every "use instead" target exists in the current codebase at a verified location.
- **Pitfalls:** HIGH (Pitfalls 1, 2, 3, 5, 8 directly verified in source; Pitfalls 4, 6, 7 are inherited from prior phase decisions or general best-practice).
- **Code examples:** HIGH for examples 1-4 (revisions of existing code with verified line:file context); MEDIUM for examples 5-6 (new code sketches that the planner will refine).
- **Validation Architecture:** HIGH — test framework verified via package.json + debug/playwright.config.mjs reads.
- **Open questions:** HIGH — gaps are real and called out for the planner to resolve.

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (30 days — stable in-repo port phase, no fast-moving external dependencies)

**Three corrections to CONTEXT.md the planner must apply:**
1. The keyboard handler line reference is `App.jsx:23064-23205`, not `:22480-22503`.
2. `FabricDrawingCanvas.jsx:510` already hard-codes `cursor: 'crosshair'` unconditionally; UX-01 work for line/arrow on the FabricDrawingCanvas surface is a no-op, but the SVGAnnotationLayer's `pointerEvents: 'none'` gate at `:1109` blocks the cursor from showing through when the tool is line/arrow/callout. This is the real UX-01 problem.
3. `commitShape` at `FabricDrawingCanvas.jsx:243-263` calls `shape.toJSON()` BEFORE removing the shape — the CREATE-01 dashed-preview reset MUST happen between the `hasSize` check and the `commitShape` call, otherwise the dashed style will be persisted into Supabase forever.

**One critical regression risk added beyond CONTEXT:**
- `defaultCalloutStyle.fontFamily` at `Callout/types.js:122` is `'Inter, Arial, sans-serif'` — a CSS fallback stack. The 2026-04-08 cursor drift bug (CLAUDE.md gotcha) will recur if this string is assigned directly to a Fabric.js Textbox in `calloutEditAdapter.toFabricGroup()` or to the `<foreignObject>` inner div in the revised `renderCallout`. Sanitization helper provided in Pitfall 2 and Example 1.
