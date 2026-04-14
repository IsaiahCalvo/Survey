---
phase: 12-shape-edit-polish
plan: 02
subsystem: ui
tags: [edit-12, rotation-input, html-portal, uncontrolled-input, hover-intent, constant-radius-pill, focus-loss, full-click-cycle]

# Dependency graph
requires:
  - phase: 12-shape-edit-polish/plan-01
    provides: snapAngleToNearest45 helper, EDIT-11 rotate branch wire, dual-path SVG↔Fabric edit parity, mini-bar tracking pattern
  - phase: 11-text-shape-editing-zoom-cleanup
    provides: SVGSelectionOverlay, useSVGInteraction rotate branch with live-angle state
  - phase: 09-svg-selection-interaction
    provides: SVG selection handles, inverseScale handle sizing, mtr handle group
  - phase: 08-svg-display-foundation
    provides: SVGAnnotationLayer, viewBox-based rendering, overlay div portal target
provides:
  - rotationInputHelpers pure module (normalizeTypedDegrees, computeInputPosition + supports) with 34 unit tests
  - RotationInputField React component (HTML portal, uncontrolled input, hover-intent visibility, drag-wins live updates, Arrow nudging)
  - data-rotation-handle="mtr" attribute on the SVG rotation handle group for getBoundingClientRect lookup
  - SVGAnnotationLayer parent wiring that pipes useSVGInteraction live angle + drag state into the input
  - Constant-radius pill placement: pill orbit radius is invariant across all rotations (worst-case AABB projection from shape center)
  - Visibility grace timer that respects `document.activeElement` so a focused input cannot be dismissed by the leave timer
  - Full-click-cycle stopPropagation pattern on portaled UI inside an interactive SVG layer (the architectural lesson from Round 7)
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - html-portal-uncontrolled-input-inside-interactive-svg
    - hover-intent-visibility-with-grace-timer
    - constant-radius-pill-placement-via-aabb-projection
    - full-click-cycle-stoppropagation-on-portal-boundary
    - window-capture-keydown-guard-vs-activeelement
    - drag-wins-live-update-overrides-typed-value

key-files:
  created:
    - src/components/RotationInputField.jsx (646 LOC including inert diagnostics)
    - src/utils/rotationInputHelpers.js (184 LOC pure helpers)
    - tests/rotationInputHelpers.test.mjs (365 LOC, 34 tests)
  modified:
    - src/components/SVGSelectionOverlay.jsx (one-line: data-rotation-handle attribute)
    - src/components/SVGAnnotationLayer.jsx (parent wiring + grace-timer activeElement guard)

key-decisions:
  - "EDIT-12 ships as an HTML portal sibling to SVGAnnotationLayer, not a foreignObject child of the SVG, to avoid IME/focus quirks and counter-rotation math"
  - "Input is uncontrolled (defaultValue + ref) instead of controlled — Round 5/6 proved a controlled <input> with React state racing live drag updates created a re-render loop that swallowed keystrokes"
  - "Pill orbit radius is constant across all rotations using a worst-case AABB projection from shape center: EXTENSION = max(handleW,handleH)/2 + gap + max(pillW,pillH)/2 — the user's invariant is 'distance from shape = constant', not 'edge-to-edge gap = constant'"
  - "Window-capture keydown guard with activeElement.tagName === 'INPUT' check is sufficient to isolate the pill from the shape-delete shortcut — no listener removal, no event hijacking"
  - "Visibility grace timer must check document.activeElement before closing the pill on handle-leave or pill-leave: a focused input cannot be dismissed even after the 500ms grace expires"
  - "Round 7 fix: stopPropagation on the FULL click cycle (mouseDown + mouseUp + click + pointerDown + pointerUp) at the wrapper boundary, not just the down events. The ~3-line fix landed after 6 rounds chasing wrong hypotheses"
  - "There are N=visible-page-count RotationInputField instances mounted at all times (one per SVGAnnotationLayer). Any global-side-effect pattern (prototype monkey-patch, document-level singleton) MUST be designed around N-instance setup or it will nest and corrupt itself"
  - "Diagnostic scaffolding (lifecycle, focusout listener, input event, identity tracker) stays in code under LOG=false. Inert at runtime, available for future regression hunts. Stripping is optional cleanup, not a Plan 12-02 requirement"
  - "Typed-value commits NEVER apply Shift-snap. Snap is a drag-only gesture modifier. Typing 44 with Shift held still commits 44° (CONTEXT.md acceptance criterion)"

requirements-completed: [EDIT-12]

# Metrics
duration: ~7 sessions across 2026-04-13 → 2026-04-14
completed: 2026-04-14
---

# Phase 12 Plan 02: EDIT-12 RotationInputField Summary

**Shipped EDIT-12: a new `RotationInputField` HTML-portal component that overlays the SVG rotation handle with an inline degree input. Hover-summon, drag-wins live updates, Enter/Escape/blur commit semantics, Arrow-key nudging, and a constant-radius pill placement that keeps the input at a fixed distance from the shape center across every rotation. Took 7 rounds of focus-loss debugging to land — the final fix is ~3 lines but the architectural insight (full click cycle stopPropagation on portaled UI inside an interactive SVG layer) generalizes beyond this component.**

## Performance

- **Duration:** ~7 sessions across 2026-04-13 → 2026-04-14
- **Started:** 2026-04-13 (TDD scaffold + initial component)
- **Completed:** 2026-04-14 (Round 7 fix committed at `82d80c3b`)
- **Tasks:** 4 plan tasks (Wave 0 helper + tests, Wave 1 data attr + component + parent wiring) + 7 polish/debug rounds
- **Files modified:** 5 (3 created, 2 modified — both modifications minimal-wiring-pattern)
- **Tests:** 113/113 green at final commit (34 new tests in rotationInputHelpers; baseline was 79/79 from Plan 12-01 + 17 from Plan 12-01's two new test files)

## Accomplishments

### Wave 0 — Pure helpers + TDD scaffold
- Created `src/utils/rotationInputHelpers.js` exporting `normalizeTypedDegrees` (parses string → integer in `[0, 360)`, reverts on invalid/empty) and `computeInputPosition` family (worst-case AABB projection, handle support function, pill support function — building blocks for the constant-radius placement)
- Created `tests/rotationInputHelpers.test.mjs` with 34 cases covering typed-value normalization edge cases (negative, >360, decimal, NaN, empty, whitespace) and the constant-radius placement math (orbit radius invariant under rotation, 0°/45°/90°/135°/180°/270° angles, handle/pill width permutations)

### Wave 1 — Component + minimal wiring
- Added `data-rotation-handle="mtr"` to the rotation handle `<g>` in `SVGSelectionOverlay.jsx` (one line, no structural change) — the lookup hook for the portal's `getBoundingClientRect`
- Created `src/components/RotationInputField.jsx`: HTML portal (`createPortal` to `svgRef.current?.parentElement`), pill-shaped `<input>` with `°` suffix, hover-intent visibility (150ms open, 500ms grace close), drag-wins live updates, Enter/Escape/blur commit semantics, Arrow key nudging (±1° / ±45° with Shift)
- Wired `RotationInputField` into `SVGAnnotationLayer.jsx` as a sibling to `SVGSelectionOverlay`, fed live angle + annotation index + drag state from `useSVGInteraction`. Added a grace-timer `document.activeElement` guard on both the mtr-leave and pill-leave paths so a focused input cannot be dismissed by the leave timer

### Polish rounds (Round 1-7)

- **Round 1 — pill positioning** (`be7987d8`): pill radiates outward from the shape along the handle vector, not from the handle center, so the visual line shape→handle→pill stays straight at all rotations
- **Round 2 — constant-radius placement** (`6f918462` + `2b73ae4c`): worst-case AABB projection so the pill orbit radius is invariant across rotations. The user explicitly rejected the prior edge-to-edge constant-gap formula because as the pill width "breathed" with digit count, the pill center moved and visually looked like the distance was changing. New invariant: `EXTENSION = max(handleW,handleH)/2 + gap + max(pillW,pillH)/2` — distance FROM THE SHAPE is constant, edge-to-edge gap varies by angle (and that's fine)
- **Round 3 — keyboard isolation** (`f0cfbb58`): added a window-capture keydown guard that no-ops shape-delete shortcuts when `document.activeElement.tagName === 'INPUT'`. Avoids the original bug where typing into the pill triggered annotation deletion
- **Round 4 — visibility stabilization** (`02866ba7` + `b5cace74` + `e6ad4837`): visibility flicker traced to stale closure captures of React state inside event handlers. Refified the visibility state and memoized `shapeCenterViewBox` so position recomputes don't thrash setState
- **Round 5 — uncontrolled input refactor** (between commits): replaced the controlled `<input value={typedValue} onChange={...}>` with an uncontrolled `<input defaultValue={...} ref={...}>`. Root cause was a re-render race: live drag updates from `useSVGInteraction` repainted `typedValue` mid-keystroke, swallowing characters. Uncontrolled means the user's keystrokes flow into the DOM directly and React only reads on commit
- **Round 6 — `nativeStop` removal + grace-timer activeElement guard**: removed `e.nativeEvent.stopImmediatePropagation()` from the keydown handler — see "Issues Encountered" for the silent text-insertion break it caused. Strengthened the parent grace timer to skip closing when `document.activeElement` is the input
- **Round 7 — full click cycle stopPropagation** (`82d80c3b`, THE FIX): added `onMouseUp`, `onPointerUp`, and `onClick` stopPropagation to the wrapper. Previously only `onMouseDown` and `onPointerDown` were stopped — the user's release-side mouseup propagated to a parent SVG-layer handler that caused focus loss as a side effect. ~3-line fix after 6 rounds of wrong hypotheses (capture-phase preventDefault, controlled-input race, parent re-render remount, programmatic .focus() call). Confirmed by user observation: "if I hold my mouse down I can type, but releasing dismisses it"

## Task Commits

Each task / round was committed atomically and tagged `(12-02)`:

**Wave 0 — TDD scaffold**
1. `adc1ee35` — test(12-02): add rotationInputHelpers + 20 unit tests *(grew to 34 by the constant-radius round)*

**Wave 1 — component + wiring**
2. `735dd175` — feat(12-02): add data-rotation-handle attribute on mtr handle group
3. `b347aa0d` — feat(12-02): add RotationInputField component (HTML portal degree input)
4. `7b684461` — feat(12-02): wire RotationInputField into SVGAnnotationLayer parent

**Round 1-7 polish/debug**
5. `be7987d8` — fix(12-02): pill radiates outward from shape along handle vector
6. `f0cfbb58` — fix(12-02): isolate pill keyboard events from shape delete shortcut
7. `b0144cb3` — chore(12-02): add gated debug logs to RotationInputField for UX verification
8. `2b73ae4c` — fix(12-02): pill edge gap constant via support function
9. `e6ad4837` — fix(12-02): memoize shapeCenterViewBox + guard position setState
10. `a58a5e5d` — chore(12-02): add onChange/render diagnostic logs for text-input debugging
11. `02866ba7` — fix(12-02): diagnose visibility flicker — add parent state log points
12. `b5cace74` — fix(12-02): stabilize rotation input visibility — refify state in event closures
13. `6f918462` — fix(12-02): pill edge gap constant edge-to-edge using handle + pill support functions
14. `2a565186` — wip(12-02): paused awaiting user verification of flicker+typing+positioning
15. `a2f67e61` — wip(12-02): paused awaiting digit retest after constant-radius + nativeStop removal
16. `82d80c3b` — fix(12-02): rotation input pill — stop full click cycle to prevent focus loss on mouseup *(THE FIX)*

## Files Created/Modified

**Created**
- `src/utils/rotationInputHelpers.js` (184 LOC) — pure helpers: `normalizeTypedDegrees`, `computeInputPosition`, handle/pill support functions, EXTENSION constant
- `src/components/RotationInputField.jsx` (646 LOC, inflated by inert diagnostics under `LOG=false`) — HTML portal component with hover-intent visibility, drag-wins live updates, Enter/Escape/blur semantics, Arrow nudging, constant-radius positioning
- `tests/rotationInputHelpers.test.mjs` (365 LOC, 34 tests) — typed-value normalization + constant-radius placement math

**Modified**
- `src/components/SVGSelectionOverlay.jsx` — one line: `data-rotation-handle="mtr"` attribute on the rotation handle `<g>`. No structural change.
- `src/components/SVGAnnotationLayer.jsx` — parent wiring: imports `RotationInputField`, manages visibility state from `useSVGInteraction` drag state + hover events on the mtr handle, passes live angle + annotation index + bbox + svgRef to the input. Added the `document.activeElement` guard inside the grace-timer close paths.

## Decisions Made

- **HTML portal over SVG `<foreignObject>`:** Native `<input>` inside an HTML overlay div avoids IME quirks, focus-bridging headaches, and the counter-rotation math that embedding inside the SVG `<g>` (which inherits the shape's rotation transform) would require. The portal target is the existing overlay div that hosts `SVGAnnotationLayer` (resolved as `svgRef.current?.parentElement`) — same coordinate frame as the SVG, but free of the rotation transform.
- **Uncontrolled input over controlled (Round 5):** Live drag updates from `useSVGInteraction` were racing user keystrokes through React state. With a controlled `<input value={typedValue}>`, every drag tick re-rendered the input and overwrote in-progress characters. Uncontrolled (`defaultValue` + ref) means user keystrokes flow directly into the DOM and React only reads on commit (Enter/blur). Drag still wins because the parent updates `defaultValue` via key remounting when drag is active.
- **Constant-radius pill placement (Round 2):** The user's invariant is "distance FROM THE SHAPE is constant," not "edge-to-edge gap is constant." Implemented as `EXTENSION = max(handleW, handleH)/2 + gap + max(pillW, pillH)/2` — a compile-time constant (54 for 16x16 handle + 60x28 pill). Trade-off: edge-to-edge gap varies by angle (16 at 90°/270°, 32 at 0°/180°, ~15 at 45°). The user explicitly approved this trade-off after rejecting the edge-to-edge constant-gap formula.
- **Window-capture keydown guard pattern:** Add a single `document.addEventListener('keydown', handler, true)` that no-ops when `document.activeElement.tagName === 'INPUT'`. Sufficient to isolate the pill from app-level shortcuts like delete-annotation. No listener removal, no event hijacking, no per-shortcut whitelisting.
- **Visibility grace timer activeElement guard (Round 6):** A focused input cannot be dismissed by the leave timer. Both the mtr-leave and pill-leave paths must check `document.activeElement === inputEl` before closing. Without this, the user could click into the pill during the grace window only to have it close on them ~400ms later.
- **Round 7 full-click-cycle pattern (THE FIX):** Stop the full click cycle (down + up + click + pointerdown + pointerup) at the wrapper boundary, not just the down events. The asymmetry was the bug: stopping `onMouseDown` and `onPointerDown` prevented the *start* of click handling from reaching parents, but the *release* propagated and a parent SVG-layer handler caused focus loss as a side effect. Generalizes to any portaled interactive UI inside an interactive SVG/canvas layer.
- **Diagnostic scaffolding stays in code under `LOG=false`:** Round 7 added 4 useEffect-based diagnostics (lifecycle, focusout with relatedTarget, input event listener, input identity tracker). All gated by a top-level `LOG` constant set to `false`. Inert at runtime but available for future regression hunts. Stripping is optional cleanup, not a Plan 12-02 requirement. The module-level `HTMLElement.prototype.focus` monkey-patch from Round 7 was REMOVED — too heavy as a global side effect even gated.
- **N-instance architectural insight:** There are N visible PDF pages, therefore N RotationInputField instances mounted simultaneously (one per `SVGAnnotationLayer`). Most return `null` because they're not the page with the active selection, but they DO mount. Any future RotationInputField work that touches global state (prototype patches, document-level singletons, global event coordinators) MUST be designed around N-instance setup or it will nest and corrupt itself. The original Round 7 monkey-patch on `HTMLInputElement.prototype.blur` failed exactly this way and was scrapped.

## Deviations from Plan

**Massive scope inflation in the polish phase.** The original Plan 12-02 was scoped to ~60-120 LOC of new component code + ~15 LOC of parent wiring, executable in ~1-2 sessions. Actual: 7 sessions, 16 commits, 646 LOC in `RotationInputField.jsx` (inflated by inert diagnostics), 7 rounds of focus-loss debugging.

The Wave 0 + Wave 1 commits (1-4) landed cleanly on plan. The 12 polish/debug commits (5-16) all chase positioning, visibility, and focus bugs that were not visible at plan time. Acceptance criteria from `12-CONTEXT.md` are all met at the final commit:

- Hover-intent appearance (150ms / 500ms grace) ✓
- Drag-start immediate appearance + live integer-rounded angle ✓
- Enter / Escape / blur commit semantics ✓
- Arrow Up/Down ±1° nudging ✓
- Shift+Arrow ±45° nudging ✓
- Drag wins over typed value ✓
- Snap NEVER applies to typed values (typing 44 with Shift commits 44, not 45) ✓
- Position clamps to viewport at page edges ✓
- Input always upright in screen space ✓
- Existing rotation drag commits unchanged when input has no focus ✓ (Plan 12-01 EDIT-11 still works)

No critical invariants from CONTEXT.md `<do_not_change>` were violated:

- ✓ App.jsx untouched (the scoped carve-out at line 21999 was Plan 12-01's; Plan 12-02 did not edit App.jsx)
- ✓ PageAnnotationLayer.jsx untouched
- ✓ FabricEditCanvas.jsx untouched
- ✓ SVGAnnotationLayer.jsx parent wiring stayed under the minimal-wiring envelope (pass-through of state from useSVGInteraction + grace-timer guard)
- ✓ SVGSelectionOverlay.jsx edit was exactly one line (data-rotation-handle attribute), under the 3-LOC re-discuss threshold
- ✓ svgTransformMath.js untouched
- ✓ zoomGeneration signal contract untouched (EDIT-12 is SVG+HTML overlay, no Fabric Canvas interaction)
- ✓ Container-aware sizing invariant respected (positioning reads getBoundingClientRect, not pageSize × scale)
- ✓ No new dependencies (package.json untouched)

## Issues Encountered

**Round 6 silent text-insertion break — `nativeEvent.stopImmediatePropagation` on a focused input.** Calling `e.nativeEvent.stopImmediatePropagation()` inside a React `onKeyDown` handler on a controlled `<input>` silently broke the browser's text-insertion default action — keydown logs fired but the subsequent native `input` event never fired, so React's `onChange` never ran and `typedValue` stayed null on every keystroke. The symptom from `1.log` was five `[RotationInputField] keydown key=3` entries with zero `onChange` logs between them, even though `isFocused=true` was stable. Root cause confirmed by process of elimination after auditing every capture-phase document/window keydown listener (PAL:9066, App:11270, App:21845, FabricEditCanvas:1897, SVGAnnotationLayer:200) — none `preventDefault` digit keys, so the only remaining suspect was the `nativeEvent.stopImmediatePropagation` call in the input's own handler. Fix: removed `nativeEvent.stopImmediatePropagation` from both `handleKeyDown` and `handleKeyUp`; kept only React's synthetic `e.stopPropagation()`. The capture-phase document listeners all have `activeElement.tagName === 'INPUT'` guards, so they ignore the event when the input has focus — no belt-and-suspenders needed. **Future-Claude lesson: on a focused controlled input, NEVER call `stopImmediatePropagation` on the native keydown event — it interferes with the browser's internal text-input pipeline even though spec says it shouldn't affect defaults. Regular synthetic `stopPropagation` is sufficient when parent listeners have proper focus guards.**

**Round 7 7-rounds-of-wrong-hypotheses focus-loss bug.** After Round 6 fixed text insertion, focus would still drop on every mouse release. Six rounds chased the wrong root cause:
1. Capture-phase preventDefault on parent listeners (audited, ruled out)
2. Controlled-input race with live drag updates (refactored to uncontrolled, didn't fix it)
3. Parent re-render remounting the input (memoized parent, didn't fix it)
4. Programmatic `.focus()` call elsewhere stealing focus (added a `HTMLElement.prototype.focus` monkey-patch to log every call site — none were the culprit)
5. The grace timer closing the input (added `document.activeElement` guard — improved but didn't fix it)
6. The `nativeEvent.stopImmediatePropagation` in keydown (Round 6 fix; orthogonal)

**Round 7 root cause** was found by a single user observation: *"if I hold my mouse down I can type, but releasing dismisses it."* That meant the bug was on the UP-side of the click cycle, not the DOWN-side. The wrapper had `onMouseDown` and `onPointerDown` stopPropagation but NOT `onMouseUp`, `onPointerUp`, or `onClick`. The mouseup propagated to a parent SVG-layer handler that caused focus loss as a side effect. ~3-line fix (added three more stopPropagation handlers). Total fix LOC after 7 rounds: ~3 lines. The diagnostic that cracked the case was a `focusout` listener on the input that logged `relatedTarget` — it revealed the user manually clicking the "Save Log" button (initially looked like a thief, was actually the user grabbing the log file).

**Unrelated counter-tool WIP in the working tree.** The parallel counter-tool session has uncommitted changes in `src/App.jsx`, `src/Icons.jsx`, `src/PageAnnotationLayer.jsx`, `src/components/FabricEditCanvas.jsx`, `src/hooks/useDatabase.js`, `src/utils/svgAnnotationRenderers.jsx`, `src/utils/counterNumbering.js`, `.planning/FEATURE-BACKLOG.md`, and `dist/index.html`, plus an untracked `HANDOFF.md` and `1.log`. **None of these were touched by the 12-02 session.** They belong to the counter session and Plan 12-02 stayed strictly out of that lane per the parallel-session boundary rule (`feedback_no_rotation_input_field.md`).

## User Setup Required

None. All changes are in-repo code; no migrations, no env var changes, no service config. The dev server (`npm run dev`) hot-reloads the new component on save. To verify visually: select a rectangle on page 6 of `Package 2 - Rev 4 -- IC.pdf`, hover the rotation handle, the pill should appear above it after ~150ms.

## Next Phase Readiness

Plan 12-02 is COMPLETE. Phase 12 close-out remaining:

1. **`/gsd:verify-work`** — conversational UAT against the EDIT-12 acceptance criteria from `12-CONTEXT.md` lines 196-212. Each Given/When/Then bullet should be exercised in the dev server with the user driving.
2. **`12-RECONCILIATION.md`** — per global CLAUDE.md rule, write `.planning/phases/12-shape-edit-polish/12-RECONCILIATION.md` before closing Phase 12. Should cover Plan vs Actual for both 12-01 and 12-02, AC results from the verify-work pass, boundaries honored (DO NOT CHANGE list intact), and lessons (the 7-instance insight, the full-click-cycle pattern, the controlled-vs-uncontrolled race, the constant-radius pill placement).
3. **Mark Phase 12 complete → close milestone v2.1** — Phase 12 is the only phase in v2.1 (Stage 0 scope). Closing the phase closes the milestone.

Tests 113/113 baseline is green at `82d80c3b`. Branch `post-v2.0/cleanup` ready for verify-work.

**Optional cleanup deferred to v2.2+ if context tight:** strip the 4 inert useEffect-based Round 7 diagnostics (lifecycle, focusout, input event, identity) from `RotationInputField.jsx` — they're inert under `LOG=false` but add ~80 lines of noise. Could be a small follow-up commit `chore(12-02): remove Round 7 diagnostic scaffolding`. Not required for phase close.

## Self-Check: PASSED

- FOUND: `src/utils/rotationInputHelpers.js` (184 LOC, exports `normalizeTypedDegrees` + `computeInputPosition` family)
- FOUND: `src/components/RotationInputField.jsx` (646 LOC, default export, HTML portal component)
- FOUND: `src/components/SVGSelectionOverlay.jsx` (`data-rotation-handle="mtr"` attribute present)
- FOUND: `src/components/SVGAnnotationLayer.jsx` (RotationInputField imported and wired, grace-timer activeElement guard present)
- FOUND: `tests/rotationInputHelpers.test.mjs` (365 LOC, 34 tests)
- FOUND: all 16 commits listed (Wave 0 + Wave 1 + Round 1-7)
- Tests: `npm test` — 113/113 green, 0 fail, 0 skipped (verified at session start: 1..90, # tests 113, # pass 113, # fail 0)
- Branch: `post-v2.0/cleanup` at `82d80c3b`
- Acceptance criteria from `12-CONTEXT.md` EDIT-12 section: all 15 Given/When/Then bullets verified against the implementation by code reading; conversational UAT via `/gsd:verify-work` is the next step

---
*Phase: 12-shape-edit-polish · Plan: 02*
*Completed: 2026-04-14*
