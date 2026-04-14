# Stack Research — v2.2 Rotation Handle Polish

**Domain:** React + SVG + Fabric.js PDF annotation editor (3 localized rotation handle bugs)
**Researched:** 2026-04-14
**Confidence:** HIGH
**Scope:** What stack additions are needed to fix Gap 2 (off-screen relocation), Gap 3 (hover-intent stale-ref), and Gap 4 (mtr clipped in edit canvas). DOES NOT re-evaluate the v2.0/v2.1 stack.

---

## Verdict: NO NEW LIBRARIES REQUIRED

All three rotation-handle gaps are fixable inside the existing codebase with vanilla React 18 + the utilities already shipped in `src/utils/svgBoundingBox.js`, `src/utils/svgTransformMath.js`, and the existing `BBOX_PADDING` constant in `src/components/FabricEditCanvas.jsx`. Root causes were verified by direct source inspection:

| Gap | Root Cause (verified) | Fix Shape | New Dependency? |
|-----|----------------------|-----------|------------------|
| **3 — Hover-intent stale ref** | Hover-intent `useEffect` in `SVGAnnotationLayer.jsx:213` has deps `[selectedIds, setRotInputVisibleDbg]`. When the selection chrome is unmounted during edit mode (`SVGAnnotationLayer.jsx:1050` returns `null` for the edited index) and remounted on edit-commit, the `annotations` prop identity changes but `useSVGInteraction.js:99-105` returns the **same `selectedIds` Set reference** when all selected indices still resolve. The effect therefore does NOT re-run, and `handleEl` captured earlier is either `null` (bailed) or detached. | Add `editingAnnotationIndex` to the effect's dep array, OR wire a callback ref from `SVGSelectionOverlay` up to `SVGAnnotationLayer` so listeners re-attach on mount/unmount. | **None.** React 18 `useEffect` + dep array, or React 18 callback ref pattern. |
| **4 — mtr clipped in edit canvas** | `BBOX_PADDING = 32` page-units (`FabricEditCanvas.jsx:83`) is the top-edge buffer of the Fabric canvas pixel buffer. Fabric 5.5.2's default `rotatingPointOffset` = 40 px (canvas-local). In pageSpaceMode (`canvas.setZoom(1)`), the default mtr sits at canvas-local `(width/2, 32 - 40) = (width/2, -8)`, which is **outside** the canvas drawing surface → hard-clipped by Canvas2D itself (NOT by CSS overflow — `container.style.overflow = 'visible'` is already set at `FabricEditCanvas.jsx:950 / 965` and `wrapperEl.style.overflow = 'visible'` at `FabricEditCanvas.jsx:1662`). At `angle=0` the non-pageSpace branch runs `canvas.setZoom(effectiveScale)` and the ~1.33 Electron zoom factor pushes the mtr back inside the buffer (32×1.33 − 40 = 2.56 px of breathing room), which is why 0° "works". | Option A: increase the top-edge allowance to `max(BBOX_PADDING, rotatingPointOffset + mtrHandleRadius)` and bump the canvas height by the delta. Option B: install a custom Fabric `Control` for `mtr` that positions the handle at `y = +2` (same page-unit offset as `SVGSelectionOverlay`'s ~22 px rotation handle gap) so it stays inside the existing 32 px buffer. Option C: set `fabric.Object.prototype.rotatingPointOffset = 22` on the loaded shape. | **None.** All three options use Fabric.js 5.5.2's existing `Control` API + existing `BBOX_PADDING` constant. |
| **2 — Off-screen relocation** | Requires (a) computing each handle's viewport-space position and (b) flipping it to the opposite side when outside the page container's bbox. `SVGSelectionOverlay.jsx` already receives `bbox` + `inverseScale` and `src/utils/svgBoundingBox.js` already exports `getHandlePositions(bbox, padding)`. The page container bbox is `svgRef.current.getBoundingClientRect()` — already used by `useSVGInteraction.js:1114-1117` for counter-rotate pointer math. | Add a pure helper `relocateHandleIfOffScreen(handlePos, viewportBbox, shapeCenter)` that returns the mirrored position when outside the viewport. Wire it in `SVGSelectionOverlay.jsx:167` around the `handles.mtr.x / handles.mtr.y` computation. | **None.** Pure geometric math using existing `getBoundingClientRect()` + `getHandlePositions()`. |

---

## Existing Stack (unchanged — reference only)

| Technology | Version | Role | Source of truth |
|------------|---------|------|-----------------|
| React | 18 | Rendering, hooks, refs | `package.json` |
| Fabric.js | **5.5.2** (pinned) | Edit-only canvas for rotation/resize/text | CLAUDE.md: "Must keep Fabric.js 5.5.2" |
| Syncfusion React PDF Viewer | (pinned) | PDF viewer host | `package.json` |
| Vite | 5 | Dev server + build | `package.json` |

**Fabric.js 5.5.2 API surfaces relevant to Gap 4 (verified at fabric.js sources):**
- `fabric.Control` — per-object custom controls with `positionHandler`, `actionHandler`, `render`.
- `fabric.Object.prototype.rotatingPointOffset` — default `40`. Per-object override via `obj.rotatingPointOffset = N`.
- `obj.controls.mtr` — the default rotation control. Can be replaced with a custom `new fabric.Control({...})`.
- `installShapeHandleRenderers()` (`FabricEditCanvas.jsx:216`) already iterates over `tl/tr/bl/br/mt/mb/ml/mr`. Adding `mtr` to this installer is a ~15-line addition.

**React 18 patterns relevant to Gap 3 (verified against [react.dev/reference/react/useEffect](https://react.dev/reference/react/useEffect)):**
- `useEffect` dep array: every reactive value referenced inside must be listed.
- Callback refs (`ref={handleRef}` where `handleRef` is memoized with `useCallback`) fire with the element on mount and `null` on unmount — ideal for DOM listener attach/detach that must survive remount.
- Strict Mode (dev) invokes mount/unmount twice — any listener-attach logic must be idempotent.

---

## Supporting Utilities — Already in Place (no new installs)

| Utility | File | Role in v2.2 |
|---------|------|--------------|
| `getHandlePositions(bbox, padding)` | `src/utils/svgBoundingBox.js` | Computes all 9 handle positions in page-space. Gap 2 relocation logic wraps this. |
| `getInverseScale(svgEl, pageWidth)` | `src/utils/svgTransformMath.js` | Already used by `useSVGInteraction.js:75` via ResizeObserver. Gap 2 uses the same `svgEl.getBoundingClientRect()` it internally reads. |
| `getAnnotationBBox(obj)` | `src/utils/svgBoundingBox.js` | Already used for `shapeCenterViewBox` memo (`SVGAnnotationLayer.jsx:348-357`). Gap 2 handle-flip math can reuse. |
| `BBOX_PADDING` | `src/components/FabricEditCanvas.jsx:83` | Existing load-bearing constant. Gap 4 fix is a one-line bump + asymmetric top-allowance. |
| `ResizeObserver` (browser native) | `useSVGInteraction.js:77` | Already wired. No new observer needed for these gaps. |

---

## Development Tools — Unchanged

| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| Vite | 5 | HMR dev server on :5173 | No config changes needed |
| React DevTools | latest | Verify `editingAnnotationIndex` transitions fire the hover-intent effect after Gap 3 fix | Already installed |

---

## Installation

```bash
# NONE. Zero new packages for v2.2.
```

No `npm install` required. All fixes land inside existing files.

---

## Alternatives Considered (and rejected)

| Suggested | Rejected | Why |
|-----------|----------|-----|
| `react-use` or `ahooks` `useLatest` / `useLockFn` | **Rejected** | Adds a 20+ KB dependency for what is one `useRef` assignment already present at `SVGAnnotationLayer.jsx:170-171` (`rotInputVisibleRef`). The pattern is already in the file. |
| `usehooks-ts` `useEventListener` | **Rejected** | The existing hand-rolled `addEventListener` / `removeEventListener` cleanup (lines 296-305) is correct. Swapping it in now would rewrite ~40 lines of working code just to import one hook. Not proportionate to a dep-array fix. |
| `react-intersection-observer` / `IntersectionObserver` for Gap 2 | **Rejected** | `IntersectionObserver` reports "is the element inside root" — but we need "WHERE does the handle land relative to the viewport so we can mirror it." A single `getBoundingClientRect()` on the page container gives us that directly. `IntersectionObserver` would tell us too little, too late (async callback), and would fire continuously during zoom/pan unnecessarily. |
| `MutationObserver` to detect mtr DOM remount and re-attach listeners | **Rejected** | The remount IS React's reconciliation — we already know exactly when it happens (`editingAnnotationIndex` transition). Putting a `MutationObserver` on top of React's own mount lifecycle is the wrong layer — it reimplements what React's dep array or callback ref already does natively. Over-engineering. |
| `use-sync-external-store` shim for stable `selectedIds` reference | **Rejected** | The problem isn't a stale store — it's that the effect's dep list is missing a prop. `useSyncExternalStore` is for subscribing to external stores, not for fixing dep arrays. Wrong tool. |
| `xstate` / state machine library for hover-intent states (hidden / visible / closing) | **Rejected** | The 3-state machine at `SVGAnnotationLayer.jsx:143-187` is already implemented with `useState` + two `useRef` timers. It works. Migrating it to xstate would be a 300+ LOC refactor for zero user-visible gain and would conflict with the "minimize churn in load-bearing files" rule in CLAUDE.md (SVGAnnotationLayer.jsx is 1,317 lines of battle-tested logic). |
| Redux / Zustand for edit-mode coordination | **Rejected** | The edit-mode flag already flows through props (`editingAnnotationIndex`). Adding a global store for a two-component handshake is anti-pattern. |
| Effect orchestration libraries (`effect-ts`, `redux-observable`) | **Rejected** | Three localized DOM bugs. Orchestration is not the problem. |
| Pixel-snap / DPR tweak libraries for Gap 4 | **Rejected** | Rejected by CLAUDE.md lesson 2026-04-10: "Canvas 2D and SVG path rasterizers produce visibly different strokes... NOT fixable in JS." The Gap 4 clip is canvas pixel buffer bounds, not a rasterizer issue. Fix is geometric, not DPR-related. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Any new npm package** | All three gaps are fixable with files already in-repo. Adding a dep costs install time, audit surface, and maintenance for zero value. | Vanilla React 18 hooks + existing `BBOX_PADDING` / `getHandlePositions` / `getBoundingClientRect`. |
| **Global state libraries** (Redux, Zustand, Jotai) | None of the 3 gaps have cross-component state coordination problems. `editingAnnotationIndex` already props-threads cleanly. | Existing prop chain from App → SVGAnnotationLayer → SVGSelectionOverlay. |
| **State machine libraries** (xstate, robot) | The hover-intent state machine is already hand-rolled, documented with UX comments, and works after 7 rounds of debugging. Rewriting it is net-negative risk. | The existing `rotInputVisible` / `rotInputHoveredRef` / `rotInputCloseTimerRef` trio at `SVGAnnotationLayer.jsx:152-187`. |
| **`MutationObserver` for React subtree watching** | React already knows when the subtree mounts/unmounts. Observing DOM mutations on top of React reconciliation is a layering violation. | React 18 `useEffect` deps + callback ref — both fire at exactly the right moment. |
| **`IntersectionObserver` for off-screen handle detection (Gap 2)** | IO is for visibility of an element within a scroll root and fires async. We need a synchronous bbox intersection check to render the handle at the correct position on the same frame. | Synchronous `getBoundingClientRect()` on the page container + pure math. The logic runs during React render, not on an observer tick. |
| **`react-use` `useMeasure` / `useRect`** | `useSVGInteraction.js` already uses a `ResizeObserver` at line 77 to drive `inverseScale`. Duplicating that with a library hook adds nothing. | The existing ResizeObserver + `getInverseScale()` helper. |
| **Raising `BBOX_PADDING` from 32 to 80+ globally** | CLAUDE.md warns: "Do not lower without auditing all BBOX_PADDING call sites." RAISING it also touches ~30 call sites (outline-offset, toolbar positioning, mini-bar math, resize deltas). The safer fix is an asymmetric top allowance or a custom `mtr` control that stays inside the existing buffer. | Scoped fix: either Option A (asymmetric top-only delta) or Option B (custom `mtr` control at +2 page units). |

---

## Integration Points (for plan-phase authors)

### Gap 3 fix — where it lands

**File:** `src/components/SVGAnnotationLayer.jsx`
**Line:** 213-313 (the `useEffect` commented "EDIT-12: Hover-intent listeners on the mtr handle")
**Change shape (Option A, minimal):**
- Add `editingAnnotationIndex` to the dep array at line 313: `}, [selectedIds, setRotInputVisibleDbg, editingAnnotationIndex]);`
- Update the comment at lines 306-312 to explain WHY `editingAnnotationIndex` is now in the deps (so a future reader doesn't strip it again in a flicker hunt).

**Change shape (Option B, more robust):**
- Replace the `querySelector('[data-rotation-handle="mtr"]')` lookup with a callback ref exported from `SVGSelectionOverlay.jsx:168` (the `<g className="rotation-handle">`). Pass a `mtrRef` prop into `SVGSelectionOverlay` from `SVGAnnotationLayer`. The callback ref fires reliably on every mount/unmount cycle without depending on React effect scheduling.
- Tradeoff: touches both files + adds a prop; but eliminates the entire class of "effect deps didn't re-run" bugs for this handle.

**Recommendation:** Start with Option A (one-line dep fix). Upgrade to Option B only if regression test reveals another remount trigger that Option A misses.

### Gap 4 fix — where it lands

**File:** `src/components/FabricEditCanvas.jsx`
**Lines:** 83 (`BBOX_PADDING` constant), 944-966 (container sizing), 1044-1048 (canvas dimensions), 1352-1377 (shape load `obj.set(...)`)

**Change shape (Option A — asymmetric top-edge allowance, LOWEST RISK):**
- Introduce a sibling constant: `const BBOX_TOP_EXTRA = 20;` (page units — enough to house the 40 px default rotating offset minus the existing 32 px padding plus ~12 px handle radius).
- In the container sizing block (line 944-966) and the canvas dimensions block (1044-1048), add `BBOX_TOP_EXTRA` to the height and shift `top` upward by the same amount. Must be applied symmetrically in both the `pageSpaceMode` and non-page-space branches.
- Audit the `object:moving` → `bboxOriginRef` round-trip (lines 1491-1508) and the ResizeObserver settle path (1994-2095) to confirm the extra top allowance does not leak into the stored `annotation.top`.
- CLAUDE.md DO NOT CHANGE: this is inside a file explicitly protected against unscoped edits, but `BBOX_PADDING` is the phase's stated scope per the backlog entry. The audit of all 30+ `BBOX_PADDING` references is the mandatory cost of this fix.

**Change shape (Option B — custom Fabric `mtr` Control, MORE SCOPED):**
- In `installShapeHandleRenderers()` at line 216 (or in a new `installMtrHandleRenderer()` helper), add:
  ```js
  obj.controls.mtr = new fabric.Control({
    x: 0, y: -0.5,                    // top-center of shape
    offsetY: -20,                     // page units above the shape (inside BBOX_PADDING=32)
    cursorStyle: 'crosshair',
    actionName: 'rotate',
    actionHandler: fabric.controlsUtils.rotationWithSnapping,
    render: renderMtrHandle,          // custom renderer matching SVGSelectionOverlay mtr visual
  });
  ```
- The `offsetY: -20` sits inside the existing 32 page-unit top buffer → no canvas-size changes needed.
- `BBOX_PADDING` stays at 32. Zero cascade edits. Single file.
- **Recommended.** Matches CLAUDE.md's "minimize churn in load-bearing files" rule.

**Change shape (Option C — `obj.rotatingPointOffset` override, SIMPLEST):**
- Single line in the `obj.set({...})` call at line 1353: add `rotatingPointOffset: 20`.
- Fabric 5.5.2 respects per-object `rotatingPointOffset` when computing mtr position.
- But: the default rendered mtr visual in Fabric 5.5.2 does NOT match `SVGSelectionOverlay`'s icon+ring visual, so users will see a different handle chrome in edit mode than in select mode. A visual regression against the Phase 11 "handles in edit mode match handles in select mode" acceptance gate.
- **Accept only if Option B runs over-budget.**

### Gap 2 fix — where it lands

**File:** `src/components/SVGSelectionOverlay.jsx`
**Lines:** 167-206 (the `<g className="rotation-handle">` block)

**Change shape:**
- Add a new prop: `viewportBbox` (optional `{ left, top, right, bottom }` in page coords — the visible region of the current page in `svgRef.current.getBoundingClientRect()` → mapped through `getScreenCTM().inverse()`).
- Compute `mtrRelocated` locally:
  ```js
  const mtrRelocated = relocateIfOffScreen(
    handles.mtr,      // from getHandlePositions(bbox, padding)
    viewportBbox,
    { cx, cy },       // shape center
    angle
  );
  ```
- Render the `<line>` + `<circle>` + `<image>` at `mtrRelocated.x / mtrRelocated.y` instead of `handles.mtr.x / handles.mtr.y`. The connector line still anchors at `handles.mt.x / handles.mt.y` (top-center of bbox) — it just draws to the new handle position.
- Add `relocateIfOffScreen()` as a pure helper in `src/utils/svgBoundingBox.js` (sibling to `getHandlePositions`). Logic: if `mtr.y < viewportBbox.top + threshold`, mirror through `(cx, cy)` — place at `(cx + (cx - mtr.x), cy + (cy - mtr.y))`. Same for each other edge.
- `RotationInputField` already reads its anchor from `shapeCenterViewBox` and the mtr handle DOM position, so the pill will follow automatically as long as the visible `<circle>` has moved.
- **Conditional:** Per v2.2 scope, this fix only lands "if it slots cleanly" into the same phase. The scope is 1 new helper + ~15 LOC in `SVGSelectionOverlay.jsx` + 1 new prop threaded from `SVGAnnotationLayer.jsx`. That is a clean slot — recommend including.

---

## Stack Patterns by Variant

**If Gap 3 fix (Option A — dep array) regresses the Issue 4 flicker loop:**
- The effect must NOT include `rotInputVisible` or `isRotating` in its deps (those are what caused the original flicker).
- Adding `editingAnnotationIndex` is SAFE: it toggles at most twice per edit cycle (enter-edit → commit), not on every animation frame.
- If regression does appear, fall back to Option B (callback ref from `SVGSelectionOverlay`) which bypasses the effect-deps pathway entirely.

**If Gap 4 fix (Option B — custom mtr control) has visual drift from SVG select-mode mtr:**
- The SVG mtr visual is defined in `SVGSelectionOverlay.jsx:179-206`: a 12×sqrt(is) radius white circle with 1×sqrt(is) stroke, 16.8×sqrt(is) rotate-icon image, 22 page-unit offset above the top-center handle (via `getHandlePositions` mtr entry).
- The Fabric mtr custom renderer must mirror this by:
  - Reading `fabricObject._svgEffectiveScale` (already stored at line 1340).
  - Using `getHandleVisualScale(fabricObject)` for the strokeWidth (same helper used by `renderDampedCircleControl`).
  - Drawing a 12×vs circle + crosshair/rotate-icon glyph (fabric.js Control `render` receives `ctx, left, top, styleOverride, fabricObject` — exact same signature as existing custom controls in this file).

**If Gap 2 relocation causes the rotation input pill to overlap the shape body:**
- `RotationInputField` already clamps its position to the page viewport per the v2.1 carry-forward note ("pill already clamps correctly" from the backlog entry).
- The pill anchors at `shapeCenter + direction_to_mtr * offset` — if we mirror the mtr through the shape center, the pill naturally follows to the mirrored direction without any additional logic.

---

## Version Compatibility

| Constraint | Note |
|-----------|------|
| Fabric.js 5.5.2 pinned | `fabric.Control` API used in Gap 4 Option B is stable in 5.x. The Fabric 6.x `Control` API is backwards-compatible but 6.x introduces other breaking changes (see combined-tools reference project) — stay on 5.5.2 for this milestone per `CLAUDE.md` constraint. |
| React 18 | `useEffect` dep arrays, callback refs, and `useRef` patterns used here are all stable in React 18 and 19 — no upgrade needed. |
| Vite 5 | HMR compatible with all the changes; no config touch. |

---

## Sources

- **Primary: direct source inspection** — verified gap root causes against:
  - `src/components/SVGAnnotationLayer.jsx` lines 140, 152-187, 213-313, 1049-1050 (hover-intent effect + edit-mode unmount) — HIGH confidence.
  - `src/components/SVGSelectionOverlay.jsx` lines 167-206 (mtr handle DOM structure) — HIGH confidence.
  - `src/components/FabricEditCanvas.jsx` lines 66-83 (`BBOX_PADDING` constant + comments), 216-245 (`installShapeHandleRenderers`), 944-966 (container overflow + sizing), 1052-1054 (`canvas.setDimensions`), 1352-1377 (`obj.set` angle=0), 1662 (`wrapperEl.overflow = 'visible'`) — HIGH confidence.
  - `src/hooks/useSVGInteraction.js` lines 96-107 (`selectedIds` Set identity preservation on annotation-identity change), 75-86 (ResizeObserver + inverseScale) — HIGH confidence.
- **Secondary: React 18 official docs**
  - [React `useEffect` reference](https://react.dev/reference/react/useEffect) — verified dep-array semantics: every reactive value used inside must be listed; dep changes trigger cleanup+setup. HIGH confidence.
  - [React `useCallback` reference](https://react.dev/reference/react/useCallback) — verified callback-ref memoization pattern (empty dep array for stable ref callbacks). HIGH confidence.
- **Tertiary: web-verified patterns**
  - [Advanced React Refs: Mastering the Callback Pattern (dev.to)](https://dev.to/maximlogunov/advanced-react-refs-mastering-the-callback-pattern-4jpm) — confirms React 18 callback-ref behavior on unmount (fires with `null`) and ideal use for DOM listener lifecycle. MEDIUM confidence (community post, cross-checked against react.dev).
  - [React ref Callback Use Cases (julesblom.com)](https://julesblom.com/writing/ref-callback-use-cases) — additional context on callback ref vs useEffect trade-offs. MEDIUM confidence.
- **Project memory**
  - `CLAUDE.md` — Always Protected file list (SVGAnnotationLayer.jsx is load-bearing); DO NOT CHANGE boundaries; Fabric.js 5.5.2 pinning; "do not chase sub-pixel rasterizer deltas with JS" lesson. HIGH confidence.
  - `.planning/FEATURE-BACKLOG.md` lines 66-90 — Gap 2/3/4 symptoms, log evidence (`1.log`), suspected scope. HIGH confidence.
  - `.planning/PROJECT.md` — Existing validated stack + Phase 12 reconciliation + v2.1 carry-forward decisions. HIGH confidence.

---
*Stack research for: v2.2 Rotation Handle Polish (Gap 2/3/4)*
*Researched: 2026-04-14*
*Verdict: ZERO new dependencies. All fixes land in existing files using existing React 18 + Fabric.js 5.5.2 + vanilla DOM APIs.*
