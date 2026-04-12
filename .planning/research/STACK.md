# Technology Stack — v2.1 Stage 0 Shape Edit Polish

**Project:** Survey BetaSafeS2 — v2.1 Stage 0 (Shift+rotate snap, zoom floor to 10%)
**Researched:** 2026-04-12
**Overall confidence:** HIGH
**Scope:** Polish milestone. ~11 LOC across 3 files. **Zero new dependencies.**

---

## Verdict: NO Stack Additions Needed

Both Stage 0 features can be implemented entirely with:

1. **Existing Fabric.js 5.5.2** — `obj.snapAngle` is a built-in instance property evaluated by Fabric's rotation controller at every rotation tick. Runtime toggling via `keydown`/`keyup` listeners is supported without any workarounds.
2. **Existing DOM APIs** — `PointerEvent.shiftKey` is already read throughout `useSVGInteraction.js` (lines 143, 361) for other Shift-modified behaviors. No new APIs, libraries, or patterns are required.
3. **Existing `clampScale` funnel in `zoomController.js`** — one constant change (`MIN_SCALE: 0.5 → 0.1`) propagates through every zoom entry point that already goes through the controller.
4. **One additional hardcoded floor** that must be updated alongside `MIN_SCALE` — see Integration Points below.

No library upgrades, no new packages, no polyfills, no build changes.

---

## Current Versions (verified from package.json + node_modules)

| Technology | Version | Status | Notes |
|------------|---------|--------|-------|
| React | ^18.2.0 | Keep | No changes needed |
| Vite | ^5.2.0 | Keep | No changes needed |
| Electron | ^25.2.1 | Keep | No changes needed |
| Fabric.js | ^5.5.2 | Keep — LOCKED | Data model depends on 5.x serialization. `snapAngle` verified in shipped bundle at `node_modules/fabric/dist/fabric.js:7295` and `:11941`. |
| Syncfusion EJ2 PDF Viewer | 32.1.19 (local file: reference) | Keep | Internal `coerceZoom` already clamps `[10, 1000]` — already supports 10% (see Q3) |
| React-DOM / react-window / etc. | — | Keep | Unrelated |

**Fabric.js upgrade path:** OUT OF SCOPE and PROHIBITED for this milestone. v2.0 validated that Fabric.js 5.5.2 JSON serialization is the storage format; Fabric 6.x changes class names and the serialization shape in ways that would require a data migration.

---

## Answers to Specific Research Questions

### Q1. Does Fabric.js 5.5.2 `obj.snapAngle` work with runtime toggling via keydown/keyup?

**YES — confirmed from the shipped bundle.** HIGH confidence.

Evidence from `node_modules/fabric/dist/fabric.js`:

```js
// Line 11941 (fabric.Object default)
snapAngle: 0,

// Lines 11944–11950 (default snapThreshold)
snapThreshold: null,

// Lines 7295–7304 (rotation controller logic, runs on every rotation tick)
if (target.snapAngle > 0) {
  var snapAngle  = target.snapAngle,
      snapThreshold  = target.snapThreshold || snapAngle,
      rightAngleLocked = Math.ceil(angle / snapAngle) * snapAngle,
      leftAngleLocked = Math.floor(angle / snapAngle) * snapAngle;

  if (Math.abs(angle - leftAngleLocked) < snapThreshold) { ... }
  else if (Math.abs(angle - rightAngleLocked) < snapThreshold) { ... }
}
```

Key observations:

- The check `target.snapAngle > 0` runs **on every rotation tick**, reading the property fresh from the target each time. There is no cached snapshot at rotation-start.
- Setting `obj.snapAngle = 0` disables snap; setting `obj.snapAngle = 45` snaps to 45° increments.
- `snapThreshold` defaults to `snapAngle` itself, meaning the snap is effectively "always on" once enabled — any angle between two snap points gets rounded to the nearer one. This matches the UX intent of "snap to 45° increments while Shift held."
- **Runtime toggling is a supported pattern.** A `keydown` listener that does `activeObj.snapAngle = 45` and a `keyup` listener that does `activeObj.snapAngle = 0` will take effect on the very next rotation move event with no flushing or recommit required.

**Implementation pattern for FabricEditCanvas.jsx:**

```js
// Inside loadShapeAnnotation callback, after canvas.setActiveObject(obj)
const handleKey = (e) => {
  if (e.key !== 'Shift') return;
  obj.snapAngle = e.type === 'keydown' ? 45 : 0;
};
window.addEventListener('keydown', handleKey);
window.addEventListener('keyup', handleKey);
// Teardown in the component's existing cleanup path (unmount or shape swap)
```

**Known caveats / gotchas (surfaced during verification):**

- Fabric's rotation snap only fires during an *active* rotation drag handled by the mtr control. This is exactly the Fabric edit path this milestone targets — no conflict.
- If the user is already mid-rotation and presses Shift, the snap engages on the next pointer move (not instantly at the current pointer position). This matches Figma/Illustrator behavior and is the expected UX.
- `snapAngle` is per-object, not per-canvas. For this milestone there is exactly one active object in FabricEditCanvas (the shape being edited), so a window-level listener that writes to the single active object is correct.
- Do **not** set `snapAngle` on the class prototype — it would leak into future shapes. Set it on the specific `obj` instance loaded by `loadShapeAnnotation`.

**Confidence: HIGH** — verified directly in the shipped Fabric.js 5.5.2 source code that runs in this app's bundle.

---

### Q2. Are there React/DOM APIs that would simplify the SVG rotation snap vs reading `e.shiftKey` inside the existing pointer move handler?

**NO — `e.shiftKey` inside the existing handler is the simplest path.** HIGH confidence.

Evidence from `src/hooks/useSVGInteraction.js`:

- Line 143: `if (e.shiftKey) { ... }` already used for another behavior (confirmed present in the file)
- Line 361: `if (e.shiftKey) { ... }` already used for resize aspect-lock (the exact same pattern this milestone needs)
- Line 391 onwards: the rotation branch `else if (ds.mode === 'rotate')` computes `newAngle` from `Math.atan2(dy, dx)` and writes it into `visualTransform.rotate.angle` / `deltaAngle` and `dragStateRef.current.currentAngle`

The 1-line fix is to wrap `newAngle` in the same `e.shiftKey` check used by the resize branch immediately above it:

```js
} else if (ds.mode === 'rotate') {
  const dx = svgPoint.x - ds.centerX;
  const dy = svgPoint.y - ds.centerY;
  const radians = Math.atan2(dy, dx);
  let newAngle = normalizeAngle(radians);

  // Stage 0: Shift-snap to 45° increments
  if (e.shiftKey) {
    newAngle = Math.round(newAngle / 45) * 45;
  }

  const deltaAngle = newAngle - (ds.originalProps.angle || 0);
  dragStateRef.current.currentAngle = newAngle;
  // ... rest unchanged
}
```

**Alternatives considered and rejected:**

| Alternative | Why rejected |
|-------------|--------------|
| `KeyboardEvent` listeners on `window` for keydown/keyup tracking | Adds state management for a value (`shiftHeld`) that is already delivered in every pointer move event. Pure overhead. |
| `navigator.keyboard.getLayoutMap()` | Irrelevant — we need modifier state, not key layout. |
| `pointerrawupdate` event | Only useful for sub-frame latency; we're doing geometric snapping, not motion prediction. |
| Pointer Lock API | Overkill; we need standard pointer events for the SVG handle drag. |
| `e.getModifierState('Shift')` | Equivalent to `e.shiftKey` — no advantage, slightly less idiomatic. |

**The existing pattern is correct. Use it.**

The commit-on-pointerup path at `useSVGInteraction.js:559-568` (the `ds.mode === 'rotate'` branch of `handlePointerUp`) reads `ds.currentAngle` directly and saves it — since `currentAngle` is already set to the snapped value during `handlePointerMove`, no changes to the commit path are needed. **The snap is pure output rewriting; no data model changes.**

**Confidence: HIGH** — directly confirmed from the existing file at the exact line numbers.

---

### Q3. Does lowering the zoom floor to 0.1 risk interaction with browser, Syncfusion, or SVG viewBox precision?

**NO risks at 10%.** HIGH confidence. One hidden companion constraint must be updated alongside `MIN_SCALE`.

**Browser minimum zoom:** Not a factor. Browser zoom (Cmd/Ctrl+-) operates at the document level; the app's `MIN_SCALE` operates on Syncfusion's internal page transform. Distinct concerns. CSS `transform: scale(0.1)` is universally supported in Chromium/Electron.

**Syncfusion PDF Viewer minimum zoom:** **Syncfusion's own `coerceZoom` already clamps `[10, 1000]`.** Evidence from `src/components/SyncfusionPDFContainer.jsx:29-33`:

```js
const coerceZoom = (value, fallback = 100) => {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(10, Math.min(1000, next));
};
```

Syncfusion is **already configured to support 10% zoom** at the viewer layer. The current `MIN_SCALE = 0.5` is the app's own artificial ceiling. Lowering it aligns the app's zoom range with what Syncfusion already accepts.

**SVG viewBox precision:** Not a risk. The SVG display layer uses `viewBox="0 0 pageWidth pageHeight"` with `width`/`height` set to the page div's CSS dimensions. At 10% of a standard Letter page (612×792 points), the rendered SVG is ~61×79 CSS pixels. SVG viewBox math is floating-point and is accurate to well below 1% of a pixel; stroke widths are already `vector-effect: non-scaling-stroke` (confirmed as a project-wide invariant in CLAUDE.md and the v2.0 migration docs), so strokes stay at their authored thickness regardless of viewBox scale.

**PageAnnotationLayer canvas init:** Container-aware sizing (`parentEl.offsetWidth / pageWidth`) naturally handles any scale including 0.1. Verified in multiple places in the Fabric edit canvas code (e.g. `FabricEditCanvas.jsx:1069` and `:1094`). No div sizing math hardcodes 0.5 as a floor.

**Sub-pixel hit zones:** At 10% zoom, a 2px stroke becomes a 0.2 device-pixel-wide visual but keeps its authored 2pt hit zone in viewBox coordinates (via `vector-effect: non-scaling-stroke`). Selection still works.

**Confidence: HIGH** — verified against Syncfusion's own clamp, the existing viewBox + non-scaling-stroke pattern, and the container-aware sizing contract.

---

### Q4. Is there any tooling (e.g. a zoom slider) that needs to update its min prop?

**YES — one additional hardcoded floor.** This is the easy-to-miss companion change.

**There is no slider** — the zoom UI is a text input at `src/App.jsx:26449-26476` (`<input type="text" ref={zoomInputRef}>`), not a `<input type="range">`. It has no `min` prop to update.

**However,** `commitZoomInput` at `src/App.jsx:21987-22008` has its **own hardcoded clamp that short-circuits `clampScale`**:

```js
// src/App.jsx:21999
const clamped = Math.min(Math.max(parsed, 50), 500);
```

This runs *before* the parsed value hits `clampScale(clamped / 100)` on the next line. If only `MIN_SCALE` is changed in `zoomController.js`, **typing `10` into the zoom percentage input will still be clamped to 50 at line 21999 before it ever reaches `clampScale`**, and the user will see `50%` instead of `10%`.

**Required change at line 21999:** `Math.min(Math.max(parsed, 50), 500)` → `Math.min(Math.max(parsed, 10), 500)`.

The `500` ceiling is already above the current `MAX_SCALE * 100 = 500`, so only the floor needs to move.

**Confidence: HIGH** — literal line read.

---

## Integration Points (exact file:line references for the planner)

The PLAN.md writer should use these exact locations:

### Feature 1 — Shift+rotate snaps to 45° (SVG path)

- **File:** `src/hooks/useSVGInteraction.js`
- **Function:** `handlePointerMove` callback, inside the `else if (ds.mode === 'rotate')` branch
- **Lines:** ~391–408 (currently computes `newAngle` via `normalizeAngle(Math.atan2(dy, dx))`)
- **Change:** Add `if (e.shiftKey) newAngle = Math.round(newAngle / 45) * 45;` between the `normalizeAngle` call and the `deltaAngle` computation. Convert `const newAngle = ...` to `let newAngle = ...`.
- **Data model:** No changes. `ds.currentAngle` already carries the final value to the commit path at lines 559–568. Snapping is pure output rewriting.
- **LOC:** ~3 lines (the `if` block + `const → let`).

### Feature 1 — Shift+rotate snaps to 45° (Fabric edit path)

- **File:** `src/components/FabricEditCanvas.jsx`
- **Function:** `loadShapeAnnotation` callback inside the `fabric.util.enlivenObjects` block, after the `canvas.setActiveObject(obj)` call
- **Lines:** ~1050–1053 (just after `canvas.renderAll()`)
- **Change:** Install `window.addEventListener('keydown', handler)` + `keyup` mirror where `handler = e => { if (e.key === 'Shift') obj.snapAngle = e.type === 'keydown' ? 45 : 0; }`. Remove both listeners in the existing component teardown path (search for the existing canvas cleanup / unmount effect — this is where the `zoomGeneration` auto-commit listener lives).
- **Data model:** No changes. `obj.snapAngle` is a runtime instance property; Fabric reads it inside its rotation controller without any commit serialization.
- **DO NOT CHANGE constraints:** FabricEditCanvas.jsx *is* in the Always Protected list. This milestone will need an explicit scope carve-out in the phase CONTEXT.md — the edit is surgical (~5 lines inside `loadShapeAnnotation` + cleanup), touches no zoom / sizing / commit logic, and does not alter the `zoomGeneration` signal contract.
- **LOC:** ~5 lines (handler + 2 listeners + 2 removeEventListener in cleanup).

### Feature 2 — Zoom floor 10% (primary change)

- **File:** `src/utils/zoomController.js`
- **Line:** 15
- **Change:** `const MIN_SCALE = 0.5;` → `const MIN_SCALE = 0.1;`
- **Propagation:** All ~16 call sites of `clampScale` across `App.jsx` (lines 9126, 9450, 10395, 12086, 12094, 12200, 12293, 13162, 13720, 13769, 21148, 21208, 21544, 21552, 21579, 21703, 22002, 23588, 24408) automatically inherit the new floor. No other edits needed in App.jsx *except* the companion change below.
- **LOC:** 1 line.

### Feature 2 — Zoom floor 10% (companion change)

- **File:** `src/App.jsx`
- **Function:** `commitZoomInput`
- **Line:** 21999
- **Change:** `const clamped = Math.min(Math.max(parsed, 50), 500);` → `const clamped = Math.min(Math.max(parsed, 10), 500);`
- **Rationale:** This pre-clamp runs before `clampScale(clamped / 100)` on line 22002. Without this change, typing 10 in the zoom input will be silently rounded to 50.
- **DO NOT CHANGE constraints:** App.jsx *is* in the Always Protected list. This milestone will need an explicit scope carve-out in the phase CONTEXT.md — the edit is a one-character literal swap (`50` → `10`) inside `commitZoomInput` that touches no zoom flow, portal host, render loop, or `clampScale` logic.
- **LOC:** 1 line.

**Total footprint:** ~10 LOC across 4 files (useSVGInteraction.js, FabricEditCanvas.jsx, zoomController.js, App.jsx). Matches the ~11 LOC estimate in FEATURE-BACKLOG.md within tolerance.

---

## Alternatives Considered

| Decision | Recommended | Alternative | Why not the alternative |
|----------|-------------|-------------|-------------------------|
| Fabric snap mechanism | `obj.snapAngle` (runtime toggle) | Monkey-patch `fabric.controlsUtils.rotationWithSnapping` | Private internal API. `snapAngle` is the documented extension point and is evaluated fresh every tick. |
| SVG snap mechanism | Inline `if (e.shiftKey) newAngle = Math.round(newAngle/45)*45` | Window-level keydown/keyup tracking into a ref | Pointer events already carry modifier state. Adding a separate key listener doubles the surface area for no benefit. |
| Shift handler lifetime (Fabric path) | `window.addEventListener` scoped to the active edit session, cleaned up on unmount / shape swap | Bind in the App-level key listener at App.jsx:22037+ | App.jsx is deeply protected. Colocating with `loadShapeAnnotation` keeps the feature self-contained in FabricEditCanvas and avoids reaching into App.jsx's existing key dispatcher. |
| Zoom floor constant | `MIN_SCALE = 0.1` in zoomController | Per-call-site clamp with `Math.max(0.1, ...)` | `clampScale` is the universal funnel. One change. |
| Zoom input floor | Update hardcoded 50 → 10 at App.jsx:21999 | Delete the pre-clamp and rely on `clampScale` only | Deleting it would change the *overflow* behavior (parse errors, negative numbers). Minimal change = swap 50 → 10 and preserve the rest of the guard. |

---

## Installation

No installation steps. No new packages.

---

## Sources

- **Fabric.js 5.5.2 `snapAngle` / `snapThreshold` mechanism** — directly read from shipped bundle at `node_modules/fabric/dist/fabric.js` lines 7295–7304 (rotation controller) and 11941–11950 (default object properties). HIGH confidence.
- **Syncfusion zoom range** — `src/components/SyncfusionPDFContainer.jsx:29-33` (`coerceZoom` clamps to `[10, 1000]`). HIGH confidence.
- **Current `MIN_SCALE`** — `src/utils/zoomController.js:15`. HIGH confidence.
- **Zoom input companion clamp** — `src/App.jsx:21999`. HIGH confidence.
- **SVG rotation handler location** — `src/hooks/useSVGInteraction.js:391-408` (handlePointerMove rotate branch) and `:559-568` (handlePointerUp commit branch). HIGH confidence.
- **Fabric shape load location** — `src/components/FabricEditCanvas.jsx:1008-1053` (`loadShapeAnnotation` through `canvas.setActiveObject`). HIGH confidence.
- **Pattern precedent for `e.shiftKey` in SVG pointer handlers** — `src/hooks/useSVGInteraction.js:361` (existing resize aspect-lock). HIGH confidence.
- **Always Protected files list** — `CLAUDE.md` lines 18–33. Explicit scope waivers required for App.jsx and FabricEditCanvas.jsx.
- **Data model lock** — `.planning/PROJECT.md` constraints section: "Must keep Fabric.js 5.5.2 … Same Fabric.js JSON format." Upgrade is prohibited.
