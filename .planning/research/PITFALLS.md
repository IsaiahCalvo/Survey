# Pitfalls Research — v2.1 Stage 0 Shape Edit Polish

**Domain:** Polish milestone inside an existing PDF annotation codebase
**Researched:** 2026-04-12
**Confidence:** HIGH
**Scope:** Only the three integration points confirmed by ARCHITECTURE.md
(`useSVGInteraction.js:391-408`, `zoomController.js:15`, `App.jsx:21999`).
Total diff footprint: ~5 LOC across 3 files.

> **TL;DR — Almost nothing to worry about at 5 LOC.**
>
> The two features are independent, the integration points are well-funneled,
> and CLAUDE.md's load-bearing invariants (container-aware sizing, `vector-effect:
> non-scaling-stroke`, `zoomGeneration` signal) are not touched. The entire
> pitfall surface for this milestone fits in a ~15-minute manual smoke test.
>
> The real pitfalls here are **scope creep** (touching files beyond the 3
> targets) and **mid-drag modifier state** (the one real UX gotcha in the
> rotation snap). Everything else is "read the diff twice and ship."

---

## Critical Pitfalls

### Pitfall 1: `const newAngle` → `let newAngle` promotion is silently forgotten

**What goes wrong:**
In `src/hooks/useSVGInteraction.js:396` the current code reads
`const newAngle = normalizeAngle(radians);`. The Stage 0 change needs to
reassign `newAngle` inside the `if (e.shiftKey)` branch. If the implementer
writes `newAngle = Math.round(newAngle / 45) * 45;` without first promoting
`const` → `let`, the build will fail with `Assignment to constant variable.`

**Why it happens:**
The existing rotate branch was written as a single assignment. A diff that
reads "add an `if` block after the normalize call" is easy to propose
without noticing the `const` keyword one line up.

**How to avoid:**
Single tiny note in PLAN.md for this change: "promote `const newAngle` to
`let newAngle` on line 396 as part of the edit." Treat as one atomic change.
If the dev server throws `Assignment to constant variable` on first save,
this is the cause — zero other places in the rotate branch use `const newAngle`.

**Warning signs:**
Vite HMR overlay red banner on first save.

**Phase to address:**
Stage 0 phase PLAN.md — call out the `const → let` in the task description.

---

### Pitfall 2: Shift pressed MID-drag doesn't snap, user thinks feature is broken

**What goes wrong:**
A user starts dragging the rotation handle at (say) 37°, mid-drag presses
Shift, and expects the shape to instantly snap to 45°. With the proposed
implementation, **nothing happens until the next `pointermove` event fires.**
If the user holds Shift without further pointer motion, the shape stays at
37° — no snap.

The converse is also true: releasing Shift mid-drag doesn't visually "unstick"
from the last snapped angle until the pointer moves again.

**Why it happens:**
The implementation reads `e.shiftKey` inside `handlePointerMove`, so snap
state is only re-evaluated when the pointer moves. This is a property of
pointer-event-driven state — modifier changes alone don't fire `pointermove`.
Illustrator, Figma, and Excalidraw all have the exact same behavior.

**How to avoid:**
**Do not invent a workaround.** This matches the industry convention (per
FEATURES.md competitor survey). The user's physical motion drives the snap,
which is correct. The fix users actually want is "wiggle the pointer 1px
while holding Shift" — which they will naturally do within 200ms without
realizing it.

**Explicitly do NOT:**
- Add `keydown`/`keyup` listeners on `window` to force a re-eval
- Cache `e.shiftKey` into a ref and re-run the rotate handler on key events
- Simulate a `pointermove` on key state change

Any of these would add complexity to the 3-LOC fix and introduce a new
coupling between the pointer and keyboard event loops in `useSVGInteraction`.

**Warning signs:**
Only a concern if user feedback says "snap feels broken when I press Shift
after starting the drag." The fix (if ever requested) is not in Stage 0.

**Phase to address:**
Stage 0 phase CONTEXT.md acceptance criteria — explicitly write: "Given a
rotation drag is in progress, when Shift is pressed, then the snap takes
effect on the next pointer move (not instantly). This matches Figma /
Illustrator / Excalidraw and is accepted behavior."

---

### Pitfall 3: Companion zoom input change shipped separately from the `MIN_SCALE` constant

**What goes wrong:**
The zoom floor has two sites (STACK.md + ARCHITECTURE.md both flagged this):
1. `src/utils/zoomController.js:15` — `const MIN_SCALE = 0.5`
2. `src/App.jsx:21999` — `const clamped = Math.min(Math.max(parsed, 50), 500)`

If a dev ships **only** the `zoomController.js` change, then typing `10`
into the zoom input gets clamped to `50` by the App.jsx pre-clamp
(line 21999) **before** it ever hits `clampScale`. The user would see the
zoom snap back to 50% with no explanation.

If a dev ships **only** the `App.jsx` change, then the value 0.1 gets past
the input guard but `clampScale` at `zoomController.js:23` re-clamps to 0.5,
same visible broken state.

**Why it happens:**
App.jsx is in the Always Protected list; a cautious developer might leave
it alone and assume the `MIN_SCALE` constant is the only real change. Or
they might ship the constant change in one commit "because it's simple"
without noticing the hardcoded 50 in App.jsx.

**How to avoid:**
**Both changes MUST land in the same commit.** Put them in the same task in
PLAN.md, not two tasks. Add an acceptance criterion: "Given I type `10` in
the zoom input and press Enter, when the value is accepted, then the scale
becomes 0.1 and the displayed zoom indicator reads `10%` — verify BOTH
files were edited by grepping the diff for `MIN_SCALE` AND line 21999."

**Warning signs:**
User types 10, value snaps back to 50. Obvious within 10 seconds of the
smoke test.

**Phase to address:**
Stage 0 phase PLAN.md — single task "zoom floor 10%" with both file edits,
single commit.

---

## Moderate Pitfalls

### Pitfall 4: Scope creep into `FabricEditCanvas.jsx`

**What goes wrong:**
STACK.md's original Q1 recommendation proposed adding `obj.snapAngle=45` in
`FabricEditCanvas.jsx`'s `loadShapeAnnotation` callback (~line 1050). A
planner reading STACK.md without ARCHITECTURE.md would follow this advice.
But ARCHITECTURE.md Q1c proved that shape rotation in FabricEditCanvas is
**commit-lossy**: the commit path at `FabricEditCanvas.jsx:476-477`
overwrites `json.angle` with the pre-edit angle. Adding snap there is pure
dead code that touches the Always Protected file for no user-visible effect.

**Why it happens:**
Two research files in the same folder giving overlapping guidance. STACK.md
was written before the Fabric commit-lossy discovery.

**How to avoid:**
Phase CONTEXT.md's DO NOT CHANGE section must include
`src/components/FabricEditCanvas.jsx` explicitly, with the note:
"FabricEditCanvas shape rotation is commit-lossy (angle force-zero on
load, restore on commit). Do NOT add `snapAngle` here — it would have no
user-visible effect and violates Always Protected boundaries."

Cross-reference: ARCHITECTURE.md Q1c has the full file:line evidence
(`FabricEditCanvas.jsx:1036` force-zero, `:476-477` restore override).

**Warning signs:**
Any diff against Stage 0 that touches `FabricEditCanvas.jsx` is a
boundary violation. The phase-discipline hook should flag this.

**Phase to address:**
Stage 0 CONTEXT.md — include in DO NOT CHANGE with the rationale quoted
above.

---

### Pitfall 5: Scope creep into legacy PAL rotation path

**What goes wrong:**
`src/PageAnnotationLayer.jsx:6080-6355` contains a second complete rotation
implementation (modifier-key rotate in Pan tool). A developer seeking
"consistency" might propose adding Shift-snap here too. PAL is ~9,858 lines
and Always Protected; touching it for a legacy code path the user rarely
reaches is all risk, zero benefit.

**Why it happens:**
Grep-based thoroughness — "find all rotation math in the codebase, add snap
to each." The developer doesn't realize this path is effectively dead in
v2.0+.

**How to avoid:**
Phase CONTEXT.md DO NOT CHANGE must explicitly list
`src/PageAnnotationLayer.jsx` with the note: "legacy modifier-rotate path
at lines 6080-6355 is out of scope. SVG path in `useSVGInteraction.js` is
the only rotation integration point for Stage 0."

**Warning signs:**
Any diff touching `PageAnnotationLayer.jsx` is a boundary violation.

**Phase to address:**
Stage 0 CONTEXT.md — include in DO NOT CHANGE.

---

### Pitfall 6: Handles at very low zoom are hard to target (accepted, but easy to mis-classify as a defect)

**What goes wrong:**
At 10-25% zoom the rotation + resize handles in `SVGSelectionOverlay.jsx`
are scaled by `inverseScale` (≈10 at 10% zoom) so they maintain constant
screen size — but on a 61-pixel-wide page rendering, the handles occupy a
large fraction of the visible shape. Handles may stack / occlude each other
on small annotations. A bug report reader will see this and call it a
regression.

**Why it happens:**
The 50% floor masked this edge case. At ≥50% a handle is always smaller than
its parent shape; at 10% it may not be. This is a known convention
(Illustrator/Photoshop/Excalidraw all ship with the same behavior — see
FEATURES.md "Edge Case Analysis").

**How to avoid:**
- Add to phase CONTEXT.md acceptance criteria: "Given zoom is below 25%,
  when the user tries to grab a resize/rotation handle, then handles may
  be hard to target — this is accepted table-stakes behavior matching
  Illustrator/Photoshop. The user is expected to zoom back in to edit.
  This is NOT a defect."
- Record in phase RECONCILIATION.md as a known carry-forward so future
  sessions don't relitigate. If users complain, the fix is a v2.2 follow-up
  (Figma-style hide-handles-below-threshold, ~20 LOC in `SVGAnnotationLayer`).

**Warning signs:**
User feedback "handles don't work at 10% zoom." Expected and not Stage 0's
problem.

**Phase to address:**
Stage 0 CONTEXT.md acceptance criterion explicitly stating it is accepted
behavior. Defer the real fix to v2.2.

---

## Minor Pitfalls

### Pitfall 7: Snapped angle of exactly 360° persisted instead of 0°

**What goes wrong:**
`normalizeAngle` at `src/utils/svgTransformMath.js:37` returns
`((radians * 180 / Math.PI) + 90 + 360) % 360`, so its output is in
`[0, 360)`. The snap expression `Math.round(newAngle / 45) * 45` can
produce `360` from inputs in `[337.5, 360)` (because `Math.round(350/45) =
Math.round(7.78) = 8`, and `8 * 45 = 360`). A persisted `obj.angle === 360`
is semantically equivalent to `0` but may confuse any future equality check
or animation interpolation.

**Why it happens:**
Snap rounding can push a value over the top of the `[0, 360)` half-open
range.

**Mitigation (defensive, 1 extra expression, 4 characters):**
```js
if (e.shiftKey) {
  newAngle = (Math.round(newAngle / 45) * 45) % 360;
}
```
The SVG renderer (`svgAnnotationRenderers.jsx:59-67, 116, 291, 336`) uses
`transform="rotate(${obj.angle}, cx, cy)"` which handles any number
correctly, and `getCursorForHandle` at `svgTransformMath.js:108` already
wraps via `(angleDegrees % 360 + 360) % 360` — so nothing in the current
codebase *breaks* on `360`. This mitigation is tidiness, not correctness.

**How to avoid:**
Add the trailing `% 360` in the snap expression. Optional but free.

**Warning signs:**
None today. Would only surface if a future feature added `if (obj.angle ===
0)` expecting 360→0 coalescing. No such check exists now.

**Phase to address:**
Stage 0 — include the `% 360` wrap as a freebie. Or document as deferred
cleanup. Either is acceptable.

---

### Pitfall 8: `commitZoomInput` pre-clamp restructured instead of literal-swapped

**What goes wrong:**
A developer thinks "`clampScale` exists, this pre-clamp is redundant, I'll
delete it for cleanliness." Deleting the pre-clamp (not just swapping 50→10)
changes the error-recovery behavior of the zoom input — absurd values like
`99999` would flow straight to `clampScale` instead of being capped at 500
first. Also, `parsed` can legitimately be `NaN` (`parseInt('abc')`) and the
`Math.min(Math.max(parsed, 50), 500)` guard indirectly participates in NaN
propagation (`Math.max(NaN, 50) = NaN`, which `clampScale` then rejects via
its `Number.isNaN` check).

Deleting the pre-clamp is never strictly wrong, but it changes the input
sanitization surface on a hot path that has existing production behavior.
Out of scope for this milestone.

**Why it happens:**
"Clean up while I'm in there" instinct.

**How to avoid:**
PLAN.md explicitly says: "Change exactly one literal on line 21999:
`50` → `10`. Do not restructure the `Math.min(Math.max(...))` expression.
Do not delete the guard. Do not introduce a helper."

**Warning signs:**
Diff shows more than one token changed on line 21999.

**Phase to address:**
Stage 0 PLAN.md — write the change as a literal-swap task with the exact
before/after.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip the `% 360` wrap on snapped angle | 4 chars saved | Future equality check could misbehave on a 360 value — tiny risk | Always, but adding the wrap is free and strictly better |
| Ship zoom floor in one file only (thinking `clampScale` catches everything) | "Fewer App.jsx edits" | Broken zoom input UX for typed values | **Never** — companion edit is mandatory |
| Add `snapAngle` to FabricEditCanvas for "consistency" | Appears to cover both rotation code paths | Dead code in a 9,000-line Always Protected file; no user-visible effect | **Never for Stage 0** — only if the commit-lossy force-zero at `FabricEditCanvas.jsx:1036` is fixed first |
| Delete the pre-clamp at App.jsx:21999 | "Simpler" | Changes input-sanitization behavior on hot path | **Never in a polish milestone** |

---

## Integration Gotchas (Two Features Interacting)

The two Stage 0 features are fully independent at the file level (different
files, different call stacks). But they share a smoke-test surface that is
worth calling out:

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Rotation snap + 10% zoom | "Test snap at 100% zoom only" | Also test snap at 10% zoom. At low zoom the rotation handle is hard to grab (Pitfall 6), so the test is: zoom to fit (≥50%), select a shape, start rotating with Shift held, then zoom out to 10% mid-drag via Cmd+- (if reachable without releasing), release, confirm the saved angle is a multiple of 45°. A simpler variant: zoom to 10% first, then Shift-drag rotate. This validates that the new lower scale doesn't break rotation math. |
| Zoom floor + `zoomGeneration` signal | "Does lowering the floor fire extra zoomGeneration events?" | No — `zoomGeneration` is signaled inside `beginSyncfusionScaleConfirmPending`, which runs on every zoom commit regardless of value. Lowering the floor changes only *which* scale values are reachable, not *how* the signal fires. CLAUDE.md's "NEVER remove zoomGeneration" rule is respected by doing nothing to the signal. |
| Zoom floor + container-aware sizing | "At 10% does `effectiveScale` blow up?" | No — `effectiveScale = parentEl.offsetWidth / pageWidth`. At 10% viewer zoom, `parentEl.offsetWidth ≈ 61px` for a 612pt page, so `effectiveScale ≈ 0.1`. Finite, positive, valid. `FabricEditCanvas.jsx:752` sets `canvas.setZoom(effectiveScale)` which Fabric.js 5.5.2 handles correctly. Dimensions use `Math.ceil` at `:1114-1115`, guaranteeing `≥1px` (no zero-size canvas even for tiny shapes). |
| Zoom floor + `normalizeInteractionMeasuredScale` sanity band | "Does the `[0.55x, 1.8x]` band at `App.jsx:449-450` reject measurements at 10%?" | No — it's a **ratio** band against `viewerScale`, not an absolute floor. At `viewerScale=0.1`, the band is `[0.055, 0.18]`. Any measurement within 55%–180% of expected passes. A 1px jitter at 61px is 1.6% — comfortably inside the band. |
| Zoom floor + `measureSyncfusionPageHostScale` floor | "Does `Math.max(0.1, ...)` at App.jsx:435 already support 0.1?" | Yes, exactly. That existing floor proves the codebase already anticipated 10% as a valid scale elsewhere. Lowering `MIN_SCALE` to match is consistent with existing logic. |

---

## Testing Smoke Test (the whole Stage 0 QA surface)

**Prerequisite:** Dev server running, "Package 2 - Rev 4 -- IC.pdf" open on
page 6. SVG mode active (default).

**Zoom floor smoke (3 minutes):**

1. Click zoom input, type `10`, press Enter → expect zoom snaps to 10%,
   page visibly shrinks, zoom indicator reads `10%`. (Fails Pitfall 3 if
   value clamps back to 50.)
2. Cmd+- repeatedly from fit-zoom → expect zoom buttons decrement through
   each step down to 10% (they funnel through `clampScale`). Confirm minimum
   stop at 10%.
3. Cmd+= back up → expect zoom climbs normally, no stuck state. Confirm
   annotations re-render cleanly at each intermediate level (25%, 50%, 75%,
   100%).
4. Fit-page / fit-width buttons → confirm they still work and do not bypass
   the new floor (they go through `clampScale` via `computeScaleForMode`).
5. At 10% zoom, confirm a selected shape's selection handles are visible
   (they should be — `inverseScale * ~10` keeps them at constant screen
   size even though the shape is ~6px tall on a 61px-wide page). Acceptance
   is "visible but hard to grab" — see Pitfall 6.

**Rotation snap smoke (3 minutes):**

6. Create a rectangle annotation, select it, grab the rotation handle (mtr)
   and drag freely → confirm no snap, smooth rotation, final angle is a
   float.
7. Repeat with Shift held → confirm visible stepping through 45°
   increments. Release → confirm commit at a 45° multiple (inspect via
   devtools or the annotation JSON).
8. Start a rotation without Shift, then press Shift mid-drag, move pointer
   1px → confirm snap kicks in on next move. (Validates Pitfall 2 is
   accepted behavior.)
9. Start with Shift, rotate to 45°, release Shift mid-drag, keep dragging →
   confirm free float resumes from 45°. No "stickiness."
10. **Cross-feature:** zoom to 10%, select shape, Shift+drag rotation
    handle. At 10% the handle is small. Confirm snap still works. This
    validates that lowering `MIN_SCALE` did not accidentally break the
    snap-on-rotate pathway.

**Regression watch (2 minutes):**

11. Free rotate at 100% zoom → confirm unchanged (unmodified drag still
    produces float angles, no unintended snap).
12. Shift+resize at 100% zoom → confirm aspect-lock resize still works.
    The existing `e.shiftKey` branch at `useSVGInteraction.js:361` is
    adjacent to the new rotate-snap branch; verify the refactor didn't
    touch it.
13. Zoom wheel at default settings → confirm smooth zoom, no jitter at the
    10% boundary.
14. Pen tool at 10% zoom → confirm pen strokes render with
    `vector-effect: non-scaling-stroke` (stroke width constant on screen).
    No invisible strokes, no hit-test failures.

**Total manual smoke time:** ~8 minutes. No automated tests.

**Automated test harness status:**
There is no Playwright/Jest rotation test in this codebase today (confirmed
by absence of rotation test files). A rotation snap test could be added to
a future harness but is **not required** for Stage 0 acceptance. The manual
smoke above covers every pitfall in this file.

---

## "Looks Done But Isn't" Checklist

- [ ] **Zoom floor change:** did BOTH `zoomController.js:15` AND `App.jsx:21999` ship? (grep the diff for both; Pitfall 3)
- [ ] **Rotation snap change:** was `const newAngle` promoted to `let newAngle`? (Pitfall 1)
- [ ] **Rotation snap change:** was the SVG path (`useSVGInteraction.js`) edited and the Fabric path (`FabricEditCanvas.jsx`) NOT edited? (Pitfall 4 — FabricEditCanvas is commit-lossy)
- [ ] **DO NOT CHANGE list:** does the phase CONTEXT.md include `PageAnnotationLayer.jsx` (Pitfall 5), `FabricEditCanvas.jsx` (Pitfall 4), `SVGAnnotationLayer.jsx`, `FabricDrawingCanvas.jsx`, `FabricEraserCanvas.jsx`?
- [ ] **Acceptance criteria:** does CONTEXT.md explicitly state "handles at <25% zoom are hard to grab — accepted table-stakes" (Pitfall 6)?
- [ ] **Acceptance criteria:** does CONTEXT.md explicitly state "Shift pressed mid-drag snaps on next pointer move, not instantly" (Pitfall 2)?
- [ ] **Smoke test step 10:** did the tester specifically try rotation snap at 10% zoom (integration pitfall)?
- [ ] **Regression check 12:** did the tester verify Shift+resize (aspect lock) still works after the rotation snap edit?

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Zoom input snaps back to 50% after typing 10 (Pitfall 3) | LOW | Edit `src/App.jsx:21999` — change `50` to `10`. Single-line hotfix. |
| `const newAngle` assignment error (Pitfall 1) | TRIVIAL | Promote to `let` on line 396 of `useSVGInteraction.js`. Caught at build time. |
| FabricEditCanvas accidentally edited for snap (Pitfall 4) | LOW | Revert the FabricEditCanvas changes, rely on SVG-path snap only. `zoomGeneration` contract and Always Protected boundary are preserved. |
| PAL legacy rotation path accidentally edited (Pitfall 5) | LOW | Revert. The user-facing rotation flow is unaffected (v2.0+ routes through `useSVGInteraction.js`, not PAL). |
| Angle 360° persisted (Pitfall 7 — theoretical) | TRIVIAL | Add `% 360` to the snap expression. |

---

## Pitfall-to-Phase Mapping

Stage 0 is a single-phase milestone. Every pitfall is addressed in that one
phase — there is no downstream phase to defer to.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| P1: `const → let` | Stage 0 PLAN.md task wording | Vite HMR builds without error |
| P2: Mid-drag Shift | Stage 0 CONTEXT.md acceptance criterion | Manual smoke step 8 |
| P3: Companion zoom edit | Stage 0 PLAN.md single-task bundling | Manual smoke step 1 |
| P4: FabricEditCanvas scope creep | Stage 0 CONTEXT.md DO NOT CHANGE | Phase-discipline hook flags boundary violation |
| P5: PAL scope creep | Stage 0 CONTEXT.md DO NOT CHANGE | Phase-discipline hook flags boundary violation |
| P6: Handles at 10% | Stage 0 CONTEXT.md acceptance criterion (accepted) | RECONCILIATION.md carry-forward note |
| P7: 360° wrap (defensive) | Stage 0 PLAN.md or deferred | Optional — no active bug |
| P8: Pre-clamp restructure | Stage 0 PLAN.md literal-swap wording | Diff inspection |

---

## Relevance of Existing CLAUDE.md Gotchas

Re-reading the three CLAUDE.md gotchas in the light of Stage 0:

### Gotcha A — Canvas 2D vs SVG rasterizer differences at sub-pixel positions (2026-04-10)

**Relevant?** No. This gotcha applies to shape visual comparison between
FabricEditCanvas (Canvas 2D) and SVGAnnotationLayer during edit mode.
Stage 0 touches neither renderer and does not modify shape geometry. The
rotation snap produces clean `45°` values that are *less* likely to land
at sub-pixel boundaries than free rotation angles, so if anything this
feature marginally improves pixel alignment. Not a risk.

### Gotcha B — Fabric.js Textbox single-font requirement (2026-04-08)

**Relevant?** No. Stage 0 does not touch text rendering, font picking,
or Fabric Textbox/IText. Zero overlap.

### Gotcha C — Container-aware canvas sizing, not `pageSize * scale` (2026-03-22)

**Relevant?** Partially — as a **constraint**, not a risk.

- Stage 0 does not add any new canvas component, so the container-aware
  contract is not newly exercised.
- FabricEditCanvas already uses `parentEl.offsetWidth / pageWidth` at
  lines 595, 722, 1069, 1094, 1136, 1470, 1596 (confirmed by grep). At
  10% zoom this yields `effectiveScale ≈ 0.1`, which is a small-but-valid
  scalar. `canvas.setZoom(0.1)` is supported by Fabric.js 5.5.2 without
  special handling.
- `Math.ceil` guards on dimensions (`:1114-1115`) prevent zero-size
  canvases even for small shapes at small effective scales.
- **Verdict:** the gotcha's invariant (never compute from `pageSize *
  scale`) is already respected everywhere in the edit canvas, and
  lowering the zoom floor to 10% does not introduce any new code that
  could violate it.

**No CLAUDE.md gotcha becomes newly relevant at 10% zoom.**

---

## User-Visible Weirdness Watch List

Questions asked by the research prompt and their answers:

**Any existing UI element that assumes "zoom is at least 50%"?**
Swept. Answer: **No.** The pre-clamp at `App.jsx:21999` is the only place
that encoded 50 as a floor. There is no zoom slider (`<input type="range">`
for zoom does not exist in `src/`), no preset dropdown array
(`zoomStep|zoomPresets|zoomPercentages`), no hardcoded `50%` string in the
zoom UI. The zoom indicator (`App.jsx:26449-26476`) is a freeform text
input that displays `Math.round(scale * 100)` — at 0.1 it correctly
displays `10`. The `%` label at `App.jsx:26489` is static text.

**Any pending todos in STATE.md that would be masked or unmasked?**
Swept. Answer: **No.** The only STATE.md pending todo is the unified
selection-box-and-text-border styling concern (not rotation, not zoom).
None of the fixed bugs reference zoom floor or rotation snap. Nothing in
FEATURE-BACKLOG.md stages 1-9 has zoom-floor-dependent behavior.

**Zoom indicator displays correctly at 10%?**
Yes. `zoomInputValue = String(Math.round(normalized * 100))` at
`App.jsx:22004`. At `normalized=0.1`, displays `"10"`. Visible output:
`10%`. No truncation, no padding issue.

**Does pinch-to-zoom or scroll-wheel zoom have its own clamping that
ignores `MIN_SCALE`?**
Swept. Answer: **No.** Wheel zoom at `App.jsx:21579` calls
`clampScale(currentScale * deltaFactor)`. Pinch zoom routes through the
same `controller.setScale` path. Keyboard Cmd+- / Cmd+= routes through
`clampScale(basisScale / 1.2)` at `App.jsx:21544, 21552`. Fit-page routes
through `computeScaleForMode → clampScale` at `zoomController.js:83-97`.
Every zoom path is funneled through `clampScale`, so the single constant
change propagates universally.

**Does downstream code special-case the exact angle value (arrow
direction, callout knee, text baseline, etc.)?**
Swept. Answer: **No.**
- Arrow/line rendering at `svgAnnotationRenderers.jsx:155, 224` computes
  `atan2` from endpoint geometry (`x1,y1 → x2,y2`), NOT from `obj.angle`.
  Arrowhead direction is independent of the rotation snap.
- Text annotations rotate via `transform="rotate(angle, cx, cy)"`
  (`svgAnnotationRenderers.jsx:291, 336`) — works on any float, no
  baseline math.
- Callout geometry uses its own bezier/knee math in
  `src/components/Callout/` which operates on endpoint coordinates, not
  on `obj.angle`. (Callouts in FabricEditCanvas DO commit live angle per
  ARCHITECTURE.md Q1c, but callouts are not in Stage 0 scope — the
  rotation snap only fires in `useSVGInteraction.js`, and a callout being
  selected and rotated via the SVG mtr handle would use the same generic
  rotate branch without callout-specific geometry.)
- Undo/redo uses `JSON.parse(JSON.stringify(annotations))` deep-clone —
  value-agnostic.
- Supabase sync sends Fabric JSON verbatim — no angle normalization.
- `getCursorForHandle` at `svgTransformMath.js:108` already wraps angles
  via `(angleDegrees % 360 + 360) % 360` — tolerates any float, including
  theoretical 360.

**Fabric.js at very small canvas sizes:**
Fabric.js 5.5.2 has no documented minimum canvas dimension. Canvases
down to 1×1 are supported (setDimensions takes any positive integer).
Hit-test precision degrades at sub-pixel positions, but strokes rendered
with `vector-effect: non-scaling-stroke` (SVG display layer) keep their
authored thickness, and Fabric's canvas hit-testing in edit mode operates
in the canvas's internal scaled coordinate system, not in CSS pixels.
No known failure mode at small sizes that's relevant to Stage 0.

---

## Sources

All findings grounded in direct file reads during this research session:

- `src/utils/zoomController.js` (full file, 237 lines) — `MIN_SCALE`
  declaration and `clampScale` funnel
- `src/hooks/useSVGInteraction.js:391-408, 559-568` — rotate branch +
  commit path; existing `e.shiftKey` precedent at line 361 (resize
  aspect-lock)
- `src/utils/svgTransformMath.js:36-38, 72-76, 86-110` — `normalizeAngle`
  `[0, 360)` contract, `getInverseScale`, `getCursorForHandle`
- `src/utils/svgAnnotationRenderers.jsx:59-67, 116, 155, 224, 291, 336` —
  angle consumption via `transform="rotate(angle, ...)"` plus independent
  arrowhead `atan2` from endpoint geometry
- `src/components/SVGSelectionOverlay.jsx:46-58, 93, 180-200` — handle
  sizes multiplied by `inverseScale` keep constant screen size at any
  zoom
- `src/components/FabricEditCanvas.jsx:476-477, 595, 722, 752, 1036,
  1069, 1094, 1114-1115` — commit-lossy `json.angle` override,
  container-aware `effectiveScale`, `canvas.setZoom(effectiveScale)`,
  `Math.ceil` dimension guards
- `src/App.jsx:435` — existing `Math.max(0.1, ...)` floor on
  `measureSyncfusionPageHostScale`, proves 0.1 is already a supported
  low bound elsewhere in the codebase
- `src/App.jsx:449-451` — `normalizeInteractionMeasuredScale` sanity band
  `[0.55x, 1.8x]` is a ratio against `viewerScale`, not an absolute floor
- `src/App.jsx:21987-22008` — `commitZoomInput` pre-clamp at line 21999
- `src/App.jsx:21544, 21552, 21579, 22002` — every zoom-mutating path
  funnels through `clampScale`
- `src/App.jsx:26449-26489` — zoom input + `%` label (freeform text, no
  preset floor)
- `src/components/SyncfusionPDFContainer.jsx:29-33` — Syncfusion
  `coerceZoom` already clamps `[10, 1000]`, so 10% is supported upstream
- Grep for hardcoded `0.5` in `src/` — only `zoomController.js:15` is a
  zoom floor; other hits are CSS opacities, `PagesPanel` thumbnail
  scale, and `pdfAnnotationImporter` tolerance — all unrelated
- Grep for `Math.max(*, 50)` / `Math.min(*, 50)` — only
  `App.jsx:21999` and `App.jsx.backup:13232` (the backup file is not in
  the active bundle)
- Grep for `zoomStep|zoomPresets|zoomPercentages|50%` — zero preset
  arrays or hardcoded `50%` floors in the active zoom UI
- `CLAUDE.md` lines 41-55 — three existing gotchas, none become newly
  relevant at 10% zoom
- `.planning/STATE.md` pending todos — none relate to rotation or zoom
  floor
- `.planning/research/STACK.md`, `FEATURES.md`, `ARCHITECTURE.md` —
  cross-referenced for integration points and UX conventions

---

*Pitfalls research for: v2.1 Stage 0 Shape Edit Polish*
*Researched: 2026-04-12*
*Downstream consumer: Stage 0 phase CONTEXT.md acceptance criteria,
VALIDATION.md smoke coverage, PLAN.md watch-out section*
