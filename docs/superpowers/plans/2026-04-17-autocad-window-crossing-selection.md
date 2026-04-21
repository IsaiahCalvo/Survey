# AutoCAD Window + Crossing Selection — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the dormant AutoCAD-style marquee selection onto the live SVG selection surface — left-to-right drag draws a solid blue Window box that selects only fully-enclosed annotations; right-to-left drag draws a dashed green Crossing box that selects anything it touches.

**Architecture:** A new pure adapter maps each SVG-layer annotation into the shape signature the existing `doesRectIntersectObject` dispatcher already understands. A new pure marquee helper module owns direction detection, min-drag threshold, full-containment test, and the hit-resolution function. Marquee state and pointer handling are added to `useSVGInteraction`, gated on `activeTool === 'select'` and empty-space pointerdown. The marquee renders as a single `<rect>` inside the existing `<svg>` page layer in `SVGAnnotationLayer.jsx` with `pointer-events: none`, above annotation content and below the hover/selection overlay. The geometry library is re-used as-is.

**Tech Stack:** React + hooks, SVG with viewBox scaling, Fabric.js 5.5.2 annotation data model, Node test runner (`node --test tests/*.test.mjs`) for pure-math unit tests.

**Out of scope (deferred):** Cross-page marquee, Alt-to-subtract, Cmd/Ctrl modifiers, live hover-preview of candidates during drag, mini-toolbar integration, deleting the dormant Fabric-layer handlers.

**Canonical references:**
- Spec + acceptance criteria: `.planning/phases/19-autocad-window-crossing-selection/19-CONTEXT.md`
- Dormant reference implementation (read-only, do not edit): `src/PageAnnotationLayer.jsx:7411-7854`
- Geometry dispatcher (re-use as-is, do not edit): `src/utils/geometryHitTest.js:1695` (`doesRectIntersectObject`)
- Existing SVG bbox helper (re-use for Window mode): `src/utils/svgBoundingBox.js:19` (`getAnnotationBBox`)
- Target surface: `src/components/SVGAnnotationLayer.jsx`
- Target hook: `src/hooks/useSVGInteraction.js`

**DO NOT CHANGE (from 19-CONTEXT.md):**
- `src/App.jsx`
- `src/components/PageAnnotationLayer.jsx` (reference only — do not re-enable)
- `src/components/FabricDrawingCanvas.jsx` / `FabricEraserCanvas.jsx` / `FabricEditCanvas.jsx` / `FabricTextCanvas.jsx`
- `src/utils/geometryHitTest.js`
- `package.json` / `vite.config.js`

`src/components/SVGAnnotationLayer.jsx` is an Always-Protected file with an explicit scoped waiver for **marquee render + empty-space pointer wiring + selection integration only**. No other edits.

---

## File Structure

**Create:**

- `src/utils/svgToFabricShape.js` — thin adapter. Maps an SVG-layer annotation into the shape signature `doesRectIntersectObject` expects (`type`, `left`, `top`, `width`, `height`, `points`, `strokeWidth`, `calcTransformMatrix` when needed). Read-only pass-through, no math.
- `src/utils/marqueeSelection.js` — pure math. Exports: `MIN_DRAG_PX = 5`, `getMarqueeDirection({ startX, endX })` → `'window' | 'crossing'`, `getMarqueeRect({ startX, startY, endX, endY })` → `{ left, top, right, bottom, width, height }`, `isBBoxFullyContained(marqueeRect, bbox)` → `boolean`, `isBBoxOverlapping(marqueeRect, bbox)` → `boolean`, `resolveMarqueeHits({ marqueeRect, direction, annotations, callouts })` → `{ annotationIndices: number[], calloutIds: string[] }`.
- `tests/svgToFabricShape.test.mjs` — adapter unit tests.
- `tests/marqueeSelection.test.mjs` — marquee math unit tests.

**Modify:**

- `src/hooks/useSVGInteraction.js` — add marquee state, accept `activeTool` prop, branch `handleSvgPointerDown` on empty-space + select tool, branch `handlePointerMove` and `handlePointerUp` on active marquee, add window-level Escape listener during marquee. Export `marqueeRect` + `marqueeDirection` for rendering.
- `src/components/SVGAnnotationLayer.jsx` — pass `activeTool` into the hook, render an SVG `<rect>` from `marqueeRect` + `marqueeDirection` (blue solid for window, dashed green for crossing), with `pointer-events: none`, placed above annotation content and below the hover/selection overlay.

---

## Chunk 1: Pure Helpers + Tests

All work in this chunk is pure-math and unit-testable with the existing `node --test` runner. No React, no DOM.

### Task 1: svgToFabricShape adapter

**Files:**
- Create: `src/utils/svgToFabricShape.js`
- Test: `tests/svgToFabricShape.test.mjs`

**Read first:**
- `src/utils/geometryHitTest.js:1695-1830` — understand the shape fields each `case` in the dispatcher consumes.
- `src/utils/svgBoundingBox.js:19-55` — understand how bbox is computed from an SVG-layer annotation.
- `src/PageAnnotationLayer.jsx:7411-7854` — skim how the dormant reference feeds shapes into the helper.
- `src/hooks/useSVGInteraction.js:1-100` — see how annotations and callouts flow through the hook (shape of `annotations.objects[i]` and the callouts array).

- [ ] **Step 1: Write the failing test**

Test a handful of representative cases. Example minimum coverage:

```js
// tests/svgToFabricShape.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toFabricShape } from '../src/utils/svgToFabricShape.js';

test('rect annotation passes through with type, left, top, width, height, strokeWidth', () => {
  const ann = { type: 'rect', left: 10, top: 20, width: 50, height: 40, strokeWidth: 2 };
  const shape = toFabricShape(ann);
  assert.equal(shape.type, 'rect');
  assert.equal(shape.left, 10);
  assert.equal(shape.width, 50);
  assert.equal(shape.strokeWidth, 2);
});

test('pen path (type=path) carries points or path data plus strokeWidth', () => {
  const ann = { type: 'path', path: [['M', 0, 0], ['L', 10, 10]], strokeWidth: 3, left: 0, top: 0, width: 10, height: 10 };
  const shape = toFabricShape(ann);
  assert.equal(shape.type, 'path');
  assert.ok(Array.isArray(shape.path));
  assert.equal(shape.strokeWidth, 3);
});

test('line carries endpoints via points array', () => {
  const ann = { type: 'line', x1: 0, y1: 0, x2: 100, y2: 50, strokeWidth: 1 };
  const shape = toFabricShape(ann);
  assert.equal(shape.type, 'line');
  // helper expects either x1..y2 or a Fabric-compatible shape; preserve whichever the
  // geometry library consumes (verify against the actual case body).
});

test('callout adapts to a single rectangle covering the full callout bbox', () => {
  const callout = {
    id: 'c1',
    arrowTip: { x: 0.2, y: 0.3 },
    knee: { x: 0.25, y: 0.35 },
    textBoxPosition: { x: 0.3, y: 0.3 },
    textBoxWidth: 0.1,
    textBoxHeight: 0.05,
  };
  const shape = toFabricShape(callout, { pageWidth: 1000, pageHeight: 800, kind: 'callout' });
  assert.equal(shape.type, 'rect'); // bbox-as-rect is fine for crossing dispatch
  // bbox covers all three anchor points in absolute page coords
  assert.ok(shape.left <= 200);
  assert.ok(shape.top <= 240);
});

test('unknown type falls back to a bbox rect signature', () => {
  const ann = { type: 'weird', left: 5, top: 5, width: 10, height: 10 };
  const shape = toFabricShape(ann);
  assert.equal(shape.type, 'rect');
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `node --test tests/svgToFabricShape.test.mjs`
Expected: FAIL — module not yet created.

- [ ] **Step 3: Write the adapter**

Create `src/utils/svgToFabricShape.js` with a single exported `toFabricShape(annotation, { pageWidth, pageHeight, kind } = {})`. Logic:

- If `kind === 'callout'`, compute a bounding rect in absolute page coords from the callout's three anchors plus the textbox rect, and return `{ type: 'rect', left, top, width, height, strokeWidth: 0 }`. No rotation — callouts are axis-aligned on the SVG layer.
- Otherwise switch on `annotation.type`:
  - `rect`, `circle`, `ellipse`, `line`, `polyline`, `triangle`, `textbox`, `text`, `i-text`, `group`, `path` → shallow-copy the fields the corresponding `doesRectIntersectObject` case reads (see `geometryHitTest.js:1695-1830`). Include `strokeWidth` (default 0) and `calcTransformMatrix` when the annotation has one.
  - Anything else → return a bbox-derived rect `{ type: 'rect', left, top, width, height }` using `getAnnotationBBox` from `svgBoundingBox.js`.
- Never mutate the input. Return a plain object.

- [ ] **Step 4: Run tests, verify they pass**

Run: `node --test tests/svgToFabricShape.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/svgToFabricShape.js tests/svgToFabricShape.test.mjs
git commit -m "feat(19): add SVG-to-Fabric shape adapter for marquee hit-test"
```

---

### Task 2: marqueeSelection pure helpers

**Files:**
- Create: `src/utils/marqueeSelection.js`
- Test: `tests/marqueeSelection.test.mjs`

**Read first:**
- `src/utils/svgToFabricShape.js` (just created).
- `src/utils/geometryHitTest.js:1695` (`doesRectIntersectObject` signature).
- `src/utils/svgBoundingBox.js:19` (`getAnnotationBBox` signature).
- `src/PageAnnotationLayer.jsx:7411-7854` (direction detection, visual constants, 5px threshold — copy verbatim).
- `.planning/phases/19-autocad-window-crossing-selection/19-CONTEXT.md` (acceptance criteria for modifier behavior, empty result, cross-page clamp).

- [ ] **Step 1: Write the failing tests**

```js
// tests/marqueeSelection.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_DRAG_PX,
  getMarqueeDirection,
  getMarqueeRect,
  isBBoxFullyContained,
  isBBoxOverlapping,
  resolveMarqueeHits,
} from '../src/utils/marqueeSelection.js';

test('MIN_DRAG_PX is 5', () => {
  assert.equal(MIN_DRAG_PX, 5);
});

test('getMarqueeDirection returns window when endX >= startX', () => {
  assert.equal(getMarqueeDirection({ startX: 10, endX: 50 }), 'window');
  assert.equal(getMarqueeDirection({ startX: 10, endX: 10 }), 'window'); // edge case
});

test('getMarqueeDirection returns crossing when endX < startX', () => {
  assert.equal(getMarqueeDirection({ startX: 50, endX: 10 }), 'crossing');
});

test('getMarqueeRect normalizes coordinates regardless of drag direction', () => {
  const r1 = getMarqueeRect({ startX: 10, startY: 20, endX: 100, endY: 80 });
  const r2 = getMarqueeRect({ startX: 100, startY: 80, endX: 10, endY: 20 });
  assert.deepEqual(r1, r2);
  assert.equal(r1.left, 10);
  assert.equal(r1.right, 100);
  assert.equal(r1.width, 90);
  assert.equal(r1.height, 60);
});

test('isBBoxFullyContained is true when every edge is inside', () => {
  const marquee = { left: 0, top: 0, right: 100, bottom: 100 };
  const bbox = { left: 10, top: 10, right: 50, bottom: 50 };
  assert.equal(isBBoxFullyContained(marquee, bbox), true);
});

test('isBBoxFullyContained is false when any edge is outside', () => {
  const marquee = { left: 0, top: 0, right: 100, bottom: 100 };
  const bbox = { left: 10, top: 10, right: 150, bottom: 50 };
  assert.equal(isBBoxFullyContained(marquee, bbox), false);
});

test('isBBoxOverlapping uses standard AABB overlap (no touch)', () => {
  const marquee = { left: 0, top: 0, right: 50, bottom: 50 };
  assert.equal(isBBoxOverlapping(marquee, { left: 40, top: 40, right: 60, bottom: 60 }), true);
  assert.equal(isBBoxOverlapping(marquee, { left: 60, top: 60, right: 70, bottom: 70 }), false);
});

test('resolveMarqueeHits in window mode returns only annotations fully enclosed', () => {
  const marquee = { left: 0, top: 0, right: 100, bottom: 100 };
  const annotations = {
    objects: [
      { type: 'rect', left: 10, top: 10, width: 20, height: 20 }, // fully inside
      { type: 'rect', left: 90, top: 90, width: 50, height: 50 }, // straddles right/bottom
    ],
  };
  const { annotationIndices } = resolveMarqueeHits({
    marqueeRect: marquee,
    direction: 'window',
    annotations,
    callouts: [],
    pageWidth: 1000,
    pageHeight: 800,
  });
  assert.deepEqual(annotationIndices, [0]);
});

test('resolveMarqueeHits in crossing mode returns annotations whose bbox overlaps', () => {
  const marquee = { left: 0, top: 0, right: 100, bottom: 100 };
  const annotations = {
    objects: [
      { type: 'rect', left: 90, top: 90, width: 50, height: 50 },  // overlaps
      { type: 'rect', left: 200, top: 200, width: 10, height: 10 }, // no overlap
    ],
  };
  const { annotationIndices } = resolveMarqueeHits({
    marqueeRect: marquee,
    direction: 'crossing',
    annotations,
    callouts: [],
    pageWidth: 1000,
    pageHeight: 800,
  });
  assert.deepEqual(annotationIndices, [0]);
});

test('resolveMarqueeHits includes callouts via the adapter', () => {
  const marquee = { left: 0, top: 0, right: 1000, bottom: 800 }; // whole page
  const callouts = [
    { id: 'c1', arrowTip: { x: 0.1, y: 0.1 }, knee: { x: 0.12, y: 0.12 },
      textBoxPosition: { x: 0.15, y: 0.1 }, textBoxWidth: 0.05, textBoxHeight: 0.03 },
  ];
  const { calloutIds } = resolveMarqueeHits({
    marqueeRect: marquee,
    direction: 'window',
    annotations: { objects: [] },
    callouts,
    pageWidth: 1000,
    pageHeight: 800,
  });
  assert.deepEqual(calloutIds, ['c1']);
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `node --test tests/marqueeSelection.test.mjs`
Expected: FAIL — module not yet created.

- [ ] **Step 3: Write the helpers**

Create `src/utils/marqueeSelection.js`:

```js
import { getAnnotationBBox } from './svgBoundingBox.js';
import { doesRectIntersectObject } from './geometryHitTest.js';
import { toFabricShape } from './svgToFabricShape.js';

export const MIN_DRAG_PX = 5;

export function getMarqueeDirection({ startX, endX }) {
  return endX >= startX ? 'window' : 'crossing';
}

export function getMarqueeRect({ startX, startY, endX, endY }) {
  const left = Math.min(startX, endX);
  const right = Math.max(startX, endX);
  const top = Math.min(startY, endY);
  const bottom = Math.max(startY, endY);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function isBBoxFullyContained(marquee, bbox) {
  return (
    bbox.left >= marquee.left &&
    bbox.right <= marquee.right &&
    bbox.top >= marquee.top &&
    bbox.bottom <= marquee.bottom
  );
}

export function isBBoxOverlapping(marquee, bbox) {
  return !(
    bbox.right < marquee.left ||
    bbox.left > marquee.right ||
    bbox.bottom < marquee.top ||
    bbox.top > marquee.bottom
  );
}

function bboxFromCallout(callout, pageWidth, pageHeight) {
  const xs = [
    callout.arrowTip.x, callout.knee.x,
    callout.textBoxPosition.x, callout.textBoxPosition.x + callout.textBoxWidth,
  ].map((n) => n * pageWidth);
  const ys = [
    callout.arrowTip.y, callout.knee.y,
    callout.textBoxPosition.y, callout.textBoxPosition.y + callout.textBoxHeight,
  ].map((n) => n * pageHeight);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return { left, top, right, bottom };
}

export function resolveMarqueeHits({
  marqueeRect, direction, annotations, callouts, pageWidth, pageHeight,
}) {
  const annotationIndices = [];
  const calloutIds = [];

  const objects = annotations?.objects || [];
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (!obj || !obj.type) continue;
    const bbox = safeBBox(obj);
    if (!bbox) continue;

    if (direction === 'window') {
      if (isBBoxFullyContained(marqueeRect, bbox)) annotationIndices.push(i);
    } else {
      if (!isBBoxOverlapping(marqueeRect, bbox)) continue;
      const shape = toFabricShape(obj);
      if (doesRectIntersectObject(marqueeRect, shape)) annotationIndices.push(i);
    }
  }

  for (const callout of callouts || []) {
    const bbox = bboxFromCallout(callout, pageWidth, pageHeight);
    if (direction === 'window') {
      if (isBBoxFullyContained(marqueeRect, bbox)) calloutIds.push(callout.id);
    } else {
      if (!isBBoxOverlapping(marqueeRect, bbox)) continue;
      const shape = toFabricShape(callout, { pageWidth, pageHeight, kind: 'callout' });
      if (doesRectIntersectObject(marqueeRect, shape)) calloutIds.push(callout.id);
    }
  }

  return { annotationIndices, calloutIds };
}

function safeBBox(obj) {
  try {
    const b = getAnnotationBBox(obj);
    if (!b) return null;
    return { left: b.left, top: b.top, right: b.left + b.width, bottom: b.top + b.height };
  } catch (_) {
    return null;
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `node --test tests/marqueeSelection.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/marqueeSelection.js tests/marqueeSelection.test.mjs
git commit -m "feat(19): add pure marquee direction/containment/hit-resolution helpers"
```

---

## Chunk 2: Hook Wiring (useSVGInteraction)

Marquee state, pointer branching, and Escape cancel land here. All changes are scoped inside `useSVGInteraction.js`.

### Task 3: Add marquee state + accept activeTool prop

**Files:**
- Modify: `src/hooks/useSVGInteraction.js`

**Read first:**
- `src/hooks/useSVGInteraction.js` (whole file — understand existing state shape, `handleSvgPointerDown`, `handlePointerMove`, `handlePointerUp`, the return block at the bottom).
- `src/components/SVGAnnotationLayer.jsx:120,319-325` (how `activeTool` / `isSelectTool` are derived — mirror the same gate in the hook).

- [ ] **Step 1: Add `activeTool` prop and marquee state**

- Add `activeTool` to the hook's input destructure (next to `svgRef`, `annotations`, etc.) and to the JSDoc above `useSVGInteraction`.
- Just below the existing `interactionState` declaration, add:

```js
// Phase 19 — AutoCAD marquee state. Separate from dragStateRef so it can
// drive SVG render without racing annotation drag state.
const [marqueeState, setMarqueeState] = useState(null);
// Shape when active: { startX, startY, endX, endY, shiftHeld, pageOriginRect }
// null when no marquee is in progress.
```

- Add a ref mirror for handlers that can't read fresh state closures:

```js
const marqueeStateRef = useRef(null);
```

- Keep `marqueeStateRef.current` in sync: wherever you call `setMarqueeState(next)` also set `marqueeStateRef.current = next`. Add a helper:

```js
const applyMarqueeState = useCallback((next) => {
  marqueeStateRef.current = next;
  setMarqueeState(next);
}, []);
```

- [ ] **Step 2: Commit (no behavior change yet)**

```bash
git add src/hooks/useSVGInteraction.js
git commit -m "chore(19): scaffold marquee state + activeTool prop on useSVGInteraction"
```

---

### Task 4: Start marquee on empty-space pointerdown with Select tool

**Files:**
- Modify: `src/hooks/useSVGInteraction.js` (function `handleSvgPointerDown` near line 369)

**Read first:**
- `src/hooks/useSVGInteraction.js:369-472` (current empty-space branch — ends with `deselectAll()`).

- [ ] **Step 1: Update the empty-space branch**

Replace the final two lines of `handleSvgPointerDown` (the `if (e.target === svgRef.current) { deselectAll(); }` block) with:

```js
// Phase 19 — AutoCAD marquee. Only activate when:
//   - we fell through both callout and annotation paths (truly empty space)
//   - the Select tool is active
//   - the click originated on the SVG root itself
if (e.target === svgRef.current && activeTool === 'select') {
  const svgPoint = screenToSVG(svgRef.current, e.clientX, e.clientY);
  applyMarqueeState({
    startX: svgPoint.x,
    startY: svgPoint.y,
    endX: svgPoint.x,
    endY: svgPoint.y,
    shiftHeld: e.shiftKey,
    active: false, // becomes true once min-drag threshold is crossed
  });
  try { svgRef.current?.setPointerCapture?.(e.pointerId); } catch (_) { /* optional */ }
  // UX: do NOT deselect yet. If the user releases under the 5 px threshold
  // we fall through to normal click semantics; deselection happens on
  // pointerup when we confirm the gesture was actually a click.
  return;
}

// No marquee eligible — existing deselect behavior.
if (e.target === svgRef.current) {
  deselectAll();
}
```

Add `activeTool`, `applyMarqueeState` to the `useCallback` dependency array.

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useSVGInteraction.js
git commit -m "feat(19): start marquee on empty-space pointerdown with Select tool"
```

---

### Task 5: Update marquee on pointermove + live direction

**Files:**
- Modify: `src/hooks/useSVGInteraction.js` (function `handlePointerMove` near line 478)

**Read first:**
- `src/hooks/useSVGInteraction.js:478-600` (current pointermove body — understand the `ds = dragStateRef.current` early-return).

- [ ] **Step 1: Add marquee branch at top of handlePointerMove**

Insert before the existing `const ds = dragStateRef.current; if (!ds.active) return;`:

```js
// Phase 19 — marquee active? Update endpoint, flip direction live, and
// short-circuit before normal drag math runs.
const mq = marqueeStateRef.current;
if (mq) {
  const pt = screenToSVG(svgRef.current, e.clientX, e.clientY);
  // Clamp to page viewBox so marquee can't escape the page.
  const clampedX = Math.max(0, Math.min(pageWidth, pt.x));
  const clampedY = Math.max(0, Math.min(pageHeight, pt.y));
  const next = { ...mq, endX: clampedX, endY: clampedY };
  const dx = Math.abs(next.endX - next.startX);
  const dy = Math.abs(next.endY - next.startY);
  next.active = next.active || dx >= 5 || dy >= 5;
  applyMarqueeState(next);
  return;
}
```

Add `pageWidth`, `pageHeight`, `applyMarqueeState` to the `useCallback` deps.

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useSVGInteraction.js
git commit -m "feat(19): update marquee endpoint + live direction on pointermove"
```

---

### Task 6: Resolve hits + apply selection on pointerup

**Files:**
- Modify: `src/hooks/useSVGInteraction.js` (function `handlePointerUp` near line 930)

**Read first:**
- `src/hooks/useSVGInteraction.js:930-1050` (current pointerup body).
- `src/utils/marqueeSelection.js` (the functions just created).

- [ ] **Step 1: Add marquee branch at top of handlePointerUp**

Insert before the existing pointerup body:

```js
// Phase 19 — marquee release path.
const mq = marqueeStateRef.current;
if (mq) {
  const wasActive = mq.active;
  // Always clear the marquee first so re-render drops the rect.
  applyMarqueeState(null);

  if (!wasActive) {
    // Sub-threshold drag — treat as a plain click on empty space.
    // Match existing behavior: deselect on unmodified click.
    if (!mq.shiftHeld) deselectAll();
    return;
  }

  const marqueeRect = getMarqueeRect(mq);
  const direction = getMarqueeDirection(mq);
  const { annotationIndices, calloutIds } = resolveMarqueeHits({
    marqueeRect,
    direction,
    annotations,
    callouts,
    pageWidth,
    pageHeight,
  });

  // Apply annotation selection.
  if (mq.shiftHeld) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const i of annotationIndices) next.add(i);
      return next;
    });
  } else {
    setSelectedIds(new Set(annotationIndices));
  }

  // Apply callout selection through the App.jsx callback.
  if (onSelectedCalloutIdsChange) {
    if (mq.shiftHeld) {
      // Union with whatever App.jsx currently holds — read back via a
      // ref or accept the current set as a prop. If App.jsx does not
      // pass it down, document the gap in UAT and union against an
      // empty set (matches current behavior where shift+drag on empty
      // only affects annotations).
      onSelectedCalloutIdsChange(new Set(calloutIds)); // TODO verify during UAT
    } else {
      onSelectedCalloutIdsChange(new Set(calloutIds));
    }
  }

  try { svgRef.current?.releasePointerCapture?.(e.pointerId); } catch (_) { /* optional */ }
  return;
}
```

Import the helpers at the top of the file:

```js
import {
  getMarqueeRect,
  getMarqueeDirection,
  resolveMarqueeHits,
} from '../utils/marqueeSelection.js';
```

Add `annotations`, `callouts`, `pageWidth`, `pageHeight`, `onSelectedCalloutIdsChange`, `applyMarqueeState`, `deselectAll` to the pointerup `useCallback` deps.

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useSVGInteraction.js
git commit -m "feat(19): resolve marquee hits and apply selection on pointerup"
```

---

### Task 7: Escape cancels the marquee

**Files:**
- Modify: `src/hooks/useSVGInteraction.js`

- [ ] **Step 1: Add a window-level keydown effect**

Just below the existing `useEffect`s in the hook, add:

```js
// Phase 19 — Escape cancels an in-progress marquee without changing selection.
useEffect(() => {
  if (!marqueeState) return undefined;
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      applyMarqueeState(null);
    }
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}, [marqueeState, applyMarqueeState]);
```

- [ ] **Step 2: Export marquee state for render**

At the hook's return block (near line 1602), add:

```js
marqueeRect: marqueeState && marqueeState.active ? getMarqueeRect(marqueeState) : null,
marqueeDirection: marqueeState && marqueeState.active ? getMarqueeDirection(marqueeState) : null,
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSVGInteraction.js
git commit -m "feat(19): escape cancels marquee + expose rect/direction for render"
```

---

## Chunk 3: SVG Layer Render

### Task 8: Pass activeTool to the hook

**Files:**
- Modify: `src/components/SVGAnnotationLayer.jsx` (the `useSVGInteraction({ ... })` call site)

**Read first:**
- `src/components/SVGAnnotationLayer.jsx:120, 319-325` (existing `activeTool` plumbing).

- [ ] **Step 1: Thread the prop through**

Find the `useSVGInteraction({ ... })` call and add `activeTool,` to the options object. Also read back the two new return values:

```js
const {
  // ...existing returns...
  marqueeRect,
  marqueeDirection,
} = useSVGInteraction({
  // ...existing props...
  activeTool,
});
```

- [ ] **Step 2: Commit**

```bash
git add src/components/SVGAnnotationLayer.jsx
git commit -m "chore(19): thread activeTool + marquee render state through SVG layer"
```

---

### Task 9: Render the marquee rect

**Files:**
- Modify: `src/components/SVGAnnotationLayer.jsx` (inside the main `<svg>` near line 2069)

**Read first:**
- `src/components/SVGAnnotationLayer.jsx:2069-2130` (root svg element and the children render order).

- [ ] **Step 1: Add the marquee `<rect>`**

Inside the root `<svg>`, after the existing annotation/callout children but before the hover/selection overlay layer, add:

```jsx
{/* UX: Phase 19 AutoCAD marquee. Solid blue fill when dragging
    left-to-right (Window mode — selects only fully enclosed),
    dashed green when dragging right-to-left (Crossing mode —
    selects anything the box touches). Rendered above annotation
    content and below hover/selection overlays so it never steals
    pointer events from annotations underneath. Colors copied
    verbatim from the dormant Fabric reference. */}
{marqueeRect && (
  <rect
    x={marqueeRect.left}
    y={marqueeRect.top}
    width={marqueeRect.width}
    height={marqueeRect.height}
    fill={marqueeDirection === 'window'
      ? 'rgba(0, 100, 255, 0.15)'
      : 'rgba(0, 200, 100, 0.15)'}
    stroke={marqueeDirection === 'window'
      ? 'rgba(0, 100, 255, 0.8)'
      : 'rgba(0, 200, 100, 0.8)'}
    strokeWidth={1}
    strokeDasharray={marqueeDirection === 'window' ? undefined : '5,5'}
    vectorEffect="non-scaling-stroke"
    pointerEvents="none"
  />
)}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/SVGAnnotationLayer.jsx
git commit -m "feat(19): render AutoCAD marquee rect on SVG layer"
```

---

## Chunk 4: Manual UAT + Close

### Task 10: Manual UAT

This feature is UI-heavy; automated tests cover the math but the pointer flow needs human verification. Use the dev server: `npm run dev`, open `http://localhost:5173/`, load `Package 2 - Rev 4 -- IC.pdf`, go to page 6.

- [ ] **UAT 1 — Window mode (blue solid)** — With the Select tool active, drag from empty space left-to-right over a cluster of annotations. Expected: solid blue box appears, and on release only annotations whose bbox is fully inside the box are selected. Verify across pen strokes, text, rects, circles, lines, arrows, callouts, and imported PDF shapes.
- [ ] **UAT 2 — Crossing mode (green dashed)** — Drag right-to-left across annotations that partially straddle the box. Expected: dashed green box, and every annotation the box touches is selected on release.
- [ ] **UAT 3 — Direction flip mid-drag** — Start dragging left-to-right, then reverse back past the start. Expected: color and dash switch live; final mode on release matches the final drag direction.
- [ ] **UAT 4 — Shift union** — Select a shape via click, then Shift+drag a marquee over a separate shape. Expected: both stay selected.
- [ ] **UAT 5 — Plain replace** — With something selected, drag a marquee that hits nothing. Expected: selection clears (empty result, no modifier).
- [ ] **UAT 6 — Shift empty no-op** — With something selected, Shift+drag a marquee that hits nothing. Expected: selection unchanged.
- [ ] **UAT 7 — 5 px threshold** — Click-and-release with less than 5 px of movement on empty space. Expected: treated as a normal empty-space click (no marquee rect ever rendered, selection cleared without modifier, unchanged with Shift).
- [ ] **UAT 8 — Escape cancels** — Start a marquee, press Escape mid-drag. Expected: rect disappears, no selection change.
- [ ] **UAT 9 — Drag starts on annotation** — Press down on an existing annotation and drag. Expected: no marquee appears, existing click-to-select / drag-to-move runs unchanged.
- [ ] **UAT 10 — Non-Select tools** — Switch to Pan, Pen, Highlighter, Text, Line, Arrow, Callout, Eraser, Shape tools and drag on empty space. Expected: none of them show a marquee; each tool's normal drag behavior runs.
- [ ] **UAT 11 — Zoom levels** — Repeat UAT 1 + 2 at 50%, 100%, and 200% zoom. Expected: marquee tracks the cursor 1:1 and hit-test results match what's visually inside the box (SVG viewBox handles all scaling).
- [ ] **UAT 12 — Page boundary** — Drag a marquee toward the edge of the page and keep dragging past it. Expected: rect clamps to the page viewBox; annotations on adjacent pages never get selected.
- [ ] **UAT 13 — Callouts participate** — Drag a Window marquee that fully encloses a callout. Expected: callout is selected. Drag a Crossing marquee across a callout's connector line. Expected: callout is selected.

- [ ] **Step 1: Capture results**

Write UAT outcomes to `.planning/phases/19-autocad-window-crossing-selection/19-UAT.md` (plain text, one line per case, PASS / FAIL / notes).

- [ ] **Step 2: Close-out commit**

```bash
git add .planning/phases/19-autocad-window-crossing-selection/19-UAT.md
git commit -m "docs(19): UAT results for AutoCAD marquee selection"
```

---

## Deferred / Follow-up

- Cross-page marquee.
- Alt + drag to subtract from selection.
- Cmd / Ctrl modifier semantics.
- Live preview (hover glow on candidates during drag).
- Deleting the dormant Fabric-layer handlers at `src/PageAnnotationLayer.jsx:7411-7854`.
- Marquee behavior during edit mode — sanity check during UAT; formal rule deferred.
- Broader v2.0 audit (eraser wiring, keyboard shortcuts) — user-deferred, tracked separately.
