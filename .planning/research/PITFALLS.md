# Pitfalls — v2.2 Rotation Handle Polish

**Researched:** 2026-04-14
**Scope:** Gap 3 (hover pill stale ref), Gap 4 (mtr clip in edit mode), Gap 2 (off-screen handle relocation)
**Confidence:** HIGH (direct source inspection of SVGAnnotationLayer, FabricEditCanvas, SVGSelectionOverlay, RotationInputField, useSVGInteraction + `1.log` runtime evidence)

Only NEW pitfalls for v2.2. Graduated v2.0/v2.1 lessons assumed known.

## Key Architectural Facts (verified in source)

1. **`SVGSelectionOverlay` is React-memoized** and rerenders on bbox/inverseScale/etc. prop changes. The `<g className="rotation-handle" data-rotation-handle="mtr">` DOM node usually survives reconciliation via React's node-reuse, but during commits there is a window where `svgRef.current.querySelector('[data-rotation-handle="mtr"]')` can return the previous DOM node — especially when the selection overlay is conditionally unmounted via the edit-mode short-circuit at `SVGAnnotationLayer.jsx:1050`.
2. **The hover-intent effect dep array is `[selectedIds, setRotInputVisibleDbg]`** (`SVGAnnotationLayer.jsx:313`), with an explicit `eslint-disable-next-line react-hooks/exhaustive-deps`. It is intentionally NOT reactive to `annotations`, `visualTransform`, or `editingAnnotationIndex` — this is the v2.1 Plan 12-02 fix for a 7-round flicker loop. Adding any of those to deps reintroduces the loop.
3. **`FabricEditCanvas` container already has `overflow: visible`** (`:950, 965`) AND `wrapperEl.style.overflow = 'visible'` (`:1662`). **FEATURE-BACKLOG's Gap 4 suspicion about `overflow: hidden` is FALSE.**
4. **Fabric shape in edit mode has `angle: 0` and `opacity: 0`** (`:1356, 1376`). The CSS `buildBboxTransform` rotates the entire container. Canvas pixel buffer is sized `(annWidth + BBOX_PADDING*2, annHeight + BBOX_PADDING*2)` with `BBOX_PADDING = 32`. Fabric's default mtr renders at `top - 40 * visualScale`. With shape at canvas-local `top: 32`, the mtr lives at canvas-local `y ≈ -8` — **physically outside the canvas pixel buffer**. At `angle === 0` the SVG overlay hides the clipped Fabric handle behind its own mtr, so the bug only manifests on pre-rotated shapes (where the SVG overlay short-circuits via `isBeingEditedNow` at `:1050`).
5. **Counter-session WIP lane is load-bearing.** `src/components/FabricEditCanvas.jsx` is actively held by the counter-session. Any Gap 4 fix that edits this file creates a lane conflict and requires coordination.

---

## Pitfall 1 — Gap 3 — Adding `annotations` / `visualTransform` / `editingAnnotationIndex` naively to hover-intent effect deps

**Wrong answer:** "Effect captured a stale `handleEl`, so add `annotations` (or `visualTransform`) to the dep array so it re-runs and re-queries after React reconciles."

**Why it fails:** Reintroduces the exact flicker loop that `SVGAnnotationLayer.jsx:161-171, 306-312` document as already-fixed. Every drag-rotate tick mutates `annotations` (via `onSaveAnnotations` at commit) AND mutates `visualTransform` (every `pointermove` sets `visualTransform.rotate`). Adding any of these to deps tears down and re-attaches pointerenter/pointerleave listeners **at 60 fps during rotation**, eating pointer events and reproducing the original visibility flicker that required 7 rounds of debugging in v2.1 Plan 12-02.

**Trigger path:** ESLint's `react-hooks/exhaustive-deps` rule yells at the current code (literal `eslint-disable-next-line` on line 312). A developer wanting to "fix the lint warning" walks right back into the loop.

**Correct approach — two viable strategies:**

- **Strategy A — edit-commit generation counter.** Track previous `editingAnnotationIndex` via a ref. Increment `editCommitGeneration` only on the falling edge (non-null → null). Put the counter in the hover-intent effect dep array. This captures "user just exited edit mode" without re-running on every drag tick.

- **Strategy B (preferred) — event delegation.** Query `handleEl` lazily inside `onEnter`/`onLeave` closures instead of capturing at effect-top. Attach listeners once to a stable ancestor (`svgRef.current`) with `e.target.closest('[data-rotation-handle="mtr"]')` filtering. Converts the effect from "attach listeners to a specific DOM node" to "delegate via event filtering on a stable node" — no stale refs possible by construction. The svg's `pointerEvents: isInteractive ? 'auto' : 'none'` (`:1009`) already gates correctly.

**Warning signs mid-implementation:**
- `hover-intent effect RUN` log firing more than ~1× per selection change (v2.1 baseline: exactly once per transition).
- `hover-intent effect CLEANUP` during an active rotation drag.
- Pill appears briefly then disappears during drag.
- `handleEl NOT FOUND, bailing` after edit-commit — switch to lazy query (Strategy B) or add `requestAnimationFrame` guard (Strategy A fallback).

**Counter-session lane:** Both strategies touch only `SVGAnnotationLayer.jsx`. Neither touches `FabricEditCanvas.jsx`.

---

## Pitfall 2 — Gap 3 — Adopting `MutationObserver` to detect mtr node replacement

**Wrong answer:** "Use a `MutationObserver` on svgRef with `{subtree: true, childList: true}` and re-attach listeners whenever the mtr element changes."

**Why it fails:**
1. MutationObserver fires for every SVG attribute tick. 60fps cost during drag-rotate = 10-20ms of observer callback per frame. Free perf regression.
2. Callback is async-microtask; listener re-attach races with React's next render.
3. `subtree: true` holds a strong reference to the entire SVG tree for page lifetime. Leak magnet.

**Correct approach:** Event delegation (Strategy B above).

**Warning signs:** "MutationObserver" in any commit diff; new imports of `window.MutationObserver`; >100 events/sec lifecycle logs during drag.

---

## Pitfall 3 — Gap 3 — Forgetting the `editingAnnotationIndex == null` gating

**Wrong answer:** "Just make the pill reappear whenever the cursor enters mtr."

**Why it fails:** Root SVG has `pointerEvents: isInteractive ? 'auto' : 'none'` (`:1009`). During edit mode `isInteractive = false`, so pointer events don't flow to svg — but FabricEditCanvas is on top and receiving events. Without an explicit gate, the pill can:
- Appear for a selection currently being edited (pill over Fabric edit canvas).
- Fire pointerenter on a stale mtr during the commit→select transition window and stick "visible" forever.

The current bailout is only `selectedIds.size !== 1`. When the user click-offs an edit, `selectedIds.size` stays 1 (preserved by `useSVGInteraction.js:96-107`).

**Correct approach:** Add `editingAnnotationIndex == null` as explicit gate at effect top:
```js
if (editingAnnotationIndex != null) {
  setRotInputVisible(false, 'in edit mode');
  return;
}
```
Doubles as Strategy A trigger.

**Warning signs:** Pill visible while FabricEditCanvas is rendering; pill input swallows keystrokes meant for Fabric Textbox.

---

## Pitfall 4a — Gap 4 — Chasing `overflow: hidden` that doesn't exist

**Wrong answer:** "The FEATURE-BACKLOG says suspect is `FabricEditCanvas container overflow: hidden`. Search for it, flip to `visible`, done."

**Why it fails:** That `overflow: hidden` does NOT exist. Source inspection:
- `FabricEditCanvas.jsx:950, 965`: `overflow: editType === 'shape' ? 'visible' : undefined`
- `:1662`: `wrapperEl.style.overflow = 'visible'`

Flipping overflow achieves nothing.

**What's actually happening:** The clip is a **canvas pixel buffer clip**, not a CSS overflow clip. `canvas.setDimensions` (`:1054`) sets the physical `<canvas>` element's pixel buffer. Canvas 2D drawing ops outside `(0,0)→(w,h)` simply don't exist. Fabric's default mtr has `offsetY = -40`. With shape at `top = BBOX_PADDING = 32`, mtr renders at canvas-local y ≈ `-8`. (Note: Architecture research hypothesizes an additional Syncfusion ancestor `e-pv-page-div` clipper — needs live-DOM diagnostic to confirm which clipper owns the symptom.)

At `angle: 0` the SVG overlay is on top and owns the selection chrome; Fabric's clipped handle is hidden behind it. For pre-rotated shapes, `:1050` short-circuits the SVG overlay during edit. The Fabric-drawn handle is the ONLY chrome visible — and it's clipped.

**Correct approach — two orthogonal fixes:**

### Fix A / Option C (structural, PREFERRED, lane-safe)
Let SVGSelectionOverlay keep rendering the mtr handle during edit mode for rotated shapes. Change the `SVGAnnotationLayer.jsx:1050` early-return condition so it returns null ONLY for `editIsBorderFlush && angle === 0`, OR returns a stripped overlay (just the mtr handle, no bbox, no resize pills) when `editIsBorderFlush && angle !== 0`. Fabric provides resize chrome; SVG provides the rotation handle visual.

The SVG root has `pointerEvents: isInteractive ? 'auto' : 'none'` so during edit the handle is visual-only — and that's fine. Edit-mode rotation is already descoped per PROJECT.md line 71. The SVG handle in edit mode only needs to APPEAR, not be draggable. Users rotate from select mode; typed RotationInputField is the in-edit rotation UI.

**Touches:** `SVGAnnotationLayer.jsx` (modify short-circuit) + possibly `SVGSelectionOverlay.jsx`. **Zero counter-session conflict.**

### Fix B / Option A (canvas sizing, deferred fallback)
Grow `BBOX_PADDING` from 32 to ~72 so Fabric's mtr falls inside `(0, canvasHeight)`. Or install a custom Fabric Control for mtr with `offsetY: -20`.

**Cost:** `BBOX_PADDING` block comment (`:66-83`) warns lowering was bad; raising enlarges the "dead zone" around small shapes where Fabric empty-click dismisses edit mode (`:1846-1883`). A counter ~20px inside an ~84px container already has a huge dead zone.

**Touches:** `FabricEditCanvas.jsx` — **LANE CONFLICT with counter-session WIP.** Must coordinate stash before starting. Do NOT touch `counterRotate` custom control (`:1379-1479`) marked `[COUNTER WIP — DO NOT TOUCH]`.

**Recommendation:** Fix A. Fix B only if Fix A is blocked AND counter-session coordinates.

**Warning signs:**
- Searching for `overflow: hidden` to flip — STOP, read `:882-1005`.
- Modifying `wrapperEl.style.overflow` — already `visible`.
- Fix A breaking border-flush edit at angle=0 — widened condition wrong.
- Fix B requiring `BBOX_PADDING > 50` — counter dead-zone test regresses.

---

## Pitfall 4b — Gap 4 — Deleting the edit-mode SVG overlay short-circuit entirely

**Wrong answer:** "Just delete the `if (isBeingEditedNow && (editIsBorderFlush || editIsCounter)) return null;`. Render SVG overlay always."

**Why it fails:** Regresses v2.0 Phase 10/11 edit-chrome integration. Rendering BOTH Fabric edit chrome AND SVG selection overlay produces **doubled handles** — each corner + pill drawn twice with different anti-aliasing (per the 2026-04-10 Canvas 2D vs SVG rasterizer gotcha). Users see ghost handles.

**Correct approach:** Modify the condition narrowly. Only show the **mtr handle subtree**, only when `isBeingEditedNow && angle !== 0`.

---

## Pitfall 4c — Gap 4 — Applying `snapAngle: 45` or touching rotation interactivity

**Wrong answer:** "While fixing the mtr clip, also add `obj.snapAngle = 45` during Shift for edit-mode rotation snap."

**Why it fails:** Fabric edit-mode shape rotation is **explicitly out of scope** per PROJECT.md line 71: *"Fabric edit canvas shape rotation snap (commit-lossy on force-zero/restore cycle) — SVG-path snap only for v2.1, Fabric-path rotation out of scope"*. The force-zero-at-edit-start / restore-at-commit cycle is commit-lossy.

**Correct approach:** Keep `angle: 0` and `lockRotation` as-is. Gap 4 is visibility only. Users have two rotation paths already (drag in select mode; type in pill).

**Also:** typing in RotationInputField NEVER applies Shift-snap even if Shift held (v2.1 locked decision). Any "while I'm here" addition of snap to typed input is an instant boundary violation.

**DO NOT CHANGE:** Fabric `lockRotation`, `snapAngle`, `angle: 0` at edit start, `commitAndClose` angle restore path.

---

## Pitfall 4d — Gap 4 — Breaking `buildBboxTransform` order

**Wrong answer:** "Flip `buildBboxTransform` order from `scale × translate × rotate` to `translate × rotate × scale`."

**Why it fails:** Comment at `:251`: *"When sx ≠ sy, scale × rotate ≠ rotate × scale, so order matters."* Under `preserveAspectRatio="none"`, SVG viewBox does page-space scale × rotate. CSS must match. Flipping reintroduces the rotation mismatch that v2.0 Phase 11 explicitly fixed.

**Correct approach:** Don't touch `buildBboxTransform`.

**DO NOT CHANGE:** `:247-259` and call sites `:952, 1962`.

---

## Pitfall 5a — Gap 2 — "Nearest visible side" logic for rotated shapes

**Wrong answer:** "If mtr is off-screen, relocate to opposite side. Opposite of top = bottom, so use `mb`'s position."

**Why it fails:** For a rotated shape, mtr's screen-space position is `rotate(mtr_viewBox, shapeCenter, angle)`. For a 45°-rotated square whose top-left quadrant is off-screen, mtr points "up-left" in screen space; opposite is NOT `mb`. The `<g>` wraps `transform="rotate(angle, cx, cy)"` (`SVGSelectionOverlay.jsx:65`), but mtr coords inside are expressed in the unrotated bbox frame. Mixing "screen-visible side" (viewport pixels) with "local handle ID" (pre-rotation viewBox coords) is a coordinate-space category error.

**Correct approach:**
- Compute mtr's screen-space position via `svgRef.current.getScreenCTM()` composed with the overlay group's `rotate(angle, cx, cy)`. `DOMPoint.matrixTransform` gives final screen coords.
- Check which screen edge is clipped past.
- Negate the unit vector from `(cx, cy)` through unrotated mtr; rotate by `angle` to get screen-space direction. "Opposite" direction vector, NOT a handle ID.

**Warning signs:** `handle.id === 'mb'` switching in relocation code; relocation producing a handle that moves through the shape interior at some angles.

---

## Pitfall 5b — Gap 2 — Oscillation at the viewport edge

**Wrong answer:** "If mtr is off-screen, move to opposite side. Done."

**Why it fails:** Binary thresholds without hysteresis oscillate on the boundary. At rotation angles where the handle hovers right at the edge (359° → clipped; 360° → not; 1° → clipped again), the handle flips sides every frame.

**Correct approach:**
- **Hysteresis:** enter at ≥16px offscreen clip; exit at ≥32px back inside. 16px dead-band.
- **Latched state per shape:** `relocatedByShapeId: Map<index, boolean>`.
- **Freeze during active drag:** defer relocation decisions to `pointerup`.

**Warning signs:** Pill flipping sides during a single drag; "flicker at 359°" in UAT.

---

## Pitfall 5c — Gap 2 — "It slots cleanly" scope creep

**Wrong answer:** "Gap 2 is conditional per PROJECT.md. It's just coordinate math — slots cleanly."

**Why it fails:** "Just coordinate math" is wrong. Gap 2 requires:
- Viewport-clip detection with hysteresis (5b)
- Rotated-shape side math (5a)
- Pill follow logic — `computeInputPosition` radial anchor change
- ResizeObserver + scroll listeners for Syncfusion page scroll/zoom
- State machine integration with Gap 3's hover-intent fix

**That's not a ~50-LOC drop-in.** Plan 12-02 was estimated at ~11 LOC and shipped at 1,195 LOC. Same failure mode waiting in Gap 2.

**Note:** Architecture and Stack research assess Gap 2 as "architecturally clean" (pure utility + prop threading). Features and Pitfalls research assess it as "risky scope creep + UX convention mismatch." Synthesizer / roadmapper must resolve this tension.

**Recommended approach:**
- **DEFAULT to DEFERRING Gap 2.**
- **Only include AFTER Gap 3 and Gap 4 are CODE-COMPLETE and VERIFIED**, with ≥2 days slack remaining.
- **If included, scope as SEPARATE phase** (12.1 or 13.5), not folded into Gap 3/4's phase.

---

## Pitfall 6 — Cross-gap — Testing Gap 3 against `angle=0` only

**Wrong answer:** "Gap 3 test: rotate shape, enter edit, click off, hover mtr, pill appears. Test with a rect at angle=0."

**Why it fails:** The interaction with Gap 4 means the test must cover both pre-rotated and non-rotated shapes:
- `angle === 0` rect: SVG overlay short-circuited during edit (`:1050`); overlay re-mounts on edit end → stale-ref path.
- `angle !== 0` rect with Gap 4 Fix A: SVG overlay stays mounted during edit. No mount/unmount — Gap 3 may not manifest at all.
- `angle !== 0` rect with Gap 4 Fix B: SVG overlay still short-circuits.

**Correct approach:**
- **UAT grid:** `{angle=0, angle=30} × {editType:text, editType:shape} × {exit via click-off / Escape / Enter-commit}`
- **Race test:** hover mtr during the 50ms `setTimeout` in `text:editing:exited` (`FabricEditCanvas:1769`). Pill should NOT appear during commit, should appear after.

---

## Pitfall 7 — Cross-gap — Breaking the v2.1 optimistic-paint pattern

**Wrong answer:** "Add a useEffect that watches `visualTransform` to trigger hover-intent re-evaluation."

**Why it fails:** `visualTransform` is set on every pointermove during drag-rotate and cleared via `clearOptimisticRotation` after typed commits. Watching it as an effect dep means hover-intent re-runs at 60fps during drag AND once per typed commit.

**Correct approach:**
- Read `visualTransform.rotate` via a **ref** in any closure that needs live angle.
- Never put `visualTransform` in a dep array outside `useSVGInteraction`'s own internals.
- **Sanity test:** `console.count()` in hover-intent effect body. Drag-rotate 2s. Count should be ≤3. If ≥60, pattern is broken.

---

## Pitfall 8 — Cross-gap — Staging counter-session WIP files

**Wrong answer:** "`git add -p` and cherry-pick my hunks from the modified files."

**Why it fails:** Counter-session has uncommitted WIP in 7 files. `git add -p` is easy to mis-stage.

**Counter-session files — NEVER stage from v2.2 unless authorized:**
- `src/App.jsx` (always protected + counter WIP)
- `src/components/PageAnnotationLayer.jsx` (always protected + counter WIP)
- `src/components/FabricEditCanvas.jsx` (counter WIP; only if Fix B authorized)
- `src/hooks/useDatabase.js` (counter WIP)
- `src/utils/counterNumbering.js` (counter WIP)
- `src/utils/svgAnnotationRenderers.jsx` (counter WIP)
- `dist/index.html` (build artifact + counter WIP)

**Per-gap lane safety:**
- **Gap 3 touches ONLY** `SVGAnnotationLayer.jsx` — lane-safe.
- **Gap 4 Fix A touches ONLY** `SVGAnnotationLayer.jsx` (+ possibly `SVGSelectionOverlay.jsx`) — lane-safe. **Preferred.**
- **Gap 4 Fix B touches** `FabricEditCanvas.jsx` — **BLOCKED until counter-session coordinates.**
- **Gap 2 (if included) touches** `SVGAnnotationLayer.jsx`, `RotationInputField.jsx`, `rotationInputHelpers.js`, new `handlePlacementMath.js`, possibly `SVGSelectionOverlay.jsx` — lane-safe.

**Rules:**
- Prefer Fix A for Gap 4.
- Never `git add -A` or `git add .` for v2.2. Always explicit paths.
- `git status` cross-check before every commit.

---

## Pitfall 9 — Cross-gap — `shapeCenterViewBox` useMemo invalidation

**Wrong answer:** "Clean up `shapeCenterViewBox` — its useMemo re-computes on every annotation change."

**Why it fails:** Block comment at `SVGAnnotationLayer.jsx:341-347` warns the memo is load-bearing: *"without it, this returns a fresh {x, y} object on every parent render, which invalidates RotationInputField's position useEffect dependency."* Shrinking deps to `[selectedAnnotationIndex, annotations?.objects?.[selectedAnnotationIndex]]` fails because `handleRotationInputCommit` deep-clones via `JSON.parse(JSON.stringify())` — selected object reference is always fresh.

**Correct approach:** Don't touch it.

**DO NOT CHANGE:** `:348-357` (and comment block at `:341-347`).

---

## Pitfall 10 — Cross-gap — `querySelector` in render body or useMemo

**Wrong answer:** "Move the `querySelector('[data-rotation-handle="mtr"]')` into a `useMemo` so it's cached."

**Why it fails:** `querySelector` inside `useMemo` or render body is an impure side-effect read. `useMemo` runs during render, BEFORE React commits the new DOM — you capture the previous commit's node.

**Correct approach:** DOM queries go in `useEffect` (after commit) or event handlers (after user interaction).

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase/Plan | Verification |
|---|---|---|
| 1: Naive hover-intent deps | Gap 3 plan | `console.count` on effect body during drag-rotate ≤3 |
| 2: MutationObserver | Gap 3 plan DO NOT | grep Gap 3 diff for "MutationObserver" = 0 |
| 3: Missing `editingAnnotationIndex` gate | Gap 3 plan AC | Pill invisible during FabricEditCanvas active edit |
| 4a: Non-existent `overflow:hidden` chase | Gap 4 plan context | Developer reads `FabricEditCanvas:882-1005` first |
| 4b: Delete edit-mode short-circuit | Gap 4 plan DO NOT | `:1050` condition modified, never deleted |
| 4c: Add `snapAngle`/rotation interaction | Gap 4 plan DO NOT | Fabric `lockRotation`, `snapAngle`, `angle=0` untouched |
| 4d: Flip `buildBboxTransform` order | Gap 4 plan DO NOT | `:247-259` + call sites untouched |
| 5a: Gap 2 rotated-shape side bug | Gap 2 plan (if included) | AC includes 45° and 135° rotated shapes |
| 5b: Gap 2 oscillation | Gap 2 plan (if included) | 16px/32px hysteresis in AC |
| 5c: Gap 2 scope creep | Roadmapper, v2.2 phase structure | Gap 2 is SEPARATE conditional phase |
| 6: Gap 3 angle=0-only testing | Gap 3 plan AC | 2×2×3 UAT grid |
| 7: Breaking optimistic-paint | All v2.2 plans DO NOT | `visualTransform` not in any dep array outside useSVGInteraction |
| 8: Staging counter-session files | Every v2.2 phase DO NOT CHANGE | Explicit 7-file allowlist in plan frontmatter |
| 9: `shapeCenterViewBox` memo invalidation | All v2.2 plans DO NOT | `SVGAnnotationLayer:348-357` untouched |
| 10: `querySelector` in render/useMemo | Gap 3 plan | grep for `querySelector` outside useEffect = 0 |

---

## Counter-Session Lane Conflict Summary

**Files held by counter-session WIP:** `src/App.jsx`, `src/components/PageAnnotationLayer.jsx`, `src/components/FabricEditCanvas.jsx`, `src/hooks/useDatabase.js`, `src/utils/counterNumbering.js`, `src/utils/svgAnnotationRenderers.jsx`, `dist/index.html`.

**Recommended ordering:** Gap 3 → Gap 4 Fix A → verify 113/113 + AC green → optional Gap 2 as separate phase. Gap 4 Fix B kept as deferred fallback.

---

## "Looks Done But Isn't" Checklist

- [ ] **Gap 3** tests both `angle=0` AND `angle=30` shapes
- [ ] **Gap 3** tests all three exit paths: click-off, Escape, Enter-commit
- [ ] **Gap 3** tests both `editType=text` and `editType=shape`
- [ ] **Gap 4** verified at `es=0.10`, `es=1.00`, `es=2.00`
- [ ] **Gap 4** verified on rect + circle + ellipse + text
- [ ] **Gap 4** Fix A visual-only mtr — confirm non-interactive is intentional
- [ ] **Gap 2** (if included) tested at all 4 page corners + edges + inside corners
- [ ] **Gap 2** (if included) tested with axis-aligned AND rotated shapes
- [ ] All commits exclude counter-session files — `git status` cross-check
- [ ] Plan 12-02 focus-loss scenarios still green
- [ ] Optimistic-paint pattern preserved
- [ ] Typed-value snap de-scope preserved (typing 44 with Shift → commits 44°)
- [ ] 113/113 v2.1 test baseline still green

---

## Key Findings Summary

1. **FEATURE-BACKLOG's Gap 4 `overflow: hidden` suspicion is FALSE.** Real culprit is canvas pixel buffer clip (BBOX_PADDING=32 - rotatingPointOffset=40 = y=-8 outside drawable surface). Architecture research adds: possible Syncfusion ancestor (`e-pv-page-div`) clipper — needs live-DOM diagnostic.
2. **Gap 4 has a clean structural fix that avoids the counter-session lane.** Fix A (Pitfalls) / Option C (Architecture): modify `SVGAnnotationLayer:1050` short-circuit to preserve SVG mtr handle visual-only when `angle !== 0`. Touches only `SVGAnnotationLayer.jsx` + possibly `SVGSelectionOverlay.jsx`. Does NOT touch `FabricEditCanvas.jsx`. **Preferred.**
3. **Gap 3's fix must preserve the v2.1 Plan 12-02 hover-intent dep array.** The `eslint-disable` at line 312 is load-bearing. Use Strategy A (edit-commit generation counter) or Strategy B (event delegation) — prefer B.
4. **Gap 2 is architecturally split** — Stack + Architecture assess it as clean (pure math, ~40-80 LOC). Features + Pitfalls assess it as risky (UX convention + scope creep precedent). Synthesizer decision. **Default to deferral.**
5. **Counter-session lane discipline is explicit.** 7 files must NEVER be staged from v2.2 unless authorized. Gap 3 and Gap 4 Fix A have zero overlap.

---

*Research sources: direct source inspection of `SVGAnnotationLayer.jsx`, `SVGSelectionOverlay.jsx`, `RotationInputField.jsx`, `FabricEditCanvas.jsx`, `useSVGInteraction.js`, `svgBoundingBox.js`; `1.log` runtime evidence; cross-reference with `PROJECT.md`, `FEATURE-BACKLOG.md`, `milestones/v2.1-ROADMAP.md`, `CLAUDE.md`.*
