# Phase 13: Rotation Handle Edit-Mode Polish - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Close out the rotation interaction story by fixing the two Phase 12 carry-forward gaps so the rotation handle and its typed-degree pill behave correctly across every edit-mode entry/exit transition on shapes selected in `SVGAnnotationLayer.jsx`. Two surgical SVG-side fixes — zero counter-session lane conflicts, zero new dependencies, zero architectural changes.

1. **EDIT-13** (Plan 13-01) — Rotation pill re-arms after ANY edit-mode exit path (click-off / Escape / Enter-commit) without the deselect/reselect workaround.
2. **EDIT-14** (Plan 13-02) — Rotation handle (mtr) stays fully visible when a pre-rotated shape (`angle ≠ 0`) enters edit mode. Visual-only during edit mode — handle does not need to be draggable (rotation interaction already provided by select-mode drag and the typed-degree pill).

Gap 2 (off-screen handle relocation) is explicitly **out of scope** — closed `wontfix_superseded_by_typed_input` per 2026-04-14 9-tool industry survey finding zero tools relocate rotation handles. Handle auto-scaling, rotation in Fabric edit mode, typed-value Shift-snap, and blur-commit for RotationInputField are all out of scope per v2.1 12-CONTEXT.md `<deferred>`.

</domain>

<decisions>
## Implementation Decisions

### EDIT-13 — Plan 13-01 — Hover pill stale-ref fix

**Strategy — LOCKED: Strategy B (event delegation)**

- Go **directly to Strategy B**, do NOT land Strategy A first.
- Rationale: Strategy A (add `editingAnnotationIndex` to dep array + `!= null` early-return gate) fixes the current symptom but leaves the listener re-attachment pattern fragile. Any future state that unmounts/remounts the mtr `<g>` re-triggers the same bug class. Strategy B eliminates it at the root by attaching ONE pair of listeners to a stable SVG ancestor and dispatching through `e.target.closest('[data-rotation-handle="mtr"]')`. ~15-25 LOC cost vs ~3 LOC for A is trivial for structural robustness.
- **Stable attachment target:** `svgRef.current` (the SVG root) — it persists across all selection / edit-mode / annotation changes within the page's lifetime.
- **Dispatch predicate:** `e.target.closest('[data-rotation-handle="mtr"]')` inside the pointerenter/pointerleave handlers — only fire the hover-intent logic when the event is on or inside the mtr handle element.
- **Edit-mode gate:** `if (editingAnnotationIndex != null) return;` at effect-top for safety — pill never arms while the user is mid-edit, and un-arms on edit entry.
- **Preserve load-bearing `eslint-disable react-hooks/exhaustive-deps`** at `SVGAnnotationLayer.jsx:312`. The effect dep array stays `[selectedIds, setRotInputVisibleDbg]` plus `[editingAnnotationIndex]`. NEVER add tick-rate values (`annotations`, `visualTransform`, `rotInputVisible`). This invariant is documented at `:306-312` — respect it.
- **Refs stay as closure-read sources:** `rotInputVisibleRef.current`, `rotInputHoveredRef.current`, `rotInputHoverTimerRef.current`, `rotInputCloseTimerRef.current`. Delegation does not change how timers/refs are read.
- **Delete the existing `handleEl` direct-attach path** at `SVGAnnotationLayer.jsx:232-297`. Replace with the delegated version on `svgRef.current`. The `querySelector('[data-rotation-handle="mtr"]')` fallback is no longer needed — delegation reaches the handle via bubbling regardless of mount/unmount.
- **Diagnostic console.log statements at `:215, :234, :238, :243, :247, :254, :263, :267, :280, :285, :289, :300`** — REMOVE all of them in the same commit that lands Strategy B. These were debugging aids from Phase 12 and clutter production logs.
- **Files in scope (13-01):** `src/components/SVGAnnotationLayer.jsx` ONLY. No other file touched by Plan 13-01.

### EDIT-14 — Plan 13-02 — mtr handle visibility fix

**Fix strategy — LOCKED: Fix A / Architecture Option C (SVG-side structural fix)**

- Narrow the `SVGAnnotationLayer.jsx:1050` short-circuit so it returns null ONLY when `editIsBorderFlush && angle === 0`. Pre-rotated border-flush shapes (rect/text with `angle !== 0`) no longer short-circuit to null — they render a stripped SVG overlay.
- New rendering branch: `editIsBorderFlush && angle !== 0 && !editIsCounter` → render an **mtr-only SVG overlay** (no dashed bbox, no 8 resize pills, no rotation pill wiring). Only the rotation handle group is rendered, so the user sees the handle visually even though `pointerEvents: 'none'` makes it non-interactive during edit mode (SVG root uses `isInteractive=false` gating).
- **Counter is NOT affected** — the `editIsCounter` case retains its current short-circuit (counter has its own nubbin rotation handle branch at `:1052-1099`, unrelated to Gap 4).
- **SVGSelectionOverlay.jsx gets a new `isEditing` prop** that controls a conditional render branch:
  - `isEditing === false` → current rendering (full bbox + 8 resize handles + mtr)
  - `isEditing === true` → mtr-only render path (no bbox, no resize pills, just the rotation handle group)
- Both branches share the same `data-rotation-handle="mtr"` attribute so the Plan 13-01 event delegation continues to reach the handle in edit mode too.
- The mtr handle in edit mode is **visual-only** — SVG root carries `pointerEvents: 'none'` when `isInteractive=false`. Rotation interaction in edit mode stays OUT of scope (PROJECT.md line 71). The goal is "user sees the handle without clipping," nothing more.

**Mandatory first-wave step: live-DOM diagnostic**

- **Why:** Architecture research says the clipper is likely a Syncfusion `e-pv-page-div` ancestor. Pitfalls research says the clipper is likely the Fabric canvas pixel buffer (`BBOX_PADDING=32` minus Fabric `rotatingPointOffset=40` = mtr at `y=-8`, outside drawable surface). Both may contribute. Fix A only works if SVG-side rendering bypasses the clipper entirely — if the Syncfusion ancestor clips SVG *too*, Fix A alone is insufficient.
- **How — DevTools paste script (decided):**
  - One-off diagnostic, NOT committed to source. User opens dev server, selects a pre-rotated shape (`angle=30`), double-clicks into edit mode, pastes the script into DevTools Console, copies the output back to me.
  - Script output I'll author: walks ancestor chain from `document.querySelector('[data-fabric-edit-container]')` (or the FabricEditCanvas container) up through `body`, for each link reads `tagName`, `className`, `getBoundingClientRect()`, `window.getComputedStyle(el).overflow/overflowX/overflowY/clipPath/contain`, and compares against the mtr handle's screen-space position (read from the SVG element with `[data-rotation-handle="mtr"]`).
  - Output identifies any ancestor whose `rect.top > mtrHandleRect.top` AND has `overflow: hidden|clip|scroll`. That ancestor is the clipper.
- **Decision gate based on diagnostic result:**
  - **Clipper is Syncfusion `e-pv-page-div` or higher ancestor:** Fix A still works because SVG layer is a CHILD of the Syncfusion page div — SVG can render outside the Fabric canvas pixel buffer but is still clipped by the page div. If the page div clips the mtr position even with SVG rendering, we need a different approach — ESCALATE to user with findings + options.
  - **Clipper is the Fabric canvas pixel buffer ONLY (no Syncfusion ancestor clipping):** Fix A works cleanly — SVG renders outside the canvas, page div isn't clipping it. Proceed.
  - **Clipper is both (canvas + Syncfusion):** Fix A partially works — SVG escapes the canvas but is still cut by the page div. ESCALATE to user with findings + need for counter-session coordination to unblock Fabric-side `BBOX_PADDING` increase.

**Fallback strategy — stop and escalate (not auto-pivot to Fix B)**

- If Fix A is insufficient based on diagnostic results, **STOP** and report findings to user with: diagnostic output, which clipper owns the symptom, Fix A's remaining coverage, and Fix B scope + counter-session lane impact estimate.
- Do NOT unilaterally pivot to Fabric-side fixes (`controlsAboveOverlay`, custom mtr Control with `offsetY: -20`, BBOX_PADDING bump). Those land in `FabricEditCanvas.jsx` which is held by counter-session. Any touch requires explicit user authorization AND counter-session coordination.
- Do NOT unilaterally pause Phase 13. The user decides whether to pause, escalate, or ship the partial Fix A.
- This keeps the decision in user hands rather than letting Claude make a lane-conflict call.

**Files in scope (13-02):**
- `src/components/SVGAnnotationLayer.jsx` — narrow `:1050` short-circuit condition only (never delete the short-circuit entirely — doubles handles). Expected ~2-5 LOC change.
- `src/components/SVGSelectionOverlay.jsx` — new `isEditing` prop + conditional render branch for mtr-only path. Expected ~30-60 LOC addition.

### Shared — Both plans

**Commit boundary — one atomic commit per plan**

- Plan 13-01 ships as ONE commit: `fix(13-01): EDIT-13 hover pill re-arms via event delegation`
- Plan 13-02 ships as ONE commit: `fix(13-02): EDIT-14 mtr handle visible on pre-rotated edit entry`
- Rationale: each plan is a single atomic fix + its own test pass. Splitting adds PR/reconciliation overhead without rollback value — if EDIT-14 regresses, we revert Plan 13-02's commit whole.
- The 13-02 diagnostic is NOT a committed artifact — it's run once as a DevTools paste, outputs copied into the plan's workspace notes, discarded after the clipper is identified.

**Test additions — no new unit tests, rely on UAT + baseline**

- Phase 13 does NOT add unit tests. Rationale: both fixes are integration-level (DOM event delegation + SVG render branch) and the existing 113-test baseline + manual UAT grid catch regressions. Adding jsdom unit tests for event delegation requires a jsdom-compatible SVG ancestor mock that the current test harness doesn't provide — the test infrastructure cost exceeds the regression protection benefit for a 2-plan surgical phase.
- Regression shield: run the full 113-test Playwright sweep after BOTH plans land (not between plans). Targeted smoke on Plan 12-02's 7 focus-loss scenarios (RotationInputField focus on Tab, click-out, Arrow nudge, Enter commit, hover during drag, Shift modifier, blur) after Plan 13-01 lands.
- `console.count` probe on the hover-intent effect body during a 2-second drag-rotate MUST fire ≤3 times (the optimistic-paint pattern invariant from Plan 12-03).

**UAT grid — stick to Success Criteria exactly**

- EDIT-13 grid: `{rect, circle, ellipse, text} × {angle=0, angle=30} × {exit via click-off, exit via Escape, exit via Enter-commit}` = **24 cells**. Each cell verifies: hover mtr → pill appears within 150ms → no deselect/reselect needed.
- EDIT-14 grid: `{rect, circle, ellipse, text} × {angle=0, angle=30}` = **8 cells**. Each cell verifies: double-click → edit mode entered → full mtr handle visible (circle + connector + icon) with no clipping.
- Do NOT expand to line/arrow (EDIT-13) or additional angles (90/135/180) or pen/eraser tools. Rotation path is angle-invariant; tool type is orthogonal to hover-intent bug. Expansion diffuses focus without new coverage.

### Claude's Discretion

- Exact delegation handler structure (single `onPointerOver` + `onPointerOut` on svgRef with closest-check vs separate pointerenter/pointerleave — pointerenter/pointerleave do NOT bubble so delegation must use the non-bubbling workaround pattern or switch to pointerover/pointerout).
- Whether the mtr-only render branch in `SVGSelectionOverlay.jsx` is an early-return new function or a conditional inside the existing component body — whichever produces cleaner diff.
- Exact diagnostic script formatting (compact table vs verbose object log) — whatever produces the most readable paste-back output.
- Whether the diagnostic script needs to be authored upfront in the plan or written at the start of the first diagnostic wave (first wave is fine — the script is trivial).
- Order of 13-01 vs 13-02 execution — research recommends 13-01 first. Honor that, but if a blocker surfaces in 13-01, pivot to 13-02 and come back.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v2.2 requirements
- `.planning/REQUIREMENTS.md` — EDIT-13 (hover pill re-arm), EDIT-14 (mtr visibility on pre-rotated edit entry), Out of Scope table
- `.planning/ROADMAP.md` §"Phase 13: Rotation Handle Edit-Mode Polish" — goal, dependency on Phase 12, Success Criteria (4 items), plan breakdown
- `.planning/PROJECT.md` — v2.2 milestone goal, Stage 0 scope boundary, Gap 2 closure rationale

### v2.2 research (directly informs planning — all HIGH confidence)
- `.planning/research/SUMMARY.md` — executive summary, Synthesizer Verdicts (Gap 3 Strategy B preferred, Gap 4 Fix A / Architecture Option C, Gap 2 default defer), critical pitfalls list, counter-session lane matrix
- `.planning/research/ARCHITECTURE.md` — Fix A / Architecture Option C rationale, exact file:line integration points, SVG-side structural fix reasoning
- `.planning/research/PITFALLS.md` — Gap 4 `overflow: hidden` wild-goose-chase warning, BBOX_PADDING=32 vs rotatingPointOffset=40 math, dep-array expansion warning, SVG short-circuit deletion warning, counter-session staging accident warning, Gap 2 scope creep warning
- `.planning/research/FEATURES.md` — 9-tool industry survey (Figma, tldraw, Excalidraw, Miro, Illustrator, Sketch, Inkscape, Nutrient, PSPDFKit) justifying Gap 2 deferral
- `.planning/research/STACK.md` — zero new dependencies confirmation

### Prior phase context (patterns + carry-forward)
- `.planning/phases/12-shape-edit-polish/12-CONTEXT.md` — EDIT-12 hover-intent architecture, 150ms open / 500ms close windows, load-bearing `eslint-disable` invariant, activeElement guard, pill positioning, uncontrolled input decision
- `.planning/phases/12-shape-edit-polish/12-VERIFICATION.md` — Plan 12-02 7-round focus-loss scenarios, Gap 3 + Gap 4 carry-forward documentation, `human_decision` audit trail
- `.planning/phases/11-text-shape-editing-zoom-cleanup/11-CONTEXT.md` — FabricEditCanvas component architecture, zoomGeneration signal contract, edit mode entry/exit flow
- `.planning/phases/09-svg-selection-interaction/09-CONTEXT.md` — SVG selection patterns, SVGSelectionOverlay structure, inverseScale handle sizing, useSVGInteraction lifecycle

### Project-level discipline
- `CLAUDE.md` §"Always Protected" — project-wide DO NOT CHANGE list (App.jsx, PAL, FabricDrawing/Eraser/EditCanvas, SVGAnnotationLayer [JS zoom coordination ban], package.json, vite.config.js)
- `CLAUDE.md` §"Gotchas" — Canvas 2D vs SVG rasterizer mathematical confirmation (2026-04-10), Fabric font fallback stack rule, container-aware sizing rule
- `.planning/STATE.md` — v2.2 accumulated decisions, counter-session 7-file WIP allowlist, Phase 13 strategy locks
- `.planning/MILESTONES.md` — v2.1 close DONE_WITH_CONCERNS, Gaps 3+4 deferred to v2.2

### Exact integration points (verified, file:line)
- `src/components/SVGAnnotationLayer.jsx:213-313` — hover-intent `useEffect` (EDIT-13 Plan 13-01 target). Current direct-attach pattern at `:232-297` gets replaced with delegation on `svgRef.current`. `eslint-disable` at `:312` STAYS.
- `src/components/SVGAnnotationLayer.jsx:1050` — `isBeingEditedNow && (editIsBorderFlush || editIsCounter)` short-circuit (EDIT-14 Plan 13-02 target). Narrow the border-flush branch to `editIsBorderFlush && angle === 0`; counter branch untouched.
- `src/components/SVGSelectionOverlay.jsx` — target for new `isEditing` prop + mtr-only render path. Existing rendering logic (215 LOC) stays as the `isEditing=false` branch.
- `src/components/SVGAnnotationLayer.jsx:215, 234, 238, 243, 247, 254, 263, 267, 280, 285, 289, 300` — Phase 12 debug console.log statements to REMOVE in Plan 13-01's commit.

### Counter-session lane (DO NOT STAGE)
- `src/App.jsx` · `src/components/PageAnnotationLayer.jsx` · `src/components/FabricEditCanvas.jsx` · `src/hooks/useDatabase.js` · `src/utils/counterNumbering.js` · `src/utils/svgAnnotationRenderers.jsx` · `dist/index.html` — 7-file counter-session WIP allowlist. Run `git status` before EVERY commit. NEVER `git add -A` or `git add .`. Explicit path staging only.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`svgRef.current` (SVG root ref in SVGAnnotationLayer.jsx)** — stable across all selection / edit / annotation changes within the page lifetime. Plan 13-01 attaches delegated pointerenter/pointerleave (via `pointerover`/`pointerout` if non-bubbling pointerenter is a blocker) to this ref, eliminating the querySelector-find-and-attach pattern that's currently fragile.
- **`data-rotation-handle="mtr"` attribute** — already present on the mtr handle `<g>` element from Phase 12 Plan 02 Task 2 (per comment at `:210`). Plan 13-01 reuses it as the delegation target via `e.target.closest('[data-rotation-handle="mtr"]')`. Plan 13-02's mtr-only render branch in SVGSelectionOverlay MUST preserve this attribute so the delegation continues to reach the handle during edit mode.
- **`rotInputVisibleRef`, `rotInputHoveredRef`, `rotInputHoverTimerRef`, `rotInputCloseTimerRef`** — existing refs-as-mutable-state pattern from Phase 12. Plan 13-01 keeps all four refs as-is; delegation only changes HOW listeners are attached, not how the refs are read inside closures.
- **`activeElement` guard on grace timer expiry** — load-bearing fix from Phase 12 Plan 02 Round 7 (`SVGAnnotationLayer.jsx:282-290`). Checks `document.activeElement?.closest('[data-rotation-input-field]')` to keep the pill visible while the input has focus. Plan 13-01 preserves this invariant — do not remove the activeElement check during delegation rewrite.
- **`editingAnnotationIndex` parent prop** — already wired into SVGAnnotationLayer from the parent (used in the `:1049` `isBeingEditedNow` check). Plan 13-01 reads it at effect-top for the edit-mode gate; Plan 13-02 uses it to drive the `isEditing` prop into SVGSelectionOverlay.
- **Optimistic-paint pattern from Plan 12-03** — documented inline with `SIDE EFFECT` + `drag-wins invariant` JSDoc grep markers. NOT touched by Phase 13 but MUST still function — the `console.count` probe on the hover-intent effect body during a 2-second drag-rotate verifies ≤3 re-runs (never 60fps).

### Established Patterns

- **`eslint-disable react-hooks/exhaustive-deps` at `:312`** is LOAD-BEARING. Plan 13-01 MUST preserve it. Dep array stays minimal `[selectedIds, setRotInputVisibleDbg, editingAnnotationIndex]`. NEVER add `annotations`, `visualTransform`, `rotInputVisible`.
- **Refs-as-mutable-state pattern** — read ref `.current` inside effect closures, not deps. Established across hover-intent logic, pill positioning, drag-wins rule. Plan 13-01 extends this pattern to the delegation predicate (no ref-reads inside the predicate change).
- **`inverseScale` handle sizing** — SVG handles multiply by `inverseScale` for constant screen size at any zoom. Plan 13-02's mtr-only render branch inherits this from `SVGSelectionOverlay.jsx`'s existing mtr group — no new sizing math.
- **Per-plan one-atomic-commit** — established in Phase 11 (zoom cleanup), continued in Phase 12 (Plan 12-01 / 12-02 / 12-03 each landed as one commit). Phase 13 follows the same pattern.
- **Counter-session lane discipline** — established through Phase 12. `git status` cross-check before every commit. Explicit-path staging only. The 7-file allowlist is a HARD boundary.

### Integration Points

- **Plan 13-01 touches exactly ONE file:** `src/components/SVGAnnotationLayer.jsx`. No other file modified, no new file created. ~15-25 LOC net change (delegation replacement + debug log removal).
- **Plan 13-02 touches exactly TWO files:** `src/components/SVGAnnotationLayer.jsx` (narrow `:1050` condition, ~2-5 LOC) + `src/components/SVGSelectionOverlay.jsx` (new `isEditing` prop + mtr-only branch, ~30-60 LOC).
- **Zero files from the counter-session allowlist are touched by either plan.** Fix A was chosen specifically for this property.
- **Parent wiring (App.jsx or PAL) is NOT touched.** Both plans stay inside the SVG component tree. `editingAnnotationIndex` is already a prop — Plan 13-02 just threads it into SVGSelectionOverlay via the new `isEditing` prop (flipping on `editingAnnotationIndex != null`).
- **No data model changes.** Same Fabric.js JSON, same `obj.angle`, same `obj.data.pointerAngle` for counters, same selection state shape.

</code_context>

<specifics>
## Specific Ideas

- **User-facing mental model for EDIT-13:** "When I finish editing a shape and click off, I should be able to hover the rotation handle right away and see the degree pill — I shouldn't have to deselect and reselect."
- **User-facing mental model for EDIT-14:** "When I double-click into a rotated shape's edit mode, the rotation handle should still be visible like it was before I entered edit mode. It doesn't need to be draggable in edit mode — I can rotate from select mode or by typing a degree — but I should still see it."
- **Visual reference:** The existing select-mode mtr handle rendering (`SVGSelectionOverlay.jsx` mtr group ~`:175-202`) is the visual target for Plan 13-02's edit-mode branch — same circle, connector, icon, just rendered without the surrounding bbox + resize pills.
- **Diagnostic output format:** Compact table — one row per ancestor, columns `[depth, tagName, className, rect.top, rect.left, rect.width, rect.height, overflow, clipPath]`. Flags rows where `rect.top > mtrHandleRect.top && overflow !== 'visible'`. One-shot paste into DevTools Console, output copied back as a code block.
- **Target user persona (unchanged from v2.1):** Mechanical/electrical engineers stamping shapes on blueprints. Rotation intuition is 0°/45°/90°. Expects precise rotation interaction at all zoom levels down to 10%.

</specifics>

<acceptance_criteria>
## Acceptance Criteria

**Given/When/Then bullets per CLAUDE.md phase discipline. Each independently verifiable by human UAT.**

### EDIT-13 — Pill re-arms after every edit-mode exit path

- **Given** a `rect` annotation is selected and the user double-clicks into edit mode, **when** they click outside the edit bbox (exit via click-off) and then hover the rotation handle, **then** the typed-degree pill appears within the 150ms hover-intent window WITHOUT a deselect/reselect step. Verified at `angle=0` AND `angle=30`.
- **Given** a `circle` annotation is selected and the user double-clicks into edit mode, **when** they press Escape (exit via Escape) and then hover the rotation handle, **then** the pill appears within 150ms without deselect/reselect. Verified at `angle=0` AND `angle=30`.
- **Given** an `ellipse` annotation is selected and the user double-clicks into edit mode, **when** they press Enter to commit (exit via Enter-commit) and then hover the rotation handle, **then** the pill appears within 150ms without deselect/reselect. Verified at `angle=0` AND `angle=30`.
- **Given** a `text` annotation is selected and the user double-clicks into edit mode, **when** they exit via any of the three paths (click-off / Escape / Enter-commit) and then hover the rotation handle, **then** the pill appears within 150ms without deselect/reselect. Verified at `angle=0` AND `angle=30`.
- **Given** the hover-intent effect runs during a 2-second drag-rotate, **when** `console.count` is attached to the effect body, **then** the count fires ≤3 times (optimistic-paint pattern preserved, never 60fps).
- **Given** the user is actively in edit mode on an annotation, **when** they hover the mtr handle while still editing, **then** the pill does NOT arm (edit-mode gate at effect-top).

### EDIT-14 — mtr handle visible on edit-mode entry for pre-rotated shapes

- **Given** a `rect` annotation with `angle=30`, **when** the user double-clicks to enter edit mode, **then** the full rotation handle (circle + connector + icon) is visible with no clipping by any container or page-div ancestor.
- **Given** a `circle` annotation with `angle=30`, **when** the user double-clicks to enter edit mode, **then** the full rotation handle is visible with no clipping.
- **Given** an `ellipse` annotation with `angle=30`, **when** the user double-clicks to enter edit mode, **then** the full rotation handle is visible with no clipping.
- **Given** a `text` annotation with `angle=30`, **when** the user double-clicks to enter edit mode, **then** the full rotation handle is visible with no clipping.
- **Given** a `rect` annotation with `angle=0` (border-flush baseline case), **when** the user double-clicks to enter edit mode, **then** the SVG selection chrome short-circuits to null as before — NO mtr handle, NO bbox, NO resize pills (border-flush clean edit surface preserved).
- **Given** a pre-rotated shape is in edit mode and the user hovers the mtr handle, **when** the SVG root has `pointerEvents: 'none'` (because `isInteractive=false` during edit), **then** the handle is visible but NOT interactive — no pill arms, no drag works, hover does nothing. This is intentional (visual-only per PROJECT.md line 71).
- **Given** a `counter` annotation is selected and the user double-clicks to enter edit mode, **when** edit mode is entered, **then** the counter's existing nubbin rotation handle branch at `SVGAnnotationLayer.jsx:1052-1099` is unchanged — counter path was NOT modified by Plan 13-02.

### No regressions to v2.1 baseline

- **Given** all 113 Playwright tests green at v2.1 close (commit `df43b0f8` or later), **when** Phase 13 plans land, **then** all 113 tests still green.
- **Given** Plan 12-02's 7 focus-loss scenarios (RotationInputField focus on Tab, click-out, Arrow nudge, Enter commit, hover during drag, Shift modifier, blur), **when** Phase 13 plans land, **then** all 7 still pass.
- **Given** a rotation drag is in progress for 2 seconds, **when** `console.count` is attached to the hover-intent effect body, **then** the count fires ≤3 times — optimistic-paint pattern preserved, never 60fps.
- **Given** the hover-intent effect's `eslint-disable react-hooks/exhaustive-deps` comment at `SVGAnnotationLayer.jsx:312`, **when** ESLint runs, **then** no exhaustive-deps warning fires (the disable is still needed; the dep array stays minimal).
- **Given** the RotationInputField pill arms via delegated pointerenter on `svgRef.current`, **when** a selection change unmounts/remounts the mtr `<g>` mid-session, **then** the pill still arms on next hover (no listener re-attachment needed — delegation is permanent on the stable SVG ancestor).
- **Given** the `activeElement?.closest('[data-rotation-input-field]')` guard on the grace timer (`SVGAnnotationLayer.jsx:282-290`), **when** Plan 13-01's delegation rewrite lands, **then** the guard is still present and still load-bearing — removing it regresses Plan 12-02 Round 7.

### Counter-session lane stays untouched

- **Given** the 7-file counter-session WIP allowlist (`App.jsx`, `PageAnnotationLayer.jsx`, `FabricEditCanvas.jsx`, `useDatabase.js`, `counterNumbering.js`, `svgAnnotationRenderers.jsx`, `dist/index.html`), **when** Phase 13's final commits are inspected via `git show --stat`, **then** ZERO files from that allowlist appear in any Phase 13 diff.
- **Given** `git status` is run immediately before every Phase 13 commit, **when** the output is inspected, **then** no counter-session file appears as staged. If one does, `git reset HEAD <file>` before committing.
- **Given** the user instructs staging via explicit paths only, **when** any Phase 13 commit is authored, **then** `git add .` and `git add -A` are NEVER used. Only explicit paths like `git add src/components/SVGAnnotationLayer.jsx` or the `--files` argument to the GSD commit tool.

</acceptance_criteria>

<do_not_change>
## DO NOT CHANGE

**Files OUT of scope for Phase 13. Touching any of these is a boundary violation and requires an explicit user waiver.**

### Always Protected (CLAUDE.md project-wide)

- `src/App.jsx` — ~1.3MB main file, zoom logic, portal host resolution, render loop. **NO carve-out for Phase 13.** Every line of App.jsx is Always Protected for v2.2. Plan 13-02's `editingAnnotationIndex` prop is already wired — no App.jsx change needed.
- `src/components/PageAnnotationLayer.jsx` — ~9,858-line Fabric.js canvas overlay. **COUNTER-SESSION WIP lane.** Out of scope entirely.
- `src/PageAnnotationLayer.jsx` — thin region-polygon wrapper. Unrelated to rotation.
- `src/components/FabricDrawingCanvas.jsx` — pen/highlighter Canvas. Uses `zoomGeneration` contract, unrelated.
- `src/components/FabricEraserCanvas.jsx` — eraser Canvas. Uses `zoomGeneration` contract, unrelated.
- `src/components/FabricEditCanvas.jsx` — **COUNTER-SESSION WIP lane.** Phase 13 was explicitly designed with Fix A / Option C to avoid this file. Fabric-side fallbacks (`controlsAboveOverlay`, custom mtr Control with `offsetY: -20`, `BBOX_PADDING` increase) are NOT authorized for Phase 13. If Fix A is insufficient, STOP and escalate to user — do not self-pivot.
- `package.json` / `vite.config.js` — infra. Zero new dependencies for Phase 13.

### Counter-session WIP allowlist (NEVER stage from v2.2 without explicit coordination)

- `src/App.jsx`
- `src/components/PageAnnotationLayer.jsx`
- `src/components/FabricEditCanvas.jsx`
- `src/hooks/useDatabase.js`
- `src/utils/counterNumbering.js`
- `src/utils/svgAnnotationRenderers.jsx`
- `dist/index.html`

Run `git status` before every Phase 13 commit. Never use `git add -A` or `git add .`. Explicit-path staging only.

### Phase-specific DO NOT CHANGE

- `src/hooks/useSVGInteraction.js` — selection + drag + rotation lifecycle hook. Phase 13 does NOT modify rotation semantics; it only rewrites hover listener attachment. The rotate branch at `:391-408` and commit branch at `:559-568` STAY.
- `src/utils/svgTransformMath.js` — pure math helpers (`normalizeAngle`, `getInverseScale`, `getCursorForHandle`). Phase 13 does NOT modify these.
- `src/utils/zoomController.js` — v2.1 ZOOM-09 landed here. Phase 13 does NOT modify the zoom floor or `clampScale`.
- `src/components/RotationInputField.jsx` — v2.1 EDIT-12 landed here. Phase 13 does NOT modify the portaled input component itself. Plan 13-01 fixes the LISTENERS that drive the pill's visibility — the pill's render logic is unchanged.
- `src/utils/rotationInputHelpers.js` — pill-positioning helpers. Phase 13 does NOT modify these (Gap 2 pill-clamp extension is out of scope).
- `src/components/Callout/*` — callout subsystem. Unrelated.
- `src/components/SyncfusionPDFContainer.jsx` — viewer layer. Unrelated.
- `src/components/LightweightAnnotationOverlay.jsx` — legacy overlay, not touched in v2.0+.
- `src/contexts/*`, `src/sidebar/*` — unrelated subsystems.

### Counter-specific guards (from existing `[COUNTER WIP — DO NOT TOUCH]` comment at `SVGAnnotationLayer.jsx:1044-1047`)

- `editIsCounter` branch at `SVGAnnotationLayer.jsx:1052-1099` — counter select-mode rotation handle and hover-outline path are mid-debug as of 2026-04-14 in another session. Plan 13-02's `editIsBorderFlush && angle === 0` narrowing MUST preserve the counter branch untouched. Do NOT merge counter logic into the new edit-mode branch.

### In-scope (edit allowed)

- `src/components/SVGAnnotationLayer.jsx` — Plan 13-01 (hover-intent effect delegation rewrite, lines `:213-313`, ~15-25 LOC net) + Plan 13-02 (narrow `:1050` short-circuit, ~2-5 LOC).
- `src/components/SVGSelectionOverlay.jsx` — Plan 13-02 only (new `isEditing` prop + mtr-only render branch, ~30-60 LOC).

</do_not_change>

<deferred>
## Deferred Ideas

**Captured so they're not lost. Explicitly out of scope for Phase 13.**

- **Gap 2 — Off-screen handle relocation** — Closed `wontfix_superseded_by_typed_input` per 2026-04-14 9-tool industry survey. Zero tools relocate rotation handles; v2.1 typed-degree pill addresses ~95% of underlying pain. If users complain in the field after v2.2 ships, reconsider via a new phase scoped strictly to `rotationInputHelpers.js` pill-clamp verification — NOT handle movement.
- **Fabric-side Gap 4 fixes** — `controlsAboveOverlay`, custom mtr Control with `offsetY: -20`, `BBOX_PADDING` increase. All land in `FabricEditCanvas.jsx` (counter-session lane). Deferred as fallbacks only if Plan 13-02's live-DOM diagnostic proves SVG-side Fix A is insufficient AND user authorizes counter-session coordination.
- **Rotation interaction in Fabric edit mode** — Commit-lossy on force-zero/restore cycle. Users have two existing rotation paths (select-mode drag + typed-degree pill); edit mode doesn't need a third. Defer until a user complains.
- **Typed-value Shift-snap in RotationInputField** — v2.1 locked: typing 44 with Shift held commits 44°. Snap is drag-only.
- **Blur-commit and invalid-value revert for RotationInputField** — v2.1 user-descoped.
- **SVG select-mode flip for line/arrow/path/text** — v2.1 only supports rect/circle/ellipse flip; per-type flip semantics out of scope.
- **Widen zoom range beyond 500% ceiling (PERF-02)** — v2.1 shipped 10% floor; 500%+ ceiling deferred to a future milestone.
- **Selection box handles sit directly on text border, not offset outside it** — v2.0 cleanup carryover. Unrelated to rotation. Belongs in a separate UX polish phase.
- **Configurable snap increment (15°/22.5°/45°/90°)** — Would require a Preferences surface that doesn't exist. Defer to v2.3+ Preferences → Annotations tab.
- **Handle auto-scaling at low zoom** — v2.1 ships Illustrator/Photoshop model (handles stack, user zooms back in). If users complain, add Figma-style hide-below-threshold in v2.3+ (~20-40 LOC in SVGAnnotationLayer).
- **Snap indicator animation (tick flash, highlight on snap)** — Anti-feature. No surveyed annotation tool ships this. Do not build.
- **Shift-snap on the FabricEditCanvas shape rotation preview** — Would require first fixing commit-lossy `json.angle` override. Defer until user complains.
- **Shift-snap on the PAL legacy Pan+modifier rotate path** — Dead code in v2.0+. Should be deleted, not upgraded. Defer as tech debt cleanup.
- **Cmd+Arrow annotation nudging** — Movement shortcut, not rotation. Belongs in a future keyboard-shortcut phase.

</deferred>

---

*Phase: 13-rotation-handle-edit-mode-polish*
*Context gathered: 2026-04-14*
*Research informed by: .planning/research/ (SUMMARY.md, ARCHITECTURE.md, PITFALLS.md, FEATURES.md, STACK.md) + .planning/phases/12-shape-edit-polish/12-CONTEXT.md + .planning/STATE.md v2.2 decision log*
*Tactical decisions made under user delegation ("Honestly, I trust you on all this. You do what you think is best."): Strategy B direct for 13-01, DevTools paste diagnostic for 13-02, stop-and-escalate fallback, exact UAT grid, no new unit tests, one-atomic-commit-per-plan.*
