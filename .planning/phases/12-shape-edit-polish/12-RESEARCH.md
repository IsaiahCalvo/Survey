# Phase 12: Shape Edit Polish - Research

**Researched:** 2026-04-12
**Domain:** SVG interaction polish (rotation snap + degree input) + zoom floor extension in an existing React + Fabric.js + Syncfusion stack
**Confidence:** HIGH

## Summary

Phase 12 ships three polish requirements on top of the v2.0 SVG display architecture. EDIT-11 (Shift-snap) and ZOOM-09 (10% zoom floor) are surgical literal-swaps across 3 files / ~5 LOC, fully de-risked by a prior four-dimension research sweep (`ARCHITECTURE.md`, `PITFALLS.md`, `FEATURES.md`, `STACK.md`). Every integration point, every dependency sweep, and every competitor convention has already been verified. There are no unknowns for these two requirements.

EDIT-12 (rotation degree input field) is the only genuinely new work in this phase — a ~60–120 LOC new React component `RotationInputField.jsx`. The user locked an HTML-portal-with-absolute-positioning architecture in CONTEXT.md. This research verified that (a) `createPortal` is already used in 5 places in the codebase, (b) `FabricEditCanvas` is the exact pattern to mirror (it portals an HTML `<div>` into the same page overlay div that hosts `SVGAnnotationLayer`), (c) the parent `<div>` in `App.jsx:24835-24907` is the natural portal host (position: absolute, top/left/width/height 100%, zIndex: 100), and (d) the rotation handle's screen-space position is readable from the existing `selectedIds` + `visualTransform.rotate` state in `SVGAnnotationLayer` plus a `getBoundingClientRect()` on the `<circle>` at `SVGSelectionOverlay.jsx:177-193`.

**Primary recommendation:** Ship EDIT-11 + ZOOM-09 as one atomic commit bundle (~5 LOC across 3 files, literal-swap discipline), and build EDIT-12 as a standalone React component that reuses App.jsx's `FONT_FAMILY` constant, portals into the same overlay div via `createPortal`, and subscribes to parent-owned live-angle state from `useSVGInteraction`. No new dependencies. No changes to Always Protected files except the scoped carve-out at `App.jsx:21999`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**EDIT-11 — Soft Shift-snap:**
- Apply snap inside `src/hooks/useSVGInteraction.js:391-408` (rotate branch of `handlePointerMove`) — the ONLY SVG rotation integration point
- Promote `const newAngle` → `let newAngle` on line 396 so the snap can reassign it
- Snap formula: `if (e.shiftKey && Math.abs(newAngle - nearest45) <= 3) newAngle = nearest45 % 360` — soft threshold, not hard snap
- Shift at 41° stays free at 41° (outside 3° band)
- Shift at 44° snaps to 45° (inside 3° band)
- Shift at 23° stays free at 23° (outside 3° band)
- Releasing Shift always returns to free rotation
- `% 360` wrap is defensive: `Math.round(350/45)*45 = 360` becomes `0`, avoiding a persisted 360° value
- Mid-drag modifier behavior: Shift pressed/released mid-drag takes effect on the NEXT pointer move, not instantly. Matches Figma / Illustrator / Excalidraw convention. Accepted behavior, not a defect.
- **Fabric edit path is OUT of scope** — shape rotation in `FabricEditCanvas.jsx` is commit-lossy (force-zero on load at line 1036, restore pre-edit angle on commit at 476-477).
- **PAL legacy rotation path is OUT of scope** — `src/PageAnnotationLayer.jsx:6080-6355` is dead in v2.0+.

**ZOOM-09 — Zoom floor 10%:**
- **ATOMIC two-file commit** — must land in the SAME commit:
  - `src/utils/zoomController.js:15` — `const MIN_SCALE = 0.5;` → `const MIN_SCALE = 0.1;`
  - `src/App.jsx:21999` — `Math.min(Math.max(parsed, 50), 500)` → `Math.min(Math.max(parsed, 10), 500)` inside `commitZoomInput`
- **Literal-swap only** — change exactly one token per line. No refactor.
- Every zoom entry point funnels through `clampScale` (22 call sites in App.jsx verified) — zero additional integration points.
- Syncfusion's `coerceZoom` already accepts `[10, 1000]` — no viewer-side change needed.
- **Handles at <25% zoom are hard to target** — accepted table-stakes behavior matching Illustrator/Photoshop/Excalidraw. Record in RECONCILIATION.md as known carry-forward.

**EDIT-12 — Rotation degree input field:**
- **HTML portal, absolute-positioned** — new `RotationInputField.jsx` React component portaled to the page overlay div, positioned via CSS transforms from screen-space coords (`getBoundingClientRect()` on the rotation handle)
- Lives as a sibling to `SVGAnnotationLayer` inside the same overlay container
- Component contract: `{ bbox, angle, annotationIndex, onCommit, inverseScale, handleRef }`
- Position recomputed on every `handlePointerMove` tick during rotation drag
- **Visibility:** appears on rotation-drag start, on mtr handle hover >150ms, 500ms grace period after cursor leave, disappears on rotation commit + input blur + grace period expiry
- **Tracked via visibility state in the parent** — not CSS `:hover` (SVG handle and HTML portal can't bridge `:hover`)
- **Enter** = commit (normalized `[0, 360)`, atomic write to `obj.angle`); **Escape** = cancel to pre-edit; **Blur** = commit (Figma convention); invalid/empty input = silent revert
- **Mid-drag drag wins** — active drag's live angle overwrites typed value character-by-character
- **Shift-snap applies to drag only, never to typed values** — typing `44` with Shift held still commits `44°`
- **16px above mtr handle in screen space, always upright**, clamped to viewport
- **Integer degrees only** — display 0-359; internal angle stays float
- **Arrow Up/Down** = ±1° increment; **Shift+Arrow** = ±45° increment; scoped to focused input only
- **Match existing toolbar/panel input style** — reuse app's `FONT_FAMILY`, border-radius, colors

### Claude's Discretion

- Exact grace-period state machine (timers vs React state + setTimeout)
- Shared `useRotationInputVisibility` hook vs inline parent state
- Always-mounted `display: none` / `opacity: 0` vs conditional render — whichever minimizes flicker
- Debounce tuning for 150ms open delay and 500ms close grace period if they feel wrong in the dev server
- Exact z-index stacking for input portal relative to `SVGAnnotationLayer` and Syncfusion page controls
- IME handling nuances (target users are US English — not a primary concern)
- Component file location: `src/components/RotationInputField.jsx` is the likely home, but planner may place it alongside `SVGSelectionOverlay.jsx` if that matches conventions

### Deferred Ideas (OUT OF SCOPE)

- **Cmd+Arrow annotation nudging** — separate keyboard-shortcut phase for MOVEMENT, distinct from EDIT-12's in-input Arrow keys for ROTATION
- **Selection box handles offset outside text border** — carryover todo from v2.0 cleanup
- **Configurable snap increment (15°/22.5°/45°/90°)** — requires Preferences surface (v2.2+)
- **Cursor angle readout during rotate** — EDIT-12 input is a superior alternative
- **Handle auto-scaling at low zoom** — ship Illustrator/Photoshop model, add Figma-style threshold in v2.2 if users complain
- **Snap indicator animation (tick flash, highlight on snap)** — anti-feature, zero surveyed tools ship this
- **Shift-snap on FabricEditCanvas shape rotation preview** — requires first fixing commit-lossy angle override
- **Shift-snap on PAL legacy Pan+modifier rotate path** — dead code, should be deleted not upgraded

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EDIT-11 | Soft Shift-snap to nearest 45° with 3° threshold in SVG shape rotation path | Verified integration point at `useSVGInteraction.js:391-408` is the sole SVG rotation write site. Snap math verified against `normalizeAngle()` `[0, 360)` contract and `% 360` wrap handles the `Math.round(350/45)*45 = 360` edge case. Adjacent `e.shiftKey` precedent exists at line 361 (resize aspect-lock). Commit path at 559-568 writes the snapped value verbatim with no downstream normalization. |
| EDIT-12 | Inline numeric rotation degree input field near mtr handle with hover visibility, integer-only display, Enter/Escape/blur commit semantics, Arrow-key nudging | `createPortal` already used in 5 places in the codebase; FabricEditCanvas at line 214 is the exact pattern to mirror. Parent overlay `<div>` at `App.jsx:24835-24907` is the natural portal target. `SVGSelectionOverlay.jsx:177-193` renders the mtr `<circle>` — a ref-forwarding pattern or `data-rotation-handle` attribute enables `getBoundingClientRect()` positioning. Parent already owns live-angle state via `visualTransform.rotate.angle`. `normalizeAngle()` at `svgTransformMath.js:36` provides `[0, 360)` normalization helper. |
| ZOOM-09 | Extend zoom floor from 50% to 10% on every zoom entry point | Exhaustive sweep confirmed only two literal 50%-floor sites (`zoomController.js:15`, `App.jsx:21999`). 22 `clampScale` call sites all funnel through `MIN_SCALE`. Syncfusion `coerceZoom` already clamps `[10, 1000]`. No scale-division blow-ups at 0.1 — verified across every `/ scale` site. `non-scaling-stroke` + inverseScale handle sizing keep strokes/handles visible at 10%. `App.jsx:435` already contains a `Math.max(0.1, ...)` floor, proving 0.1 is already supported elsewhere in the codebase. |
</phase_requirements>

## Standard Stack

**All libraries already present in the project.** Phase 12 adds zero new dependencies.

### Core (used by this phase)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `react` | 18.2.0 | Component model, hooks, refs | Existing project stack |
| `react-dom` | 18.2.0 | `createPortal` for HTML-inside-SVG overlay | Project uses 6+ portal sites; idiomatic pattern |
| `fabric` | 5.5.2 | JSON deserialization (annotation read-only — no Fabric.js API changes) | Existing project stack; not touched by this phase |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node built-in `node:test` | Node 20+ (bundled) | Unit tests for pure helper modules | When extracting snap math or angle-normalization into `src/utils/` |
| `@playwright/test` | 1.58.2 | Manual debug scenarios (dev-only) | Not for Phase 12 acceptance — manual smoke test in dev server is sufficient |

**Version verification:**
- React 18.2.0 and react-dom 18.2.0 are project-pinned and will not move during this phase. `createPortal` API is stable since React 16 and unchanged in 18.x — no version check needed.
- Fabric.js 5.5.2 is project-pinned. Phase 12 only reads Fabric JSON — no API surface touched.

### Alternatives Considered (and rejected)
| Instead of | Could Use | Tradeoff | Verdict |
|------------|-----------|----------|---------|
| HTML portal for EDIT-12 | SVG `<foreignObject>` inside `SVGSelectionOverlay` | Keeps input inside SVG coordinate system (auto-scales with viewBox). BUT: requires counter-rotation math (the parent `<g>` already applies `rotate(angle, cx, cy)`, which would rotate the input too), has documented focus/IME quirks in Chromium, cannot be portaled outside the `<svg>` tree. | **Rejected** per CONTEXT.md — locked to HTML portal. |
| HTML portal for EDIT-12 | Extend `SVGSelectionOverlay.jsx` with an inline HTML child | Would require mixing HTML and SVG in a single component, and would make the overlay's `transform="rotate()"` rotate the input along with the handles. | **Rejected** per CONTEXT.md — locked to HTML portal as sibling component. |
| `useState` + `setTimeout` for grace-period state machine | XState, a dedicated state machine library | Library adds ~40KB and a new dependency; grace period is 3 states (hidden/visible/closing) — trivially implementable with `useRef` + `setTimeout` | **Rejected** — overkill for 3-state machine |
| Unit tests via `vitest` | Already-present `node:test` | `vitest` would add a dependency and a second test command. `node --test` covers pure-JS utilities (which is all we need for EDIT-11 snap math and EDIT-12 angle normalization). | **Rejected** — stay on existing test infrastructure |

**Installation:** None. Zero new dependencies.

## Architecture Patterns

### Recommended File Structure (delta only)

```
src/
├── App.jsx                                # SCOPED CARVE-OUT: line 21999 only
├── hooks/
│   └── useSVGInteraction.js               # EDIT-11: lines 391-408 rotate branch
├── utils/
│   └── zoomController.js                  # ZOOM-09: line 15 MIN_SCALE
└── components/
    ├── SVGAnnotationLayer.jsx             # Parent wiring for EDIT-12 (minimal: ~5-15 LOC)
    ├── SVGSelectionOverlay.jsx            # Minimal: ref export or data-attribute for mtr handle (≤3 LOC)
    └── RotationInputField.jsx             # NEW FILE for EDIT-12 (~60-120 LOC)
```

### Pattern 1: Literal-Swap Zoom Floor (ZOOM-09)

**What:** Change a single token in each of two files, shipped as one atomic commit.
**When to use:** When a constant is well-funneled (verified by grep) and the change is risk-free at the constant level but requires companion cleanup at a pre-clamp.

**Exact change A — `src/utils/zoomController.js:15`:**
```js
// BEFORE
const MIN_SCALE = 0.5;
// AFTER
const MIN_SCALE = 0.1;
```

**Exact change B — `src/App.jsx:21999` (inside `commitZoomInput`):**
```js
// BEFORE
const clamped = Math.min(Math.max(parsed, 50), 500);
// AFTER
const clamped = Math.min(Math.max(parsed, 10), 500);
```

**Anti-pattern:** Shipping only one. See Pitfall 3 in `.planning/research/PITFALLS.md`.

### Pattern 2: Soft Snap Inside Pointer-Driven State Machine (EDIT-11)

**What:** Read modifier state inside the existing `handlePointerMove` callback, transform the computed value before assigning it to the drag-state ref.
**When to use:** When the snap is pure output rewriting of a value that flows through an existing commit pipeline with no downstream equality or normalization checks.

**Exact change — `src/hooks/useSVGInteraction.js:391-408`:**
```js
} else if (ds.mode === 'rotate') {
  // Compute angle from center of annotation to current pointer position
  const dx = svgPoint.x - ds.centerX;
  const dy = svgPoint.y - ds.centerY;
  const radians = Math.atan2(dy, dx);
  let newAngle = normalizeAngle(radians);   // WAS: const newAngle

  // EDIT-11: soft Shift-snap to nearest 45° within 3° threshold
  if (e.shiftKey) {
    const nearest45 = Math.round(newAngle / 45) * 45;
    if (Math.abs(newAngle - nearest45) <= 3) {
      newAngle = nearest45 % 360;
    }
  }

  const deltaAngle = newAngle - (ds.originalProps.angle || 0);
  dragStateRef.current.currentAngle = newAngle;
  // ... rest unchanged
}
```

The `Math.abs` check is required — unconditional `Math.round` would hard-snap (breaking the "soft threshold" requirement). The `% 360` defensive wrap prevents `Math.round(350/45)*45 = 360` from persisting.

**Source:** Adjacent `e.shiftKey` precedent at `useSVGInteraction.js:361` (resize aspect-lock) uses the same inline pattern — this is the established house style.

### Pattern 3: HTML Portal Into SVG-Hosting Overlay Div (EDIT-12)

**What:** A new React component that calls `createPortal(htmlContent, hostEl)` where `hostEl` is the `<div>` that already hosts `SVGAnnotationLayer`. Positioning is absolute, via CSS transforms computed from `getBoundingClientRect()` of the rotation handle.
**When to use:** When HTML elements (text inputs, context menus, tooltips) need to overlay SVG geometry while remaining in the same coordinate frame as the SVG.

**Precedent in this codebase:**

```js
// src/components/FabricEditCanvas.jsx:214
return createPortal(
  <div
    ref={toolbarRef}
    data-mini-toolbar
    style={{
      ...positionStyle,      // absolute top/left in screen space
      display: 'flex',
      background: '#2D2D2D',
      border: '1px solid #3A3A3A',
      borderRadius: 6,
      padding: '8px 12px',
      // ...
    }}
    onMouseDown={(e) => { e.stopPropagation(); }}
  >
    {/* children */}
  </div>,
  hostEl  // the overlay div
);
```

**Portal target for EDIT-12:** The `<div>` at `src/App.jsx:24835-24907` that currently wraps `<SVGAnnotationLayer>`. It is already:
- `position: absolute, top: 0, left: 0, width: 100%, height: 100%`
- `zIndex: 100`
- `pointerEvents: (svgInteractive && !isEditMode) ? 'auto' : 'none'`
- Sized exactly to the Syncfusion page div

**How RotationInputField gets `hostEl`:**
Option A (recommended): parent `SVGAnnotationLayer` already has `svgRef` pointing at the `<svg>`. Its `.parentElement` is the overlay div. Pass it to `RotationInputField` as a prop, or resolve it inside the component via `svgRef.current?.parentElement`.
Option B: new ref forwarded from `App.jsx` into `SVGAnnotationLayer` and then into `RotationInputField`. More plumbing for no win.

**How RotationInputField gets the mtr handle screen rect:**
Option A (recommended): `SVGSelectionOverlay` adds `data-rotation-handle="mtr"` to the `<circle>` at line 177-193 (zero LOC structural change — just one attribute). `RotationInputField` queries it via `svgRef.current?.querySelector('[data-rotation-handle="mtr"]')` and calls `getBoundingClientRect()`.
Option B: ref forwarding through `SVGSelectionOverlay`. More plumbing, and `SVGSelectionOverlay` is marked read-only for this phase (≤3 LOC allowance).

**Position computation:**
```js
function computeInputPosition(handleRect, hostRect) {
  // Screen-space top-center of the handle, 16px above in screen pixels
  const handleCenterX = handleRect.left + handleRect.width / 2;
  const handleTopY = handleRect.top;
  // Convert to host-relative CSS coordinates
  const left = handleCenterX - hostRect.left;
  const top = handleTopY - hostRect.top - 16 - INPUT_HEIGHT;
  // Clamp to page viewport
  return {
    left: Math.max(4, Math.min(hostRect.width - INPUT_WIDTH - 4, left - INPUT_WIDTH / 2)),
    top: Math.max(4, top),
  };
}
```

### Pattern 4: Parent-Owned Live Angle State (EDIT-12)

**What:** `SVGAnnotationLayer` already receives live angle updates via `useSVGInteraction`'s `visualTransform` during rotation drag. `RotationInputField` consumes the same state instead of duplicating it.
**When to use:** When multiple components need the same live interaction value to avoid drift and bidirectional plumbing.

**Source:** `useSVGInteraction.handlePointerMove` writes `setVisualTransform({ rotate: { angle, ... } })` at `useSVGInteraction.js:403-407`. `SVGAnnotationLayer.jsx:652-654` already reads this to live-update the selection overlay's bbox. `RotationInputField` can read the same `visualTransform.rotate.angle` prop (passed from `SVGAnnotationLayer`) and display `Math.round(angle)` as the input value.

**Commit path:**
`RotationInputField` does NOT write to `obj.angle` directly. It calls `onCommit(annotationIndex, newAngle)` → parent calls the same `onSaveAnnotations` wired at `App.jsx:24867` with `{ source: 'rotation-input', action: 'rotate', checkpointPolicy: 'normal' }`. This reuses the existing undo/redo + Supabase sync + checkpoint pipeline.

### Pattern 5: Hover Intent State Machine (EDIT-12)

**What:** Three-state (hidden / visible / closing) state machine driven by pointer events on the SVG handle + DOM events on the HTML input, plus a 500ms grace timer.

**State transitions:**
- hidden → visible : mtr handle `pointerenter` for >150ms OR rotation drag start
- visible → closing : mtr handle `pointerleave` AND input does not have focus → start 500ms timer
- closing → visible : input `pointerenter` OR input focused → cancel timer
- closing → hidden : 500ms timer fires
- visible → hidden : input blur AND handle is not hovered AND no active drag → transition directly

**Why useRef + setTimeout instead of setState-driven debounce:**
State-driven debounce causes flicker when timers race with React re-renders. Using `useRef` for the timer ID and `setState` only for the committed visibility transition avoids this. The FabricEditCanvas mini-toolbar at `:214` uses a similar pattern (toolbar visibility gated on selected state + mouseDown ref).

### Anti-Patterns to Avoid

- **Touching `FabricEditCanvas.jsx` to add `snapAngle`** — shape rotation there is commit-lossy (see Pitfall 4 in PITFALLS.md). Protected by DO NOT CHANGE.
- **Touching `PageAnnotationLayer.jsx:6080-6355`** — legacy Pan-tool rotate path, dead in v2.0+. Protected by DO NOT CHANGE.
- **Deleting the `commitZoomInput` pre-clamp at App.jsx:21999** — changes input sanitization behavior on a hot path (NaN propagation, absurd-value capping). Literal-swap only.
- **Adding global window keydown/keyup listeners for Shift state in EDIT-11** — mid-drag modifier handling is convention-matching accepted behavior. Don't re-invent what Figma/Illustrator/Excalidraw all do.
- **Installing new rotation state in `RotationInputField`** — duplicates parent state, introduces drift. Always consume the parent's live-angle via props.
- **Rotating the input with the shape** — the input is "always upright in screen space" per CONTEXT.md. Don't apply the selection overlay's `transform="rotate(angle, cx, cy)"` to the portal.
- **Using SVG `<foreignObject>` instead of HTML portal** — locked out by CONTEXT.md due to focus/IME quirks and counter-rotation math requirement.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Portal HTML into React tree | Custom DOM appendChild + manual cleanup | `createPortal` from `react-dom` | Already used 6+ times in this codebase; React event bubbling and cleanup work correctly |
| Angle normalization `[0, 360)` | `angle % 360 + 360 % 360` inline | `normalizeAngle(radians)` at `svgTransformMath.js:36` | Already exists; returns Fabric.js-convention `[0, 360)` (with +90 offset); tested by prior phases |
| SVG handle screen coords during drag | Compute from viewBox + scale | `element.getBoundingClientRect()` | Accounts for all transform ancestors automatically; O(1) per call; already the idiom in FabricEditCanvas at 752+ |
| Zoom floor enforcement per entry point | Add per-entry-point clamps | Rely on existing `clampScale` funnel | 22 call sites already funnel through it; adding per-site guards would duplicate logic |
| Hover-intent debounce | Raw setTimeout chains in JSX | `useRef` for timer IDs + `useEffect` for cleanup | Industry standard for tooltip/popover visibility; avoids stale-closure bugs |
| Keyboard handling in a focused input | Global `window.addEventListener('keydown')` | Component-local `onKeyDown={...}` on the `<input>` | Scoped handlers are destroyed on unmount, no cleanup bugs, no conflict with document-level shortcuts |
| Integer rounding for display | Custom `Math.floor(angle * 10) / 10` | `Math.round(angle)` | CONTEXT.md locked "integer degrees only" |

**Key insight:** Phase 12 is a polish milestone on a mature architecture. Every unknown has a pre-existing, tested helper or pattern in the same codebase. The discipline is "find the helper, then call it" — not "build a new abstraction."

## Common Pitfalls

These pitfalls come from `.planning/research/PITFALLS.md` (already thoroughly researched; reproduced here so the planner doesn't have to cross-read). Each maps to a CONTEXT.md acceptance criterion or DO NOT CHANGE entry.

### Pitfall 1: `const newAngle` → `let newAngle` promotion silently forgotten
**What goes wrong:** Build fails with `Assignment to constant variable.` after the snap branch is added.
**Why it happens:** Diff reviewers add the `if` block without noticing the `const` keyword on the line above.
**How to avoid:** Plan task wording: "Promote `const newAngle` to `let newAngle` on line 396 as part of the same edit."
**Warning signs:** Vite HMR red banner on first save.

### Pitfall 2: Shift pressed MID-drag doesn't snap instantly — user thinks feature is broken
**What goes wrong:** User rotates to 37°, presses Shift without moving pointer, expects snap to 45°, nothing happens.
**Why it happens:** `e.shiftKey` is read inside `handlePointerMove` which only fires on pointer events. Modifier-only changes don't fire `pointermove`.
**How to avoid:** Don't invent a workaround. This matches Figma/Illustrator/Excalidraw convention. Write it into the acceptance criteria as accepted behavior.
**Warning signs:** Only if user feedback explicitly says "snap feels broken." Not a Phase 12 concern.

### Pitfall 3: Zoom floor change shipped in only one file (atomicity violated)
**What goes wrong:** Typing `10` snaps back to `50%` (if only `zoomController.js` ships) OR `clampScale` re-clamps to 0.5 (if only `App.jsx` ships).
**Why it happens:** Caution — leaving `App.jsx` alone because it's Always Protected, or assuming `clampScale` is the only real clamp.
**How to avoid:** Both changes in the same task in PLAN.md, shipped as one commit. Grep the diff for both `MIN_SCALE` AND line 21999 before considering the task done.
**Warning signs:** User types 10, value snaps back to 50. 10-second smoke test catches this.

### Pitfall 4: Scope creep into `FabricEditCanvas.jsx`
**What goes wrong:** A planner reading `STACK.md` (superseded) follows the Q1 recommendation to add `obj.snapAngle=45` in `loadShapeAnnotation`. The snap is then dead code — `commitAndClose` at 476-477 discards the angle.
**How to avoid:** DO NOT CHANGE list includes `FabricEditCanvas.jsx` with the rationale quoted verbatim.
**Warning signs:** Any diff touching FabricEditCanvas. Phase-discipline hook flags it.

### Pitfall 5: Scope creep into legacy PAL rotation path
**What goes wrong:** Developer seeks "consistency" and adds Shift-snap to `src/PageAnnotationLayer.jsx:6080-6355`. Touches ~9,858-line Always Protected file for a dead code path.
**How to avoid:** DO NOT CHANGE list includes `PageAnnotationLayer.jsx` with the legacy-rotation note.
**Warning signs:** Any diff touching PageAnnotationLayer for rotation changes.

### Pitfall 6: Handles at <25% zoom are hard to target — accepted, not a defect
**What goes wrong:** QA reports "handles don't work at 10%." Feels like a regression.
**How to avoid:** CONTEXT.md acceptance criterion explicitly marks this as accepted table-stakes behavior. Record in RECONCILIATION.md as known carry-forward.
**Warning signs:** User feedback "handles broken at low zoom." Defer the real fix to v2.2.

### Pitfall 7: Snapped angle of exactly 360° persisted instead of 0°
**What goes wrong:** `Math.round(350/45)*45 = 8 * 45 = 360`. A persisted `obj.angle === 360` is semantically `0` but could confuse future equality checks.
**How to avoid:** CONTEXT.md locks the `% 360` defensive wrap into the snap expression. Free safety net.
**Warning signs:** None today — no current code checks for exact 0° equality.

### Pitfall 8: `commitZoomInput` pre-clamp restructured instead of literal-swapped
**What goes wrong:** Developer "cleans up" by deleting the redundant-looking pre-clamp. Changes input sanitization for NaN and absurd values (99999).
**How to avoid:** PLAN.md wording: "Change exactly one literal on line 21999: `50` → `10`. Do not restructure. Do not delete the guard."
**Warning signs:** Diff shows more than one token changed on line 21999.

### New pitfalls for EDIT-12 (not in pre-existing research)

### Pitfall 9: RotationInputField double-subscribes to rotation state
**What goes wrong:** RotationInputField maintains its own `useState` for current angle and tries to sync it with the parent's `visualTransform.rotate.angle`. State drift on fast rotation: the input shows a stale value one frame behind the shape.
**Why it happens:** Temptation to "own" the input's display value inside the component for cleanliness.
**How to avoid:** Single source of truth — `RotationInputField` receives `angle` as a prop and displays `Math.round(angle)` via `value={displayAngle}` on a controlled input. Internal state only tracks the *typed* (pending, un-committed) value, not the live drag angle. Drag always wins — if `visualTransform.rotate` is present, it overwrites any typed value.
**Warning signs:** Input lags shape rotation by one frame, or input shows a value different from what committed.

### Pitfall 10: Portal host detached during zoom (regression of a fixed v1.0 bug)
**What goes wrong:** Syncfusion destroys/recreates `e-pv-page-div` during zoom (documented in MEMORY.md "Zoom Bug — FIXED 2026-03-11"). If `RotationInputField`'s portal target is the wrong div, it disconnects mid-zoom.
**Why it happens:** Choosing `hostEl = svgRef.current.parentElement.parentElement` or any ancestor that Syncfusion owns.
**How to avoid:** Portal into the same `<div>` that currently hosts `SVGAnnotationLayer` (at `App.jsx:24835`). That div is a persistent React-owned sibling of Syncfusion's page div — already proven stable across zoom by the v2.0 migration.
**Warning signs:** Input disappears mid-zoom, or input positions itself at the wrong page.

### Pitfall 11: `getBoundingClientRect()` called too often during pointermove
**What goes wrong:** Calling `element.getBoundingClientRect()` on every `pointermove` tick forces a browser layout recalculation. At 60fps on a complex SVG, this can cause jank.
**Why it happens:** "Recompute position on every pointer move" sounds innocuous.
**How to avoid:** Cache the host div's bounding rect once per drag start (it doesn't move during a drag — the page div is stable during a rotation gesture). Only the handle rect needs recomputing per pointer move. For even safer performance, throttle to `requestAnimationFrame` if jank appears in the dev server.
**Warning signs:** Visible jank during rotation at low zoom levels (more SVG geometry to reflow).

### Pitfall 12: Keyboard Arrow-key rotation conflicts with existing shortcuts
**What goes wrong:** `Arrow Up/Down` inside the focused input commits a rotation — but if the user's intent was to scroll the page, the rotation "wins" unexpectedly.
**Why it happens:** Input takes focus, Arrow keys route to the input's keydown handler.
**How to avoid:** Intentional and correct — when the input has focus, its keyboard shortcuts are scoped to the input. User must blur (Escape or click elsewhere) to scroll. CONTEXT.md acceptance criteria already lock this behavior.
**Warning signs:** Only if users complain that focused rotation input blocks scroll. Not a defect.

### Pitfall 13: Cmd+Arrow annotation nudge (deferred) conflicts with Arrow-key nudge inside input
**What goes wrong:** A future phase adds Cmd+Arrow to move selected annotations. When the rotation input is focused and Cmd+Arrow is pressed, both behaviors compete: the input's Arrow handler fires, AND the global annotation-move handler fires.
**Why it happens:** Two keyboard shortcut surfaces both bind Arrow keys.
**How to avoid:** Not a Phase 12 concern (Cmd+Arrow nudging is explicitly deferred). But document the boundary in RECONCILIATION.md so the future nudge phase knows to scope its `window` listener with `if (isFormField) return;` like the existing App.jsx:22029-22034 `isFormField` check.
**Warning signs:** Future phase — not Phase 12.

## Code Examples

Verified patterns from direct file reads in this session:

### Existing `e.shiftKey` precedent (EDIT-11 template)
```js
// Source: src/hooks/useSVGInteraction.js:361-365 (resize aspect-lock)
// Shift-lock aspect ratio (per CONTEXT.md: free resize default, Shift locks)
if (e.shiftKey) {
  const avgScale = (newScaleX + newScaleY) / 2;
  newScaleX = avgScale;
  newScaleY = avgScale;
}
```
This is the exact inline-branch style to use for the EDIT-11 rotate snap.

### Current rotate branch to modify
```js
// Source: src/hooks/useSVGInteraction.js:391-408 (EDIT-11 integration target)
} else if (ds.mode === 'rotate') {
  // Compute angle from center of annotation to current pointer position
  const dx = svgPoint.x - ds.centerX;
  const dy = svgPoint.y - ds.centerY;
  const radians = Math.atan2(dy, dx);
  const newAngle = normalizeAngle(radians);   // → let newAngle
  const deltaAngle = newAngle - (ds.originalProps.angle || 0);

  dragStateRef.current.currentAngle = newAngle;
  setInteractionState('rotating');
  setVisualTransform({
    id: ds.annotationIndex,
    dx: 0, dy: 0,
    rotate: { angle: newAngle, deltaAngle, cx: ds.centerX, cy: ds.centerY },
  });
}
```

### Rotate commit path (no changes needed — just read)
```js
// Source: src/hooks/useSVGInteraction.js:559-568
} else if (ds.mode === 'rotate' && ds.currentAngle !== undefined) {
  const updatedAnnotations = JSON.parse(JSON.stringify(annotations));
  updatedAnnotations.objects[ds.annotationIndex].angle = ds.currentAngle;

  onSaveAnnotations(updatedAnnotations, {
    source: 'object:modified',
    action: 'rotate',
    checkpointPolicy: 'normal',
  });
}
```

### Current zoom floor constant (ZOOM-09 primary target)
```js
// Source: src/utils/zoomController.js:15-24
const MIN_SCALE = 0.5;                  // ← change to 0.1
const MAX_SCALE = 5.0;
const SCALE_EPSILON = 0.0001;

export const clampScale = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return DEFAULT_ZOOM_PREFERENCES.manualScale;
  }
  return Math.min(Math.max(value, MIN_SCALE), MAX_SCALE);
};
```

### Current pre-clamp in commitZoomInput (ZOOM-09 companion target)
```js
// Source: src/App.jsx:21987-22008
const commitZoomInput = useCallback(() => {
  if (!zoomInputValue) {
    setZoomInputValue(String(Math.round(scale * 100)));
    return;
  }

  const parsed = parseInt(zoomInputValue, 10);
  if (isNaN(parsed)) {
    setZoomInputValue(String(Math.round(scale * 100)));
    return;
  }

  const clamped = Math.min(Math.max(parsed, 50), 500);   // ← 50 → 10
  const controller = zoomControllerRef.current;
  if (controller) {
    const normalized = clampScale(clamped / 100);
    controller.setScale(normalized);
    setZoomInputValue(String(Math.round(normalized * 100)));
  } else {
    setZoomInputValue(String(clamped));
  }
}, [zoomInputValue, scale]);
```

### mtr handle target for EDIT-12 positioning
```jsx
// Source: src/components/SVGSelectionOverlay.jsx:164-203 (EDIT-12 positioning reference)
{/* Rotation handle (mtr) */}
<g className="rotation-handle">
  <line
    x1={handles.mt.x} y1={handles.mt.y}
    x2={handles.mtr.x} y2={handles.mtr.y}
    stroke="#d1d1d1" strokeWidth={1 * is}
  />
  <circle
    cx={handles.mtr.x}
    cy={handles.mtr.y}
    r={12 * is}
    fill="#ffffff"
    stroke="#e0e0e0"
    strokeWidth={1 * is}
    style={{
      filter: rotationShadow,
      cursor: 'crosshair',
      pointerEvents: 'auto',
    }}
    onPointerDown={(e) => {
      e.stopPropagation();
      onHandleDrag?.(e, 'mtr');
    }}
  />
  <image
    href={rotateIconSvg}
    x={handles.mtr.x - (16.8 * is) / 2}
    y={handles.mtr.y - (16.8 * is) / 2}
    width={16.8 * is}
    height={16.8 * is}
  />
</g>
```

**Recommended minimal edit (≤3 LOC per CONTEXT.md):** add `data-rotation-handle="mtr"` to the `<circle>` — zero structural change, enables `svgRef.current?.querySelector('[data-rotation-handle="mtr"]')` from parent. Alternatively, add `data-rotation-handle="mtr"` to the wrapping `<g className="rotation-handle">` which is slightly safer (the `<g>`'s bounding rect covers circle + icon + connector line).

### Portal target for EDIT-12 (the overlay div already used)
```jsx
// Source: src/App.jsx:24835-24907
{/* SVG layer -- hidden when eraser or callout edit is mounted */}
<div
  style={{
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: (svgInteractive && !isEditMode) ? 'auto' : 'none',
    zIndex: 100,
    visibility: (isEraserTool || (isEditMode && editingAnnotation?.editType === 'callout'))
      ? 'hidden' : 'visible',
    cursor: (svgInteractive && !isEditMode) ? 'default' : undefined,
  }}
  onPointerDown={(svgInteractive && !isEditMode) ? (e) => e.stopPropagation() : undefined}
>
  <SVGAnnotationLayer ... />
</div>
```

Resolved from inside `SVGAnnotationLayer` as `svgRef.current?.parentElement`. EDIT-12's portal target.

### createPortal precedent (FabricEditCanvas MiniToolbar)
```jsx
// Source: src/components/FabricEditCanvas.jsx:214-260 (pattern to mirror)
return createPortal(
  <div
    ref={toolbarRef}
    data-mini-toolbar
    style={{
      ...positionStyle,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      background: '#2D2D2D',
      border: '1px solid #3A3A3A',
      borderRadius: 6,
      padding: '8px 12px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      // ...
    }}
    onMouseDown={(e) => { e.stopPropagation(); }}
  >
    {/* toolbar children */}
  </div>,
  hostEl
);
```

### Reusable FONT_FAMILY constant (for RotationInputField styling)
```js
// Source: src/App.jsx:116 (same literal repeated in 11+ files — project convention)
const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';
```

This CSS fallback stack is safe for HTML `<input>` elements (browser handles fallback). The 2026-04-08 gotcha about Fabric.js multi-font measurement does NOT apply — that's a Fabric.js Canvas 2D problem, not a browser DOM problem.

### normalizeAngle helper (for EDIT-12 typed-value normalization)
```js
// Source: src/utils/svgTransformMath.js:36-38
// @param {number} radians - Angle in radians from Math.atan2
// @returns {number} Angle in degrees (0-360), Fabric.js convention
export function normalizeAngle(radians) {
  return ((radians * 180 / Math.PI) + 90 + 360) % 360;
}
```

**Caveat:** `normalizeAngle` takes RADIANS, not degrees. For EDIT-12's typed-degree-value normalization, use a simpler inline expression: `((typedDegrees % 360) + 360) % 360`. Do NOT call `normalizeAngle` with a degree value — the `* 180 / Math.PI` scaling would corrupt it. (Consider adding a separate `normalizeDegrees` helper if this needs to be reused elsewhere, but inline is fine for EDIT-12.)

## State of the Art

Phase 12 is a polish milestone in a codebase that already completed the major SVG migration in v2.0. The "state of the art" questions are minor for EDIT-11 and ZOOM-09 (pure literal swaps) and design-convention-driven for EDIT-12.

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 5-timer zoom coordination (PAL settle, App settle, confirm-pending, tier-2 defer, overlay safety) | Zero-timer zoom via SVG viewBox + `zoomGeneration` signal | v2.0 Phase 11 (2026-03) | Phase 12 does NOT reintroduce any JS zoom coordination. SVG scales automatically. |
| Global 50% zoom floor | 10% zoom floor matching Excalidraw | v2.1 Phase 12 (this phase) | Supports whole-page engineering drawing inspection. No dependencies break. |
| Free-only SVG rotation | Free + soft Shift-snap (3° threshold) to 45° increments | v2.1 Phase 12 (this phase) | Matches Illustrator/Miro/Sketch/Photoshop convention for the mechanical-engineer persona. |
| No direct typed rotation input | RotationInputField portal with Enter/Escape/blur commit | v2.1 Phase 12 (this phase) | Scope expansion over original ROADMAP (~11 LOC → ~60-120 LOC). User decision, locked in CONTEXT.md. |

**Deprecated / outdated:**
- `STACK.md` Q1 recommendation to add `obj.snapAngle = 45` in `FabricEditCanvas.jsx`'s `loadShapeAnnotation` — superseded by `ARCHITECTURE.md` Q1c (commit-lossy discovery). Do not follow STACK.md Q1.
- STACK.md's ~11 LOC total estimate — still valid for EDIT-11 + ZOOM-09 (~5 LOC); superseded for the full phase because EDIT-12 adds 60-120 LOC.

## Open Questions

1. **RotationInputField portal host resolution — prop or self-resolve?**
   - What we know: Parent `SVGAnnotationLayer` has `svgRef` pointing at `<svg>`; `svgRef.current?.parentElement` is the target div.
   - What's unclear: Whether planner should pass `hostEl` as an explicit prop or let `RotationInputField` resolve it internally from a passed `svgRef`.
   - Recommendation: **Self-resolve from `svgRef`** — one less prop, the resolution is trivial, and it keeps `RotationInputField` self-contained. The svgRef is already owned by `SVGAnnotationLayer` and can be forwarded (React 18 `forwardRef` is trivial here).

2. **SVGSelectionOverlay ref vs data-attribute for handle position lookup?**
   - What we know: Both options work; data-attribute is simpler (1 LOC); ref requires `forwardRef` and changes component signature.
   - What's unclear: Which matches the project's "house style" for handle coordinate sharing.
   - Recommendation: **`data-rotation-handle="mtr"` attribute on the `<g className="rotation-handle">`** — 1 LOC, fits within CONTEXT.md's "≤3 LOC" budget for that file, no component signature changes. Parent resolves via `svgRef.current?.querySelector('[data-rotation-handle="mtr"]')`.

3. **Hover grace period state machine — inline in `SVGAnnotationLayer` or extracted hook?**
   - What we know: CONTEXT.md leaves this to Claude's discretion. The state is 3 states (hidden/visible/closing) with a 500ms timer.
   - What's unclear: Whether reusability matters (is there a second hover-intent surface in the app?).
   - Recommendation: **Extract to `src/hooks/useHoverIntent.js` (or inline if planner prefers)**. The hook signature would be `useHoverIntent({ openDelay: 150, closeDelay: 500 })` returning `{ isVisible, onEnter, onLeave, forceOpen, forceClose }`. If extracted, it's reusable for future tooltips/popovers. If inlined, it's ~20 LOC in the parent — either is defensible. Planner decides.

4. **Should the snap math be extracted to `svgTransformMath.js` for unit-testability?**
   - What we know: `node --test` requires pure JS modules, not React components. Inline snap in `useSVGInteraction.js` is not unit-testable (it's inside a React hook callback).
   - What's unclear: Whether "testable" is worth the file spread.
   - Recommendation: **Extract to `src/utils/svgTransformMath.js` as `snapAngleToNearest(angle, increment, threshold)` and write a unit test in `tests/svgTransformMath.test.mjs`.** 3 extra LOC in utils, ~20 LOC in tests, but it pays for itself by (a) enabling grep-verifiable acceptance via automated test, (b) allowing the snap logic to be reused for EDIT-12's Shift+Arrow 45° nudge, and (c) satisfying the Nyquist validation requirement (see Validation Architecture below). Planner may inline if they prefer — but note this loses automated coverage for Pitfall 1 (the const/let promotion) and Pitfall 7 (360° wrap).

5. **RotationInputField width — fixed 60px or auto?**
   - What we know: CONTEXT.md says "~60px wide." Integer-only 0-359 display means max 3 characters plus a `°` suffix.
   - What's unclear: Whether planner should size via `ch` units (font-dependent) or fixed pixels.
   - Recommendation: **Fixed `width: 60, minWidth: 60` in pixels.** Matches the zoom input precedent at `App.jsx:26460-26475` which uses `minWidth: '1ch'` inside a `display: inline-grid` for auto-sizing. For a 3-digit integer, fixed 60px is simpler and avoids layout shift.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` + `node:assert/strict` (Node 20+) |
| Config file | None — tests discovered via glob in `package.json:13` |
| Quick run command | `npm test` (runs `node --test tests/*.test.mjs`) |
| Full suite command | `npm test` |
| Test file convention | `tests/*.test.mjs` (ES module, top-level `import` from `../src/utils/`) |
| Existing test count | 7 test files, all covering `src/utils/` pure-JS modules |
| React/JSX testable | **NO** — current infrastructure has no JSDOM or React Testing Library |

**Critical constraint:** The existing test runner only handles pure JavaScript modules. React components (like `RotationInputField.jsx`) cannot be unit-tested under the current infrastructure. This is NOT a gap to fix in Phase 12 — it's a scope boundary.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EDIT-11 | `snapAngleToNearest(44, 45, 3) === 45` (inside threshold) | unit | `node --test tests/svgTransformMath.test.mjs` | Wave 0 — new test file needed if snap helper is extracted |
| EDIT-11 | `snapAngleToNearest(41, 45, 3) === 41` (outside threshold, free) | unit | `node --test tests/svgTransformMath.test.mjs` | Wave 0 |
| EDIT-11 | `snapAngleToNearest(23, 45, 3) === 23` (far from any 45°, free) | unit | `node --test tests/svgTransformMath.test.mjs` | Wave 0 |
| EDIT-11 | `snapAngleToNearest(358, 45, 3) === 0` (360° defensive wrap) | unit | `node --test tests/svgTransformMath.test.mjs` | Wave 0 |
| EDIT-11 | Shift held at 44° commits 45° via pointer drag | manual smoke | Dev server: rotate with Shift at 44° | N/A (UI behavior) |
| EDIT-11 | Shift released mid-drag resumes free rotation | manual smoke | Dev server: press Shift at 45°, release, drag to 50° | N/A |
| EDIT-11 | Shift+resize (aspect-lock) still works — regression guard | manual smoke | Dev server: Shift+drag corner handle | N/A |
| ZOOM-09 | Typing `10` in zoom input commits 10% | manual smoke | Dev server: click zoom input, type `10`, press Enter | N/A |
| ZOOM-09 | Cmd+- decrements to 10% floor, stays there | manual smoke | Dev server: repeatedly Cmd+- from 100% | N/A |
| ZOOM-09 | Fit-page from 10% recomputes correctly | manual smoke | Dev server: at 10%, click Fit-page | N/A |
| ZOOM-09 | Pen stroke visible at 10% (non-scaling-stroke) — regression guard | manual smoke | Dev server: at 10%, draw a pen stroke | N/A |
| ZOOM-09 | `clampScale(0.1) === 0.1` (constant change took effect) | unit | `node --test tests/zoomController.test.mjs` | Wave 0 — new test file needed |
| ZOOM-09 | `clampScale(0.05) === 0.1` (below floor still clamps) | unit | `node --test tests/zoomController.test.mjs` | Wave 0 |
| ZOOM-09 | `clampScale(6.0) === 5.0` (upper bound preserved — regression guard) | unit | `node --test tests/zoomController.test.mjs` | Wave 0 |
| EDIT-12 | `normalizeTypedDegrees(405) === 45` (out-of-range input) | unit | `node --test tests/rotationInputHelpers.test.mjs` | Wave 0 — new helper + test |
| EDIT-12 | `normalizeTypedDegrees(-5) === 355` (negative input) | unit | `node --test tests/rotationInputHelpers.test.mjs` | Wave 0 |
| EDIT-12 | `normalizeTypedDegrees('abc') === null` (invalid input signal) | unit | `node --test tests/rotationInputHelpers.test.mjs` | Wave 0 |
| EDIT-12 | Hover mtr handle for >150ms → input appears | manual smoke | Dev server: hover rotation handle, wait | N/A |
| EDIT-12 | Cursor leaves handle, enters input within 500ms → stays visible | manual smoke | Dev server: hover handle, move to input | N/A |
| EDIT-12 | Type `135` + Enter → annotation rotates to 135° | manual smoke | Dev server: focus input, type, press Enter | N/A |
| EDIT-12 | Type invalid + Enter → silently reverts to pre-edit angle | manual smoke | Dev server: type `abc`, Enter | N/A |
| EDIT-12 | Arrow Up in focused input → +1° commit | manual smoke | Dev server: focus input, press ArrowUp | N/A |
| EDIT-12 | Shift+Arrow Up → +45° commit | manual smoke | Dev server: focus input, Shift+ArrowUp | N/A |
| EDIT-12 | Drag overrides typed value mid-interaction | manual smoke | Dev server: type in input, then drag handle | N/A |
| EDIT-12 | Input position tracks handle during rotation drag | manual smoke | Dev server: rotate handle, watch input | N/A |
| EDIT-12 | Input clamps to viewport at page edge | manual smoke | Dev server: rotate handle near edge at low zoom | N/A |

### Sampling Rate
- **Per task commit:** `npm test` (runs all `tests/*.test.mjs` — Node's test runner is fast, <1 second for the current 7 files)
- **Per wave merge:** `npm test` + manual smoke per requirement (8-minute total manual smoke documented in PITFALLS.md)
- **Phase gate:** `npm test` green + full 8-minute manual smoke executed before `/gsd:verify-work`

### Wave 0 Gaps

The following files need to exist BEFORE implementation tasks can write passing tests:

- [ ] `tests/zoomController.test.mjs` — covers ZOOM-09 unit behavior (`clampScale` boundary conditions at `MIN_SCALE=0.1`)
  - Tests: `clampScale(0.1) === 0.1`, `clampScale(0.05) === 0.1`, `clampScale(1.0) === 1.0`, `clampScale(6.0) === 5.0`, `clampScale(NaN) === 1.0`
  - Dependency: `src/utils/zoomController.js` already exports `clampScale` — zero source changes needed for the test file to import

- [ ] `tests/svgTransformMath.test.mjs` — covers EDIT-11 unit behavior (if snap helper is extracted)
  - Tests: `snapAngleToNearest(44, 45, 3) === 45`, `snapAngleToNearest(41, 45, 3) === 41`, `snapAngleToNearest(23, 45, 3) === 23`, `snapAngleToNearest(358, 45, 3) === 0`, `snapAngleToNearest(0, 45, 3) === 0`
  - Dependency: Planner decides whether to extract `snapAngleToNearest` to `src/utils/svgTransformMath.js`. If inlined in `useSVGInteraction.js`, this test file is NOT written — the snap becomes manual-smoke-only.

- [ ] `tests/rotationInputHelpers.test.mjs` — covers EDIT-12 angle-normalization helpers
  - Tests: `normalizeTypedDegrees(405) === 45`, `normalizeTypedDegrees(-5) === 355`, `normalizeTypedDegrees(0) === 0`, `normalizeTypedDegrees(359) === 359`, `normalizeTypedDegrees('abc') === null`, `normalizeTypedDegrees('') === null`
  - Dependency: New helper module `src/utils/rotationInputHelpers.js` with `normalizeTypedDegrees(value): number | null`. Wave 0 creates the module + test before `RotationInputField.jsx` imports it.

**No framework install needed** — `node:test` and `node:assert/strict` are built-in to Node 20+, which the project already uses for the existing 7 test files.

**No JSDOM / React Testing Library setup recommended for Phase 12** — the scope doesn't justify it. Introducing it would be a separate infrastructure phase. React component behavior (RotationInputField visibility, position, portal mounting) is validated via manual smoke in the dev server, same as every other React component in this codebase.

## Sources

### Primary (HIGH confidence)
- `.planning/research/ARCHITECTURE.md` — full integration point verification for EDIT-11 + ZOOM-09, exhaustive dependency sweep for `MIN_SCALE` + rotation math, reasoning for dropping Fabric-edit snap (Q1c)
- `.planning/research/PITFALLS.md` — 8 pitfalls for EDIT-11 + ZOOM-09, full 8-minute smoke test, "looks done but isn't" checklist, CLAUDE.md gotcha relevance analysis
- `.planning/research/FEATURES.md` — competitor convention matrix, 45° vs 15° snap increment decision, handles-at-low-zoom accepted-behavior documentation
- `.planning/research/STACK.md` — LOC estimates (superseded by ARCHITECTURE.md for Fabric-edit guidance)
- `.planning/research/SUMMARY.md` — executive overview
- `.planning/phases/12-shape-edit-polish/12-CONTEXT.md` — all locked decisions for this phase
- Direct file reads in this research session:
  - `src/hooks/useSVGInteraction.js:350-580` — rotate branch, commit path, resize Shift precedent
  - `src/utils/zoomController.js` — full 237-line file, `MIN_SCALE` constant, `clampScale` funnel
  - `src/App.jsx:21980-22020` — `commitZoomInput` pre-clamp
  - `src/App.jsx:24820-24907` — overlay div structure for portal targeting
  - `src/App.jsx:26430-26509` — zoom input UI styling reference
  - `src/components/SVGSelectionOverlay.jsx` — full 213-line file, mtr handle rendering
  - `src/components/SVGAnnotationLayer.jsx:1-780` — SVGAnnotationLayer parent structure, useSVGInteraction wiring, visualTransform consumption
  - `src/components/FabricEditCanvas.jsx:180-260` — createPortal precedent for EDIT-12
  - `src/utils/svgBoundingBox.js` — `getHandlePositions`, mtr offset, `angle` in bbox
  - `src/utils/svgTransformMath.js` — `normalizeAngle` signature (takes radians, not degrees)
  - `tests/annotationVisibilityRules.test.mjs` — existing test pattern for Nyquist validation
  - `package.json` — test script, React 18.2.0, Fabric.js 5.5.2, no new deps needed

### Secondary (MEDIUM confidence)
- Grep results across `src/` for `MIN_SCALE`, `clampScale`, `createPortal`, `Math.max(*, 0.5)`, `const FONT_FAMILY`, `SVGSelectionOverlay`, `SVGAnnotationLayer`, `input type="(number|text)"` — all directly executed in this session

### Tertiary (LOW confidence)
- None. Every claim in this research file is verified against either a direct file read or a grep result from this session, or is a quoted claim from a prior HIGH-confidence research file in `.planning/research/`.

## Metadata

**Confidence breakdown:**
- EDIT-11 integration point: HIGH — directly verified `useSVGInteraction.js:391-408`, adjacent precedent at line 361, commit path at 559-568. Prior `ARCHITECTURE.md` exhaustively swept for alternative write sites.
- EDIT-11 snap math: HIGH — verified `normalizeAngle` signature, tested the `% 360` wrap logic against `Math.round(350/45)*45 = 360` edge case.
- ZOOM-09 integration points: HIGH — directly verified `zoomController.js:15` and `App.jsx:21999`. 22 `clampScale` call sites grep-confirmed. Zero hidden 0.5/50 floors anywhere in `src/`.
- ZOOM-09 scale-division safety: HIGH — prior research swept every `/ scale` site in `src/` and confirmed no blow-ups at 0.1.
- EDIT-12 portal architecture: HIGH — `createPortal` already in use in 6 files; `FabricEditCanvas.jsx:214` is an exact pattern to mirror; portal target div verified at `App.jsx:24835`.
- EDIT-12 parent state ownership: HIGH — `useSVGInteraction` already owns `visualTransform.rotate.angle`; `SVGAnnotationLayer:652-654` already reads it for the selection overlay. Phase 12's `RotationInputField` reads the same state.
- EDIT-12 mtr handle position resolution: MEDIUM-HIGH — `getBoundingClientRect()` on an SVG `<circle>` or `<g>` is supported by all modern browsers; Electron's Chromium honors it. Only MEDIUM (not HIGH) because the specific edge case of a rotated parent group + low-zoom viewBox produces a correctly-sized bbox but the assumption should be verified in dev server before shipping.
- EDIT-12 hover-intent state machine: MEDIUM — the pattern is standard but there's no precedent in this codebase for this exact state machine. Planner should expect a short tuning pass in the dev server.
- Validation Architecture: HIGH — `node --test tests/*.test.mjs` pattern verified, existing test file inspected, Wave 0 gaps enumerable without code changes.

**Research date:** 2026-04-12
**Valid until:** 2026-05-12 (30 days — stable React + Fabric.js + Node LTS ecosystem). If Phase 12 is not started within 30 days, re-verify that `createPortal` API has not changed in react-dom 18.x (extremely unlikely) and that no v2.1 Stage 1 work has landed in parallel.

---

*Research for: Phase 12 Shape Edit Polish (v2.1)*
*Consumer: `gsd-planner` → produces `12-PLAN-01.md` + `12-PLAN-02.md`*
*Prior research that informed this file: `.planning/research/{ARCHITECTURE,PITFALLS,FEATURES,STACK,SUMMARY}.md` (2026-04-12)*
