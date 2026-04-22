# Phase 13: Rotation Handle Edit-Mode Polish — Research

**Researched:** 2026-04-14
**Domain:** React DOM event delegation + SVG rendering branch (inside `SVGAnnotationLayer.jsx` + `SVGSelectionOverlay.jsx`)
**Confidence:** HIGH

## Summary

Phase 13 closes the two carry-forward gaps from Phase 12 with surgical SVG-side edits. Strategy locks from `13-CONTEXT.md` eliminate the usual "research alternatives" work — both strategies are LOCKED (EDIT-13 → Strategy B event delegation; EDIT-14 → Fix A / Option C narrowed short-circuit + `isEditing` prop). Research here answers the ten open tactical questions the planner needs to write `13-01-PLAN.md` and `13-02-PLAN.md` without re-deciding anything.

The single non-obvious finding is the **pointerenter/pointerleave non-bubbling issue**: `pointerenter`/`pointerleave` DO NOT bubble in the DOM standard, so Strategy B (delegation on `svgRef.current`) requires either (a) switching to `pointerover`/`pointerout` which do bubble and filtering via `e.target.closest('[data-rotation-handle="mtr"]')` + `e.relatedTarget` boundary check, or (b) manually tracking `e.target` chain on non-bubbling `pointerenter`. Option (a) is both cleaner and cheaper.

Plan 13-02's mandatory diagnostic is unblocked — the FabricEditCanvas container has no `data-fabric-edit-container` attribute (verified via grep), so the diagnostic script walks ancestors from `document.querySelector('[data-rotation-handle="mtr"]')` UP the tree and also visits the Syncfusion `.e-pv-page-div` separately to compare rects.

**Primary recommendation:** Use `pointerover`/`pointerout` (bubbling) with a `closest()` + `relatedTarget` guard for Plan 13-01. For Plan 13-02, narrow the `:1050` short-circuit to `editIsBorderFlush && (obj.angle || 0) === 0` (read `obj.angle` directly — `bbox` is not yet computed at that site). Preserve ALL six hover-intent invariants (ref-as-mutable-state, activeElement guard, 150ms open / 500ms close, load-bearing `eslint-disable`, drag-wins optimistic paint, edit-mode gate).

## User Constraints (from CONTEXT.md)

### Locked Decisions

**EDIT-13 — Plan 13-01 — Hover pill stale-ref fix (Strategy B LOCKED)**

- Go **directly to Strategy B**, do NOT land Strategy A first. Rationale: Strategy A (add `editingAnnotationIndex` to dep array + `!= null` early-return gate) fixes symptoms but leaves re-attachment pattern fragile. Strategy B eliminates the bug class at the root via delegation.
- **Stable attachment target:** `svgRef.current` (SVG root — persists across all selection / edit-mode / annotation changes).
- **Dispatch predicate:** `e.target.closest('[data-rotation-handle="mtr"]')` inside pointerenter/pointerleave (or pointerover/pointerout) handlers.
- **Edit-mode gate:** `if (editingAnnotationIndex != null) return;` at effect-top.
- **Preserve load-bearing `eslint-disable react-hooks/exhaustive-deps`** at `SVGAnnotationLayer.jsx:312`. Dep array stays `[selectedIds, setRotInputVisibleDbg, editingAnnotationIndex]`. NEVER add tick-rate values (`annotations`, `visualTransform`, `rotInputVisible`).
- **Refs stay as closure-read sources:** `rotInputVisibleRef.current`, `rotInputHoveredRef.current`, `rotInputHoverTimerRef.current`, `rotInputCloseTimerRef.current`.
- **Delete the `handleEl` direct-attach path** at `:232-297`. Replace with delegated version on `svgRef.current`. The `querySelector('[data-rotation-handle="mtr"]')` line at `:232` goes away.
- **Remove Phase 12 debug console.log statements** at `:215, :234, :238, :243, :247, :254, :263, :267, :280, :285, :289, :300` in the same commit.
- **Files in scope (13-01):** `src/components/SVGAnnotationLayer.jsx` ONLY.

**EDIT-14 — Plan 13-02 — mtr handle visibility fix (Fix A / Architecture Option C LOCKED)**

- Narrow the `SVGAnnotationLayer.jsx:1050` short-circuit so it returns null ONLY when `editIsBorderFlush && angle === 0`.
- New render branch: `editIsBorderFlush && angle !== 0 && !editIsCounter` → render an **mtr-only SVG overlay** (no dashed bbox, no 8 resize pills, no rotation pill wiring).
- **Counter branch at `:1052-1099` UNTOUCHED.** `[COUNTER WIP — DO NOT TOUCH]` guard at `:1044-1047` respected.
- `SVGSelectionOverlay.jsx` gets a new `isEditing` prop that controls a conditional render branch:
  - `isEditing === false` → current rendering (full bbox + 8 resize handles + mtr)
  - `isEditing === true` → mtr-only render path (no bbox, no resize pills, just the rotation handle `<g>` with `data-rotation-handle="mtr"`)
- mtr handle in edit mode is **visual-only** — SVG root carries `pointerEvents: 'none'` when `isInteractive=false` (already gated at `:1009`).
- Both branches share the same `data-rotation-handle="mtr"` attribute so Plan 13-01's event delegation continues to reach the handle in edit mode.
- **Mandatory first step:** live-DOM diagnostic (DevTools paste script, NOT committed) to identify the actual clipper ancestor BEFORE implementing. Script walks ancestor chain from the mtr handle element up through `body`, reads `getBoundingClientRect()` + `getComputedStyle().overflow/overflowX/overflowY/clipPath/contain`, flags any ancestor where `rect.top > mtrRect.top && overflow !== 'visible'`. Output format: compact markdown table. Not committed — run once, paste back to plan workspace notes, discard.
- **Decision gate based on diagnostic:**
  - Clipper is Fabric canvas pixel buffer ONLY → Fix A works cleanly, proceed.
  - Clipper is Syncfusion `e-pv-page-div` or higher → Fix A insufficient (SVG is child of page div), **STOP and escalate to user with findings + options**.
  - Clipper is BOTH → Fix A partially works, **STOP and escalate**.
- **No unilateral pivot to Fabric-side fixes** (`controlsAboveOverlay`, custom mtr Control with `offsetY: -20`, BBOX_PADDING bump). Those land in `FabricEditCanvas.jsx` — held by counter-session. User decides.
- **Files in scope (13-02):** `src/components/SVGAnnotationLayer.jsx` (narrow `:1050`, ~2-5 LOC) + `src/components/SVGSelectionOverlay.jsx` (new `isEditing` prop + mtr-only branch, ~30-60 LOC).

**Shared — Both plans**

- One atomic commit per plan (`fix(13-01): EDIT-13 hover pill re-arms via event delegation`, `fix(13-02): EDIT-14 mtr handle visible on pre-rotated edit entry`).
- **No new unit tests.** Regression gate is 113-test `npm test` sweep + manual UAT grid.
- `console.count` probe on hover-intent effect body during 2-second drag-rotate MUST fire ≤3 times (optimistic-paint pattern invariant from Plan 12-03).
- **EDIT-13 UAT grid:** `{rect, circle, ellipse, text} × {angle=0, angle=30} × {exit via click-off, exit via Escape, exit via Enter-commit}` = **24 cells**.
- **EDIT-14 UAT grid:** `{rect, circle, ellipse, text} × {angle=0, angle=30}` = **8 cells**.
- Do NOT expand to line/arrow (EDIT-13) or additional angles (90/135/180) or pen/eraser tools.
- Recommend execution order: Plan 13-01 first, then Plan 13-02. If 13-01 blocks, pivot to 13-02 and come back.

### Claude's Discretion

- Exact delegation handler structure (single `onPointerOver`/`onPointerOut` on svgRef with `closest()` check vs non-bubbling pointerenter/pointerleave with manual target walk). **Research recommends `pointerover`/`pointerout` + `closest()` + `relatedTarget` boundary check — see Question 1 below.**
- Whether the mtr-only render branch in `SVGSelectionOverlay.jsx` is an early-return in the existing component or a conditional inside the existing body. **Research recommends inline conditional at the top of the render block (under `isEditing === true` guard) so the common JSDoc stays attached to one component symbol.**
- Exact diagnostic script formatting. **Research authors a ready-to-paste script in Question 2 below — compact table output.**
- Whether the diagnostic script is authored upfront in the plan or at the start of the first diagnostic wave. **Research provides it verbatim below so the planner embeds it in Plan 13-02 Wave 1 Task 1.**
- Order of 13-01 vs 13-02 execution. **Research confirms 13-01 first is correct — it's smaller, fully independent, and shaves a known quality-of-life bug before touching the overlay render branch that 13-02 modifies.**

### Deferred Ideas (OUT OF SCOPE)

- **Gap 2 — Off-screen handle relocation** — closed `wontfix_superseded_by_typed_input` per 9-tool industry survey. Do NOT research options.
- **Fabric-side Gap 4 fixes** (`controlsAboveOverlay`, custom mtr Control with `offsetY: -20`, BBOX_PADDING increase) — lane conflict with counter-session `FabricEditCanvas.jsx`. Deferred fallbacks only if Fix A insufficient AND user authorizes.
- **Rotation interaction in Fabric edit mode** — commit-lossy, out of scope per PROJECT.md line 71.
- **Typed-value Shift-snap in RotationInputField** — v2.1 locked.
- **Blur-commit / invalid-value revert for RotationInputField** — v2.1 user-descoped.
- **SVG select-mode flip for line/arrow/path/text** — v2.1 only rect/circle/ellipse.
- **Touching counter-session 7-file WIP lane** — HARD BOUNDARY.
- **Widening zoom range beyond 500% ceiling** — deferred to v2.3+.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EDIT-13 | User can hover the rotation handle after returning from edit mode via click-off/Escape/Enter-commit and see the typed-degree pill re-arm within the hover-intent window, without needing to fully deselect and reselect the shape. Applies to rect/circle/ellipse/text at `angle=0` and `angle=30`. | Q1 (pointerover/pointerout delegation), Q6 (editingAnnotationIndex already in scope), Q8 (console.count probe invariant), confirmed hover-intent dep array at :313, load-bearing eslint-disable at :312, 4 refs at :153-171, activeElement guard at :282-290, 150ms/500ms timers at :255/:292 |
| EDIT-14 | User can double-click into edit mode on a pre-rotated shape (angle ≠ 0) and see the mtr rotation handle (circle + connector + icon) fully visible, no clipping. Applies to rect/circle/ellipse/text. Handle is visual-only in edit mode — does NOT need to be draggable (rotation interaction via select-mode drag or typed-degree pill). | Q2 (DevTools diagnostic script), Q3 (clipper hypothesis matrix), Q4 (exact :1050 short-circuit quoted + narrowing), Q5 (existing mtr group JSX at SVGSelectionOverlay.jsx:167-206 + transform math), Q6 (editingAnnotationIndex prop drill path) |

## Validation Architecture

> workflow.nyquist_validation = true in `.planning/config.json` — this section required.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (built into Node) + `@playwright/test` ^1.58.2 for integration scenarios. Phase 13 uses `node:test` only. |
| Config file | `package.json:13` — `"test": "node --test tests/*.test.mjs"` (no dedicated config). Playwright config: `debug/playwright.config.mjs`. |
| Quick run command | `npm test` (runs all 10 `.test.mjs` files in `tests/` — 113 cases total, ~1-2 seconds) |
| Full suite command | `npm test` — same command; unit suite is fast enough to double as full suite for Phase 13 purposes |
| Manual UAT command | Load dev server (`npm run dev:ui` → http://localhost:5173), open "Package 2 - Rev 4 -- IC.pdf" on page 6, follow 24-cell (EDIT-13) + 8-cell (EDIT-14) grids from CONTEXT.md |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EDIT-13 | Pill re-arms after edit-mode exit via click-off (rect @ angle=0) | manual-only | UAT cell 1 of 24 | — |
| EDIT-13 | Pill re-arms after edit-mode exit via Escape (circle @ angle=30) | manual-only | UAT cell 8 of 24 | — |
| EDIT-13 | Pill re-arms after edit-mode exit via Enter-commit (ellipse @ angle=0) | manual-only | UAT cell 15 of 24 | — |
| EDIT-13 | Pill does NOT arm while in edit mode (edit-mode gate) | manual-only | UAT "edit-mode gate" cell | — |
| EDIT-13 | `console.count` probe fires ≤3 times during 2s drag-rotate (optimistic-paint invariant) | manual-only + console | UAT console.count probe | — |
| EDIT-13 | No regressions in 113 unit tests | automated | `npm test` | ✅ `tests/rotationInputHelpers.test.mjs` (34), `svgTransformMath.test.mjs` (10), +8 other suites = 113 total |
| EDIT-13 | Plan 12-02 7 focus-loss scenarios still pass (Tab, click-out, Arrow nudge, Enter, hover during drag, Shift modifier, blur) | manual-only | UAT regression smoke | — |
| EDIT-13 | ESLint `exhaustive-deps` warning does NOT fire on `:312` eslint-disable | automated | `npm run lint` (if defined) or visual inspection | — |
| EDIT-14 | mtr handle fully visible on pre-rotated rect edit entry | manual-only | UAT cell 1 of 8 (rect @ angle=30) | — |
| EDIT-14 | mtr handle fully visible on pre-rotated circle edit entry | manual-only | UAT cell 3 of 8 | — |
| EDIT-14 | mtr handle fully visible on pre-rotated ellipse edit entry | manual-only | UAT cell 5 of 8 | — |
| EDIT-14 | mtr handle fully visible on pre-rotated text edit entry | manual-only | UAT cell 7 of 8 | — |
| EDIT-14 | Border-flush baseline (angle=0) still short-circuits to null (no SVG chrome) | manual-only | UAT cells 2/4/6/8 of 8 | — |
| EDIT-14 | mtr handle is visual-only in edit mode (hover does NOT arm pill, drag does nothing) | manual-only | UAT "visual-only check" | — |
| EDIT-14 | Counter branch at `:1052-1099` unchanged — counter rotation handle still works | manual-only | UAT counter smoke | — |
| EDIT-14 | Live-DOM diagnostic script identifies clipper ancestor before coding | manual evidence | DevTools paste script output (see Q2 below) | Script provided in Q2, NOT committed |
| BOTH | 113/113 unit tests green after both plans land | automated | `npm test` | ✅ existing |
| BOTH | Zero counter-session files in commit diff | automated | `git show --stat <commit>` + grep for 7 forbidden paths | — |

### Sampling Rate

- **Per task commit (within a plan):** `npm test` (< 2 seconds — no reason to skip)
- **Per plan merge:** `npm test` + UAT grid execution + `git show --stat` inspection of commit diff against counter-session 7-file allowlist
- **Phase gate:** All of the above PLUS console.count probe executed manually during a drag-rotate on a text annotation, AND Plan 12-02 focus-loss scenarios verified green, before `/gsd:verify-work` runs

### Wave 0 Gaps

- **None — no new test infrastructure required.** Phase 13 explicitly adds zero unit tests (CONTEXT.md locked decision: "Adding jsdom unit tests for event delegation requires a jsdom-compatible SVG ancestor mock that the current test harness doesn't provide"). The existing 113-test baseline is the regression gate.

### Evidence Capture Requirements per Acceptance Criterion

| Acceptance Criterion | Evidence Type | How Captured |
|---|---|---|
| EDIT-13: pill re-arms ≤150ms after hover (each of 24 cells) | Visual + timing estimate | User reports "pill appeared within ~150ms" per cell; screenshot if borderline |
| EDIT-13: `console.count` ≤3 over 2s drag-rotate | Console output | User opens DevTools Console, runs drag-rotate, pastes count value back to plan notes |
| EDIT-13: load-bearing eslint-disable preserved | Code inspection | `grep -n "eslint-disable" src/components/SVGAnnotationLayer.jsx` matches line 312 |
| EDIT-13: dep array stays `[selectedIds, setRotInputVisibleDbg, editingAnnotationIndex]` | Code inspection | Plan 13-01 commit diff shows dep array contents |
| EDIT-13: activeElement guard at `:282-290` preserved | Code inspection | Plan 13-01 commit diff retains `document.activeElement?.closest('[data-rotation-input-field]')` check |
| EDIT-14: mtr handle visible on pre-rotated edit entry (each of 8 cells) | Visual | User verifies full circle + connector + icon visible; screenshot if borderline |
| EDIT-14: clipper diagnostic identifies the actual ancestor | DevTools output | Paste the markdown table produced by Q2 script back to Plan 13-02 wave 1 notes |
| EDIT-14: counter branch untouched | Code inspection | Plan 13-02 commit diff shows `:1052-1099` unchanged |
| EDIT-14: border-flush angle=0 still null | Manual UAT | Rect at angle=0 enters edit mode, no SVG chrome visible |
| BOTH: zero counter-session files in commit | Git inspection | `git show --stat <commit>` grep for 7 paths, result MUST be empty |
| BOTH: 113/113 tests green | Test output | `npm test` exit code 0 + stdout line count |

## Standard Stack

### Core (already installed, no new deps)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | (project dep) | Component tree | Already the framework |
| Pointer Events | DOM spec | `pointerover`/`pointerout`/`pointerenter`/`pointerleave` | Native browser API — no library |
| Node `node:test` | Node 20+ | Unit test runner (`tests/*.test.mjs`) | Project-standard, already 113 tests green |
| Playwright `@playwright/test` | ^1.58.2 | Integration scenarios (not used in Phase 13) | Already configured at `debug/playwright.config.mjs` |

**Installation:** None. Phase 13 adds zero dependencies (confirmed by `.planning/research/STACK.md`).

**Version verification:** N/A — no new installs.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `pointerover`/`pointerout` delegation | Non-bubbling `pointerenter`/`pointerleave` with manual target walk | Requires tracking `e.target` through ancestor chain manually; cleaner-looking code in the effect but subtly harder to reason about `relatedTarget` edge cases |
| Event delegation | MutationObserver on svgRef subtree | REJECTED — `PITFALLS.md` Pitfall 2 — 60fps cost during drag-rotate + async microtask race with React render + subtree leak |
| Event delegation | Strategy A (dep array expansion) | REJECTED — `13-CONTEXT.md` locked Strategy B directly — Strategy A leaves re-attachment pattern fragile |

## Architecture Patterns

### Recommended Project Structure

No structure changes. Both plans edit existing files inside:

```
src/components/
├── SVGAnnotationLayer.jsx     # Plan 13-01 (hover-intent :213-313) + Plan 13-02 (:1050 narrow)
└── SVGSelectionOverlay.jsx    # Plan 13-02 (new isEditing prop + mtr-only branch)
```

### Pattern 1: Event Delegation on Stable SVG Ancestor (Plan 13-01)

**What:** Attach `pointerover`/`pointerout` listeners once to `svgRef.current` (SVG root, stable for page lifetime). Dispatch via `e.target.closest('[data-rotation-handle="mtr"]')` + `e.relatedTarget` boundary check to emulate enter/leave semantics without listener re-attachment on every React reconcile.

**When to use:** Any time a child DOM node is created/destroyed inside a React-rendered SVG subtree while the parent effect's dep array cannot react (either because the signal is not in deps or because adding it would reintroduce a tick-rate loop).

**Example (illustrative, shaped to fit existing refs):**

```jsx
// Source: Event delegation pattern — synthesized from DOM Level 3 Events spec +
// existing SVGAnnotationLayer.jsx hover-intent refs (:153-171, :176, :282-290).
// pointerover / pointerout BUBBLE (unlike pointerenter/pointerleave) so one
// listener on svgRef.current reaches the mtr handle regardless of reconciliation.
useEffect(() => {
  const svgEl = svgRef.current;
  if (!svgEl) return;

  // Edit-mode gate: pill never arms mid-edit
  if (editingAnnotationIndex != null) {
    setRotInputVisibleDbg(false, 'in edit mode');
    if (rotInputHoverTimerRef.current) {
      clearTimeout(rotInputHoverTimerRef.current);
      rotInputHoverTimerRef.current = null;
    }
    if (rotInputCloseTimerRef.current) {
      clearTimeout(rotInputCloseTimerRef.current);
      rotInputCloseTimerRef.current = null;
    }
    return;
  }

  // Single-select gate (was :219)
  if (!selectedIds || selectedIds.size !== 1) {
    setRotInputVisibleDbg(false, 'selectedIds.size !== 1');
    if (rotInputHoverTimerRef.current) {
      clearTimeout(rotInputHoverTimerRef.current);
      rotInputHoverTimerRef.current = null;
    }
    if (rotInputCloseTimerRef.current) {
      clearTimeout(rotInputCloseTimerRef.current);
      rotInputCloseTimerRef.current = null;
    }
    return;
  }

  const onOver = (e) => {
    const mtr = e.target?.closest?.('[data-rotation-handle="mtr"]');
    if (!mtr) return;
    // Emulate pointerenter: fire only when the pointer crosses INTO the mtr
    // subtree from outside. If relatedTarget is already inside mtr, this is
    // just internal bubbling — ignore.
    if (e.relatedTarget && mtr.contains(e.relatedTarget)) return;

    rotInputHoveredRef.current = true;
    if (rotInputCloseTimerRef.current) {
      clearTimeout(rotInputCloseTimerRef.current);
      rotInputCloseTimerRef.current = null;
    }
    // UX: 150ms hover-intent open delay matches tooltip conventions
    if (!rotInputVisibleRef.current && !rotInputHoverTimerRef.current) {
      rotInputHoverTimerRef.current = setTimeout(() => {
        setRotInputVisibleDbg(true, '150ms hover-intent fired');
        rotInputHoverTimerRef.current = null;
      }, 150);
    }
  };

  const onOut = (e) => {
    const mtr = e.target?.closest?.('[data-rotation-handle="mtr"]');
    if (!mtr) return;
    // Emulate pointerleave: fire only when the pointer crosses OUT of the mtr
    // subtree to something outside. If relatedTarget is still inside mtr, this
    // is internal bubbling — ignore.
    if (e.relatedTarget && mtr.contains(e.relatedTarget)) return;

    rotInputHoveredRef.current = false;
    if (rotInputHoverTimerRef.current) {
      clearTimeout(rotInputHoverTimerRef.current);
      rotInputHoverTimerRef.current = null;
    }
    // UX: 500ms grace close window — load-bearing activeElement guard preserved
    if (rotInputVisibleRef.current && !rotInputCloseTimerRef.current) {
      rotInputCloseTimerRef.current = setTimeout(() => {
        const ae = document.activeElement;
        const focusedInPill = !!(ae && ae.closest && ae.closest('[data-rotation-input-field]'));
        if (focusedInPill) {
          // Plan 12-02 Round 7 fix — DO NOT remove
        } else if (!rotInputHoveredRef.current) {
          setRotInputVisibleDbg(false, '500ms grace expired (mtr leave path)');
        }
        rotInputCloseTimerRef.current = null;
      }, 500);
    }
  };

  svgEl.addEventListener('pointerover', onOver);
  svgEl.addEventListener('pointerout', onOut);

  return () => {
    svgEl.removeEventListener('pointerover', onOver);
    svgEl.removeEventListener('pointerout', onOut);
    if (rotInputHoverTimerRef.current) clearTimeout(rotInputHoverTimerRef.current);
    if (rotInputCloseTimerRef.current) clearTimeout(rotInputCloseTimerRef.current);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [selectedIds, setRotInputVisibleDbg, editingAnnotationIndex]);
```

**Load-bearing invariants this pattern preserves:**
1. `rotInputVisibleRef.current` / `rotInputHoveredRef.current` read via refs inside closures — never in dep array
2. 150ms open / 500ms close timers — semantics identical to Phase 12 direct-attach path
3. `activeElement?.closest('[data-rotation-input-field]')` guard at grace timer expiry (Plan 12-02 Round 7 fix)
4. `eslint-disable` at bottom of effect — deps stay minimal, explicitly excludes `annotations`, `visualTransform`, `rotInputVisible`
5. One listener pair, not N — `console.count` in effect body fires ONCE per dep-array change, not 60fps

### Pattern 2: Conditional Render Branch via `isEditing` Prop (Plan 13-02)

**What:** Add a new `isEditing={isBeingEditedNow}` prop to `SVGSelectionOverlay`. Inside the component, gate the bbox + resize handles block (`:86 !isGroupSelection && …`) additionally on `!isEditing`, and render a separate mtr-only subtree when `isEditing === true`.

**When to use:** Any time the same visual element (the mtr handle `<g>`) needs to appear in two different surrounding contexts (full selection chrome vs edit-mode visual-only) without duplicating the math.

**Example (illustrative, reuses existing `handles.mtr`, `inverseScale`, transform math):**

```jsx
// Source: synthesized from existing SVGSelectionOverlay.jsx:167-206 mtr subtree +
// CONTEXT.md locked Fix A / Option C structural fix.
// Renders the exact same geometry as select-mode, just without the surrounding
// bbox rect, corner circles, and edge pills. Shared data-rotation-handle="mtr"
// attribute so Plan 13-01 delegation still reaches it.
const SVGSelectionOverlay = memo(({
  bbox, inverseScale, onHandleDrag,
  isGroupSelection,
  strokeOpacity = 1.0,
  hideBoundingBox = false,
  padding = 2,
  isEditing = false,  // NEW — Plan 13-02
}) => {
  if (!bbox) return null;
  const { left, top, width, height, angle } = bbox;
  const handles = getHandlePositions(bbox, padding);
  const is = Math.sqrt(inverseScale);
  const cx = left + width / 2;
  const cy = top + height / 2;
  // … (existing boxX, boxY, cornerShadow, pillShadow, rotationShadow unchanged)

  // MTR-ONLY EDIT BRANCH — render just the rotation handle subtree, wrapped in
  // the same rotate(angle, cx, cy) transform so pre-rotated shapes see the
  // handle at the correct screen position. pointerEvents:none on the wrapper
  // because the SVG root itself is non-interactive during edit (:1009).
  if (isEditing) {
    return (
      <g
        className="svg-selection-overlay svg-selection-overlay--edit-mtr"
        transform={angle ? `rotate(${angle}, ${cx}, ${cy})` : undefined}
        style={{ pointerEvents: 'none' }}
      >
        <g className="rotation-handle" data-rotation-handle="mtr">
          <line
            x1={handles.mt.x} y1={handles.mt.y}
            x2={handles.mtr.x} y2={handles.mtr.y}
            stroke="#d1d1d1"
            strokeWidth={1 * is}
            style={{ pointerEvents: 'none' }}
          />
          <circle
            cx={handles.mtr.x} cy={handles.mtr.y}
            r={12 * is}
            fill="#ffffff"
            stroke="#e0e0e0"
            strokeWidth={1 * is}
            style={{
              filter: rotationShadow,
              // UX: visual-only during edit mode — cursor/pointerEvents neutered
              // because SVG root has pointerEvents:none when isInteractive=false.
              // Users rotate from select mode or by typing in RotationInputField.
              pointerEvents: 'none',
            }}
          />
          <image
            href={rotateIconSvg}
            x={handles.mtr.x - (16.8 * is) / 2}
            y={handles.mtr.y - (16.8 * is) / 2}
            width={16.8 * is}
            height={16.8 * is}
            style={{ pointerEvents: 'none' }}
          />
        </g>
      </g>
    );
  }

  // Fall through to existing select-mode rendering (bbox + 8 handles + mtr)
  return (
    <g className="svg-selection-overlay"
       transform={angle ? `rotate(${angle}, ${cx}, ${cy})` : undefined}
       style={{ pointerEvents: 'none' }}>
      {/* … existing :68-208 unchanged … */}
    </g>
  );
});
```

### Anti-Patterns to Avoid

- **Adding `annotations` / `visualTransform` / `rotInputVisible` to hover-intent dep array** — reintroduces v2.1 Plan 12-02 7-round flicker loop. Never. Ever.
- **Using `pointerenter`/`pointerleave` for delegation** — they DO NOT bubble; listeners attached to `svgRef.current` will never see child events. See Question 1 below.
- **Deleting the `:1050` short-circuit** — regresses v2.0 Phase 10/11 edit-chrome integration (doubled handles).
- **Rendering SVGSelectionOverlay's full chrome (bbox + resize pills) in edit mode** — Fabric provides resize chrome during edit; doubling produces ghost handles per the 2026-04-10 Canvas 2D vs SVG rasterizer gotcha.
- **Adding `controlsAboveOverlay`, custom mtr Control, or BBOX_PADDING bump** — all land in `FabricEditCanvas.jsx`, counter-session lane. HARD BOUNDARY.
- **Touching counter branch at `:1052-1099`** — `[COUNTER WIP — DO NOT TOUCH]` guard at `:1044-1047`.
- **`git add -A` / `git add .`** — mis-stages counter-session WIP. Explicit paths only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Detecting when mtr DOM node is replaced | MutationObserver on svgRef subtree | `pointerover`/`pointerout` bubbling + `closest()` | MO fires 60fps during drag, async race with React, subtree leak |
| Re-querying mtr DOM node on every render | `useMemo(() => svgRef.current.querySelector(…))` | Event delegation (no query needed) | `useMemo` runs during render BEFORE commit — captures previous commit's DOM |
| Finding the clipping ancestor | Guess based on CSS `overflow: hidden` | Live DOM diagnostic (`getBoundingClientRect` + `getComputedStyle`) | `PITFALLS.md` Pitfall 4a — the suspected `overflow: hidden` does NOT exist; real clipper is canvas pixel buffer OR Syncfusion ancestor, need diagnostic to know |
| Tracking mtr handle mount/unmount in React state | `useState(mtrElement)` | Event delegation | React tree state for DOM children is a code smell; delegation is the standard DOM-level fix |
| Building custom hover-intent state machine | New `useHoverIntent` hook | Keep existing 4-ref pattern (`rotInputVisibleRef` + `rotInputHoveredRef` + `rotInputHoverTimerRef` + `rotInputCloseTimerRef`) | Already proven through 7 rounds of Plan 12-02 debug, load-bearing activeElement guard documented inline — don't refactor working code |

**Key insight:** Both fixes reuse existing infrastructure (refs, timers, DOM attributes, render paths). Phase 13 is surgical re-plumbing, not new construction.

## Common Pitfalls

### Pitfall 1: Using `pointerenter`/`pointerleave` for Delegation (Gap 3)

**What goes wrong:** Listeners attached to `svgRef.current` never fire because `pointerenter`/`pointerleave` do NOT bubble in the DOM spec.

**Why it happens:** Developer reads MDN or Phase 12 code using direct-attach `pointerenter`, assumes it bubbles like `pointerover`, and just swaps the attachment target to `svgRef.current`. Tests appear to pass in jsdom (which doesn't implement bubble correctness consistently), then fails in Chromium.

**How to avoid:** Use `pointerover`/`pointerout` (both bubble per DOM Level 3) with a `relatedTarget` boundary check to emulate enter/leave semantics:

```js
const mtr = e.target?.closest?.('[data-rotation-handle="mtr"]');
if (!mtr) return;
if (e.relatedTarget && mtr.contains(e.relatedTarget)) return; // still inside mtr subtree — ignore
// now behaves like pointerenter/pointerleave
```

**Warning signs:** Listeners attached but `onEnter` never fires on hover; "hover doesn't work after Plan 13-01 lands" UAT failure.

### Pitfall 2: Adding `annotations` / `visualTransform` to Hover-Intent Dep Array (Gap 3)

**What goes wrong:** 60fps listener tear-down + re-attach during drag-rotate eats pointer events and reproduces v2.1 Plan 12-02 visibility flicker loop.

**Why it happens:** ESLint yells about `react-hooks/exhaustive-deps`. Developer removes the `eslint-disable` comment and adds "missing deps" to silence it.

**How to avoid:** Preserve `eslint-disable` at `:312`. Dep array stays `[selectedIds, setRotInputVisibleDbg, editingAnnotationIndex]`. The load-bearing comment at `:306-311` documents WHY — read it before editing.

**Warning signs:** `[SVGAnnotationLayer] hover-intent effect RUN` firing more than once per selection change. `console.count` probe in effect body ≥60 over 2s drag-rotate.

### Pitfall 3: Deleting `:1050` Short-Circuit Instead of Narrowing (Gap 4)

**What goes wrong:** Renders BOTH Fabric edit chrome AND SVG selection overlay (bbox + 8 resize handles + mtr) simultaneously → doubled handles, each at slightly different positions due to Canvas 2D vs SVG rasterizer differences (2026-04-10 gotcha).

**Why it happens:** Fastest-to-type fix is `// if (isBeingEditedNow && …) return null;`, comment-out the whole block.

**How to avoid:** Narrow the condition. Quote from `SVGAnnotationLayer.jsx:1050`:

```js
if (isBeingEditedNow && (editIsBorderFlush || editIsCounter)) return null;
```

Proposed narrowing (counter branch untouched):

```js
const angle = obj.angle || 0;
if (isBeingEditedNow && editIsCounter) return null;
if (isBeingEditedNow && editIsBorderFlush && angle === 0) return null;
// Fall through: editIsBorderFlush && angle !== 0 → mtr-only render below
```

**Warning signs:** Developer diff shows the short-circuit deleted entirely. Visual UAT shows doubled handles at edit entry.

### Pitfall 4: Reading `angle` From `bbox` at :1050 (Gap 4)

**What goes wrong:** `bbox` variable is computed at `:1154` via `getAnnotationBBox(obj)` — that's AFTER the :1050 short-circuit runs. Referencing `bbox.angle` at :1050 is a ReferenceError.

**Why it happens:** Developer sees `bbox.angle` used elsewhere (e.g. `:31` in `SVGSelectionOverlay.jsx`) and assumes `bbox` is available.

**How to avoid:** Read directly from `obj.angle || 0`. `obj` IS in scope at :1050 (defined at :1030: `const obj = annotations?.objects?.[selectedIndex];`). `getAnnotationBBox` just propagates `obj.angle ?? 0` into its return (confirmed in `src/utils/svgBoundingBox.js:205, 239, 312, 323, 333, 351, 362`).

**Warning signs:** `ReferenceError: bbox is not defined` at runtime when entering edit mode on any shape.

### Pitfall 5: Touching Counter Branch (`:1052-1099`) (Gap 4)

**What goes wrong:** Lane conflict with counter-session WIP. At best, merge conflict. At worst, counter rotation handle regresses and counter session loses work.

**Why it happens:** Developer sees `editIsCounter` condition share the short-circuit, thinks "unified logic", merges.

**How to avoid:** Read the `[COUNTER WIP — DO NOT TOUCH]` guard comment at `:1044-1047`. The counter branch at `:1052-1099` is held by a parallel session. Narrowing logic keeps `isBeingEditedNow && editIsCounter → return null` exactly as-is; only the border-flush branch is split.

**Warning signs:** Plan 13-02 commit diff touches lines between `:1052-1099`. Counter annotation behavior changes in UAT.

### Pitfall 6: Chasing `overflow: hidden` That Doesn't Exist (Gap 4)

**What goes wrong:** Developer greps for `overflow: hidden` in `FabricEditCanvas.jsx`, can't find it, concludes the bug is fixed and commits without diagnostic.

**Why it happens:** FEATURE-BACKLOG's original suspect was `overflow: hidden`. But source inspection (`FabricEditCanvas.jsx:950, 965, 1662`) shows it's `overflow: visible`. Real culprit is canvas pixel buffer clip OR Syncfusion ancestor.

**How to avoid:** Run the Q2 diagnostic script FIRST. Do not code-commit before the diagnostic output identifies the actual clipper. Plan 13-02 Wave 1 Task 1 is the diagnostic.

**Warning signs:** Plan 13-02 proceeds without any diagnostic output pasted to plan notes.

### Pitfall 7: Staging Counter-Session Files (Both Plans)

**What goes wrong:** `git add -A` mis-stages the 7-file counter-session WIP lane, committing someone else's uncommitted work under Phase 13's name.

**Why it happens:** Developer reflexively types `git add .` without checking the pre-commit `git status`.

**How to avoid:** Use explicit-path staging only. See Question 10 below for the exact command sequence.

**Warning signs:** `git show --stat <commit>` output lists `App.jsx`, `PageAnnotationLayer.jsx`, `FabricEditCanvas.jsx`, `useDatabase.js`, `counterNumbering.js`, `svgAnnotationRenderers.jsx`, or `dist/index.html` in any Phase 13 commit.

## Code Examples

### Plan 13-01: Delegated pointerover/pointerout

See `Pattern 1` above — full effect body with preserved 4-ref state, 150ms/500ms timers, activeElement guard, edit-mode gate, load-bearing `eslint-disable`. ~45-55 LOC replacing `:213-313` (which is currently 101 LOC with 12 console.logs + handleEl querySelector + direct-attach pattern). Net change: ~40-50 LOC delete, ~45-55 LOC add — roughly break-even on line count, strongly positive on clarity.

### Plan 13-02: Narrowed `:1050` Short-Circuit

**Current (SVGAnnotationLayer.jsx:1049-1050):**

```js
const isBeingEditedNow = editingAnnotationIndex != null && selectedIndex === editingAnnotationIndex;
if (isBeingEditedNow && (editIsBorderFlush || editIsCounter)) return null;
```

**Proposed (narrowing, ~3-5 LOC):**

```js
const isBeingEditedNow = editingAnnotationIndex != null && selectedIndex === editingAnnotationIndex;
// [COUNTER WIP — DO NOT TOUCH] counter branch short-circuit stays identical
if (isBeingEditedNow && editIsCounter) return null;
// EDIT-14: border-flush at angle=0 → clean edit surface (no chrome). But at
// angle !== 0 we fall through so the mtr handle can render visual-only below,
// preventing the Gap 4 clip. See Phase 13 Plan 13-02 + :1229 render branch.
const editAngle = obj.angle || 0;
if (isBeingEditedNow && editIsBorderFlush && editAngle === 0) return null;
```

### Plan 13-02: `<SVGSelectionOverlay>` Call Site Update (`:1229`)

**Current:**

```jsx
<SVGSelectionOverlay
  key={`selection-${selectedIndex}`}
  bbox={bbox}
  inverseScale={inverseScale}
  onHandleDrag={(e, handleId) => handleHandlePointerDown(e, handleId)}
  isGroupSelection={isBeingEditedNow}
  hideBoundingBox={isBorderFlush}
  padding={isBorderFlush ? 0 : 2}
/>
```

**Proposed (add `isEditing` prop):**

```jsx
<SVGSelectionOverlay
  key={`selection-${selectedIndex}`}
  bbox={bbox}
  inverseScale={inverseScale}
  onHandleDrag={(e, handleId) => handleHandlePointerDown(e, handleId)}
  isGroupSelection={isBeingEditedNow}
  hideBoundingBox={isBorderFlush}
  padding={isBorderFlush ? 0 : 2}
  isEditing={isBeingEditedNow}
/>
```

**Note:** `isBeingEditedNow` is already computed at `:1049`. Currently wired to `isGroupSelection` which hides ALL handles (`:86 !isGroupSelection && …`). After Plan 13-02, `isEditing` drives the new mtr-only branch (Pattern 2 above). The `isGroupSelection` wire stays on `isBeingEditedNow` for backward compat (multi-select group semantics are unrelated), and the new `isEditing` branch early-returns before the `isGroupSelection` check so only one path fires.

**Alternative:** pass `isEditing` separately and stop using `isBeingEditedNow` as `isGroupSelection`. But that changes the selection-chrome semantics for multi-select, out of scope. Recommend: add `isEditing` prop additively, leave `isGroupSelection` wire alone.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct-attach `handleEl.addEventListener('pointerenter', …)` via `svgRef.current.querySelector` (Phase 12) | Delegated `svgRef.current.addEventListener('pointerover', …)` + `closest()` (Phase 13) | Phase 13 Plan 13-01 | Eliminates stale-ref bug class. No listener re-attachment on React reconciliation. |
| `:1050` short-circuits for ALL border-flush types in edit mode (returns null → Fabric owns chrome) | `:1050` short-circuits ONLY `editIsBorderFlush && angle === 0`; `angle !== 0` falls through to mtr-only SVG branch | Phase 13 Plan 13-02 | Pre-rotated shapes see mtr handle (visual-only) in edit mode. Non-rotated border-flush baseline unchanged. |

**Deprecated/outdated:**
- **Phase 12 `handleEl = svgRef.current?.querySelector('[data-rotation-handle="mtr"]')` pattern** at `:232` — being replaced by delegation. Remove cleanly, no reason to leave as fallback.
- **12 Phase 12 debug `console.log` statements** at `:215, 234, 238, 243, 247, 254, 263, 267, 280, 285, 289, 300` — Phase 12 debug aids, clutter production logs. Delete in same commit as delegation rewrite.

## Open Questions (ANSWERED)

### Question 1 — pointerenter/pointerleave non-bubbling: which delegation pattern is cleaner?

**What we know:** Per DOM Level 3 Events spec, `pointerover` and `pointerout` bubble (like `mouseover`/`mouseout`), but `pointerenter` and `pointerleave` do NOT bubble (like `mouseenter`/`mouseleave`). This is intentional spec behavior — `enter`/`leave` fire only when crossing the element boundary, `over`/`out` fire on every child traversal.

**Implications for Plan 13-01:**

| Pattern | Attach to | Bubbles? | Cleaner? |
|---------|-----------|----------|----------|
| **A. Direct-attach `pointerenter`/`pointerleave` to mtr element** | `handleEl` (the mtr `<g>` via `querySelector`) | N/A (direct attach, no bubbling needed) | This is the CURRENT Phase 12 pattern — has the stale-ref bug |
| **B. Delegated `pointerover`/`pointerout` on svgRef** | `svgRef.current` | YES — reaches svgRef because over/out bubble | **Recommended** — cleanest, matches industry pattern |
| **C. Delegated `pointerenter`/`pointerleave` on svgRef** | `svgRef.current` | **NO** — listeners never fire on child events | REJECTED — does not work |
| D. Non-bubbling pointerenter with manual target walk | per-child, via manual traversal | requires per-render re-attach | Reproduces Phase 12 stale-ref problem |

**Verdict:** Pattern B. Use `pointerover`/`pointerout` on `svgRef.current` with:
- `e.target?.closest?.('[data-rotation-handle="mtr"]')` filter to identify mtr events
- `e.relatedTarget && mtr.contains(e.relatedTarget)` boundary check to emulate enter/leave semantics (ignore internal-subtree traversals)

**Phase 12 handler semantics all survive Pattern B:**
- 150ms hover-intent open delay: unchanged — the open-timer scheduling is inside `onOver`
- 500ms grace close window: unchanged — the grace-timer scheduling is inside `onOut`
- `activeElement?.closest('[data-rotation-input-field]')` guard at grace expiry: unchanged — lives inside the grace timer callback, not touched by delegation
- Ref-as-mutable-state reads: unchanged — closures still read `rotInputVisibleRef.current`, `rotInputHoveredRef.current`
- Timer cleanup on effect teardown: unchanged — returned cleanup function clears both timers

**Confidence:** HIGH. Directly verifiable against DOM Level 3 Events spec + hands-on testing. The `relatedTarget` boundary check is the standard DOM enter/leave emulation pattern used by every major UI framework.

### Question 2 — DevTools diagnostic script (ready to paste)

The script below walks the ancestor chain from the mtr handle element up through `body`, reads each ancestor's `getBoundingClientRect()` + `getComputedStyle` overflow/clip properties, and flags clipping candidates. Compact markdown table output. Plan 13-02 Wave 1 Task 1 embeds this verbatim.

```js
// =============================================================================
// EDIT-14 Clipper Diagnostic — paste into DevTools Console
// =============================================================================
// Preconditions:
//   1. Dev server running (http://localhost:5173)
//   2. "Package 2 - Rev 4 -- IC.pdf" open, on page 6
//   3. A rect/circle/ellipse/text annotation exists with angle ≠ 0 (create
//      one and rotate it to ~30° via the pill if needed)
//   4. That annotation is selected AND double-clicked into edit mode
//   5. DevTools Console focused on the main (top) frame
//
// Output: markdown table showing ancestor chain + clip-relevant computed styles.
// Copy the output and paste back into Plan 13-02 Wave 1 Task 1 notes.
// =============================================================================
(() => {
  const mtr = document.querySelector('[data-rotation-handle="mtr"]');
  if (!mtr) {
    console.error('[EDIT-14 diag] No [data-rotation-handle="mtr"] element found. ' +
      'Is a shape selected AND pre-rotated AND in edit mode?');
    return;
  }
  const mtrRect = mtr.getBoundingClientRect();
  console.log('[EDIT-14 diag] mtr handle rect:', {
    top: mtrRect.top.toFixed(1),
    left: mtrRect.left.toFixed(1),
    width: mtrRect.width.toFixed(1),
    height: mtrRect.height.toFixed(1),
  });

  // Walk ancestor chain from mtr up to <body>
  const chain = [];
  let el = mtr;
  let depth = 0;
  while (el && el !== document.body && depth < 40) {
    const cs = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const clips =
      rect.top > mtrRect.top &&
      !['visible', ''].includes(cs.overflow) &&
      !['visible', ''].includes(cs.overflowY);
    chain.push({
      depth,
      tag: el.tagName.toLowerCase(),
      cls: (el.getAttribute('class') || '').slice(0, 40),
      top: rect.top.toFixed(1),
      left: rect.left.toFixed(1),
      w: rect.width.toFixed(1),
      h: rect.height.toFixed(1),
      overflow: cs.overflow,
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      clipPath: cs.clipPath === 'none' ? '-' : cs.clipPath,
      contain: cs.contain === 'none' ? '-' : cs.contain,
      clips: clips ? 'YES' : '',
    });
    el = el.parentElement;
    depth++;
  }

  // Also check the Syncfusion .e-pv-page-div explicitly in case the chain
  // doesn't walk through it (e.g. portal)
  const pageDiv = document.querySelector('.e-pv-page-div[data-page-number="6"]') ||
                  document.querySelector('.e-pv-page-div');
  if (pageDiv) {
    const cs = window.getComputedStyle(pageDiv);
    const rect = pageDiv.getBoundingClientRect();
    const clips =
      rect.top > mtrRect.top &&
      !['visible', ''].includes(cs.overflow) &&
      !['visible', ''].includes(cs.overflowY);
    chain.push({
      depth: '(e-pv-page-div)',
      tag: 'div',
      cls: 'e-pv-page-div',
      top: rect.top.toFixed(1),
      left: rect.left.toFixed(1),
      w: rect.width.toFixed(1),
      h: rect.height.toFixed(1),
      overflow: cs.overflow,
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      clipPath: cs.clipPath === 'none' ? '-' : cs.clipPath,
      contain: cs.contain === 'none' ? '-' : cs.contain,
      clips: clips ? 'YES' : '',
    });
  }

  // Render as markdown table
  const header = '| depth | tag | class | top | left | w | h | overflow | overflowX | overflowY | clipPath | contain | CLIPS |';
  const sep    = '|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const rows = chain.map((r) =>
    `| ${r.depth} | ${r.tag} | \`${r.cls}\` | ${r.top} | ${r.left} | ${r.w} | ${r.h} | ${r.overflow} | ${r.overflowX} | ${r.overflowY} | ${r.clipPath} | ${r.contain} | ${r.clips} |`
  );
  const md = [
    `### EDIT-14 Clipper Diagnostic (${new Date().toISOString()})`,
    ``,
    `**mtr handle rect:** top=${mtrRect.top.toFixed(1)} left=${mtrRect.left.toFixed(1)} w=${mtrRect.width.toFixed(1)} h=${mtrRect.height.toFixed(1)}`,
    ``,
    `**Clipping candidates** (ancestors where \`rect.top > mtr.top\` AND \`overflow !== visible\`):`,
    ``,
    header, sep, ...rows,
  ].join('\n');

  console.log(md);
  try { copy(md); console.log('[EDIT-14 diag] (copied to clipboard)'); } catch {}
  return md;
})();
```

**How to use:**
1. Start dev server, open PDF, navigate to page 6
2. Create (or find) a rect/text annotation with angle ≠ 0 (~30°)
3. Select the shape (single click) AND double-click to enter edit mode
4. Open DevTools Console, paste script, press Enter
5. Copy the resulting markdown table from the console (also auto-copied via `copy()`)
6. Paste into `.planning/phases/13-rotation-handle-edit-mode-polish/13-02-PLAN.md` Wave 1 Task 1 output

**Interpretation gate:**
- If a row marked `CLIPS=YES` appears with `class=e-pv-page-div` → Syncfusion ancestor clips the SVG too → **Fix A is insufficient, STOP and escalate**
- If the only `CLIPS=YES` row is inside the Fabric canvas pixel buffer (class contains `fabric-edit` / `canvas-wrapper` / `canvas-container`) → Fix A works cleanly, **proceed**
- If both → **STOP and escalate**
- If no `CLIPS=YES` rows at all → unexpected — the user may not have triggered the repro correctly. Confirm pre-rotation angle via MiniToolbar or SVG inspect before re-running.

**Confidence:** HIGH. Uses only standard DOM APIs (`querySelector`, `getBoundingClientRect`, `getComputedStyle`). Script is read-only. DevTools Console `copy()` is standard Chromium API.

### Question 3 — Clipper hypothesis matrix

Cross-reference from ARCHITECTURE.md §"Gap 4" + PITFALLS.md Pitfall 4a:

| Hypothesis | Clipper | Source of Evidence | Does Fix A Work? | Escalation Path |
|------------|---------|--------------------|------------------|-----------------|
| **H1. Fabric canvas pixel buffer** | `<canvas>` element (`setDimensions` at FabricEditCanvas.jsx:1054) — physical pixel buffer. BBOX_PADDING=32, rotatingPointOffset=40, so mtr center at y=-8 is outside drawable surface | PITFALLS.md Pitfall 4a (math verified) | **YES — cleanly.** SVG layer is a sibling/parent of the Fabric canvas in the DOM. SVG renders mtr inside the page-wide `<svg>` viewBox, NOT inside the canvas pixel buffer. Fix A draws the mtr via SVG which is unaffected by canvas buffer dimensions. | None — proceed with Fix A |
| **H2. Syncfusion `.e-pv-page-div` ancestor** | Per-page container element owned by Syncfusion viewer, with CSS `overflow: hidden` on a ancestor | ARCHITECTURE.md §"Gap 4" hypothesis at line 196 ("the Syncfusion page-div ancestor has `overflow: hidden`") | **NO — Fix A insufficient.** SVGAnnotationLayer is a child of the Syncfusion page div (same overlay container hierarchy). If the page div clips, SVG mtr rendering is clipped too regardless of whether it lives inside Fabric canvas or as sibling. | **STOP and escalate.** Report findings + Fix B counter-session coordination option |
| **H3. Both (canvas AND Syncfusion)** | Canvas clips the original Fabric-drawn mtr, Syncfusion page div also clips SVG mtr at edge cases | Could happen at small page-edge annotations | **Partial.** Fix A escapes the canvas but gets re-clipped by Syncfusion for page-edge shapes. | **STOP and escalate.** Report exactly which shapes are affected, offer Fix A for interior shapes + coordination for page-edge shapes |

**Fix A escalation trigger:** The diagnostic script output is the ground truth. If ANY ancestor with `class~=e-pv-page-div` shows `CLIPS=YES`, Fix A is partial or insufficient. Do NOT proceed without user decision.

**Fix A lane safety:** Fix A touches `SVGAnnotationLayer.jsx` + `SVGSelectionOverlay.jsx`. NONE of counter-session 7-file WIP lane. LANE-SAFE.

**Fix B (Fabric-side fallbacks) escalation:** If authorized by user after escalation, Fix B lands in `FabricEditCanvas.jsx` (counter-session WIP lane) — requires explicit user approval AND counter-session coordination. Do not assume, do not auto-pivot.

**Confidence:** HIGH on H1 math (verified against FabricEditCanvas.jsx source). MEDIUM on H2 because ancestor hierarchy depends on the exact overlay container structure Syncfusion uses at runtime — the diagnostic resolves it.

### Question 4 — Exact `:1050` short-circuit expression

**Read from `src/components/SVGAnnotationLayer.jsx:1042-1050` (verbatim):**

```js
1042:        const editObjType = String(obj.type || '').toLowerCase();
1043:        const editIsBorderFlush = editObjType === 'text' || editObjType === 'textbox' || editObjType === 'i-text' || editObjType === 'rect';
1044:        // [COUNTER WIP — DO NOT TOUCH] Counter select-mode rotation handle
1045:        // and counter hover-outline path are mid-debug as of 2026-04-14.
1046:        // Another session: leave editIsCounter / counterRotateDragRef /
1047:        // counter hover branch alone. Coordinate via the user first.
1048:        const editIsCounter = obj.data?.type === 'counter';
1049:        const isBeingEditedNow = editingAnnotationIndex != null && selectedIndex === editingAnnotationIndex;
1050:        if (isBeingEditedNow && (editIsBorderFlush || editIsCounter)) return null;
```

**Variables in scope at `:1050`:**

| Variable | Source | Available? |
|----------|--------|-----------|
| `obj` | `:1030` (`const obj = annotations?.objects?.[selectedIndex];`) | YES |
| `editObjType` | `:1042` | YES |
| `editIsBorderFlush` | `:1043` | YES |
| `editIsCounter` | `:1048` | YES |
| `isBeingEditedNow` | `:1049` | YES |
| `angle` | **NOT YET DERIVED** | **NO** — must be read from `obj.angle || 0` at :1050 because `bbox` (computed at `:1154`) does not exist yet |
| `bbox` | `:1154` (`let bbox = getAnnotationBBox(obj);`) | NO — below the short-circuit |
| `selectedIndex` | loop variable from `:1029` map callback | YES |

**Proposed narrowing (planner embeds verbatim):**

```js
// [COUNTER WIP — DO NOT TOUCH] Counter branch untouched.
const editIsCounter = obj.data?.type === 'counter';
const isBeingEditedNow = editingAnnotationIndex != null && selectedIndex === editingAnnotationIndex;
// Counter edit-mode short-circuit stays as-is (unrelated to Gap 4).
if (isBeingEditedNow && editIsCounter) return null;
// EDIT-14: Border-flush shapes at angle=0 still short-circuit (clean edit
// surface). Pre-rotated border-flush shapes fall through to render a visual-
// only mtr handle via the new isEditing branch in SVGSelectionOverlay, so the
// handle is not clipped by the Fabric canvas pixel buffer.
const editAngle = obj.angle || 0;
if (isBeingEditedNow && editIsBorderFlush && editAngle === 0) return null;
```

**Note on `editAngle` naming:** Choosing `editAngle` rather than `angle` avoids shadowing the `angle` destructured at `:31` inside `SVGSelectionOverlay.jsx` (which is separate scope — that's inside a different component, so no actual conflict, but naming distinctly makes the intent obvious when reading the call site + child together).

**Confidence:** HIGH — lines 1042-1050 read directly from source.

### Question 5 — `SVGSelectionOverlay.jsx` mtr group structure

**Read from `src/components/SVGSelectionOverlay.jsx:167-206` (verbatim):**

```jsx
167:          {/* Rotation handle (mtr) */}
168:          <g className="rotation-handle" data-rotation-handle="mtr">
169:            {/* Connector line from top-center of bbox to rotation handle */}
170:            <line
171:              x1={handles.mt.x}
172:              y1={handles.mt.y}
173:              x2={handles.mtr.x}
174:              y2={handles.mtr.y}
175:              stroke="#d1d1d1"
176:              strokeWidth={1 * is}
177:              style={{ pointerEvents: 'none' }}
178:            />
179:            {/* Rotation circle */}
180:            <circle
181:              cx={handles.mtr.x}
182:              cy={handles.mtr.y}
183:              r={12 * is}
184:              fill="#ffffff"
185:              stroke="#e0e0e0"
186:              strokeWidth={1 * is}
187:              style={{
188:                filter: rotationShadow,
189:                cursor: 'crosshair',
190:                pointerEvents: 'auto',
191:              }}
192:              onPointerDown={(e) => {
193:                e.stopPropagation();
194:                onHandleDrag?.(e, 'mtr');
195:              }}
196:            />
197:            {/* Rotation icon image (70% of circle diameter) */}
198:            <image
199:              href={rotateIconSvg}
200:              x={handles.mtr.x - (16.8 * is) / 2}
201:              y={handles.mtr.y - (16.8 * is) / 2}
202:              width={16.8 * is}
203:              height={16.8 * is}
204:              style={{ pointerEvents: 'none' }}
205:              height={16.8 * is}
206:              style={{ pointerEvents: 'none' }}
```

**(Note: there may be a minor off-by-one in my read; the structure above is the 4-child pattern — outer `<g data-rotation-handle>`, `<line>`, `<circle>`, `<image>`.)**

**Element tree:**

```
<g className="rotation-handle" data-rotation-handle="mtr">   // :168
  <line x1={handles.mt.x} y1={handles.mt.y}                  // connector line :170-178
        x2={handles.mtr.x} y2={handles.mtr.y}
        stroke="#d1d1d1" strokeWidth={1 * is}
        style={{ pointerEvents: 'none' }} />
  <circle cx={handles.mtr.x} cy={handles.mtr.y}              // rotation circle :180-196
          r={12 * is}
          fill="#ffffff" stroke="#e0e0e0" strokeWidth={1 * is}
          style={{ filter: rotationShadow, cursor: 'crosshair', pointerEvents: 'auto' }}
          onPointerDown={(e) => { e.stopPropagation(); onHandleDrag?.(e, 'mtr'); }} />
  <image href={rotateIconSvg}                                // rotation icon :198-205
         x={handles.mtr.x - (16.8 * is) / 2}
         y={handles.mtr.y - (16.8 * is) / 2}
         width={16.8 * is} height={16.8 * is}
         style={{ pointerEvents: 'none' }} />
</g>
```

**Transform math (surrounding group at :62-66):**

```jsx
<g
  className="svg-selection-overlay"
  transform={angle ? `rotate(${angle}, ${cx}, ${cy})` : undefined}
  style={{ pointerEvents: 'none' }}
>
```

Where:
- `angle` = `bbox.angle` (destructured at `:31`)
- `cx = left + width / 2`, `cy = top + height / 2` (bbox center, `:38-39`)
- `handles` = `getHandlePositions(bbox, padding)` (pure function from `svgBoundingBox.js`, `:32`)
- `is = Math.sqrt(inverseScale)` (dampened inverse scale for handle sizing, `:35`)

**Props the mtr group reads from parent that need checking for `isEditing=true` case:**

| Prop | Used in mtr branch? | Available when `isEditing=true`? |
|------|----------------------|----------------------------------|
| `bbox` (includes `angle`, `left`, `top`, `width`, `height`) | YES — needed for `handles.mtr`, `handles.mt`, `angle`, `cx`, `cy` | YES — parent still passes bbox at `:1231` |
| `inverseScale` | YES — for `is` handle sizing | YES — parent still passes at `:1232` |
| `padding` | YES — feeds `getHandlePositions(bbox, padding)` | YES — parent passes `:1236` (border-flush gets `padding=0`) |
| `onHandleDrag` | NO in `isEditing=true` branch — handle is visual-only, no drag | YES but unused — set `pointerEvents: 'none'` on circle instead, skip `onPointerDown` |
| `rotationShadow` (derived) | YES — reused for visual consistency with select mode | YES — computed from `is` |
| `rotateIconSvg` (imported) | YES — imported at `:18` | YES — static import |

**Verdict for Plan 13-02 mtr-only branch:**

- **All required inputs are available** — `bbox`, `inverseScale`, `padding` flow through identically from the parent
- **`onHandleDrag` is NOT needed** — `pointerEvents: 'none'` on the circle means no `onPointerDown` can fire, and the underlying SVG root `isInteractive=false` gates the whole subtree anyway
- **`cursor: 'crosshair'` should become `cursor: 'default'` or omitted** — visual-only, no drag affordance
- **`data-rotation-handle="mtr"` attribute MUST be preserved** — Plan 13-01 delegation relies on it to ALSO reach the handle during edit mode (delegation fires but edit-mode gate returns early, which is correct behavior — pill does NOT arm during edit)

**Confidence:** HIGH — direct source read.

### Question 6 — `editingAnnotationIndex` reach

**Source:**

- Defined as prop at `SVGAnnotationLayer.jsx:109` (`editingAnnotationIndex, // number | null — index of annotation currently being edited in FabricEditCanvas (hidden in SVG)`)
- Used at `:140` (`const isInteractive = (activeTool === 'select' || activeTool === 'text-select') && editingAnnotationIndex == null;`)
- Used at `:837` (`const isBeingEdited = editingAnnotationIndex != null && i === editingAnnotationIndex;`) in annotation render loop
- Used at `:1049` (`const isBeingEditedNow = editingAnnotationIndex != null && selectedIndex === editingAnnotationIndex;`) in selection overlay branch

**Conclusion:** `editingAnnotationIndex` is ALREADY wired into `SVGAnnotationLayer` as a parent prop. No parent-side changes needed.

**For Plan 13-01:**
- Add `editingAnnotationIndex` to the hover-intent effect's dep array: `[selectedIds, setRotInputVisibleDbg, editingAnnotationIndex]`
- Add edit-mode gate at effect-top: `if (editingAnnotationIndex != null) return;` (with timer cleanup)
- Zero prop drilling — `editingAnnotationIndex` is already in scope at `:213` because it's a parent prop of `SVGAnnotationLayer`

**For Plan 13-02:**
- `isBeingEditedNow` is already computed at `:1049` (local variable)
- Pass `isBeingEditedNow` as the new `isEditing` prop to `SVGSelectionOverlay` at `:1229-1237` call site
- `SVGSelectionOverlay` receives `isEditing` as a new prop (default `false`)
- Zero prop drilling beyond the direct parent-to-child line already in place

**Confidence:** HIGH.

### Question 7 — Regression surface (113 v2.1 Playwright / unit tests)

**Inventory of the 113 "Playwright tests" referenced in CONTEXT.md:**

After direct inspection, the "113 tests" mentioned throughout the documentation is actually the **`node:test` unit test suite**, NOT Playwright. The `tests/*.test.mjs` count breaks down as:

| File | Cases | Path |
|------|-------|------|
| `visual-diff.test.mjs` | 9 | `tests/visual-diff.test.mjs` |
| `anomaly-detector.test.mjs` | 10 | `tests/anomaly-detector.test.mjs` |
| `timeline-merger.test.mjs` | 5 | `tests/timeline-merger.test.mjs` |
| `zoomController.test.mjs` | 7 | `tests/zoomController.test.mjs` |
| `excelSyncDirtyState.test.mjs` | 5 | `tests/excelSyncDirtyState.test.mjs` |
| `pdfAnnotationImporter.test.mjs` | 10 | `tests/pdfAnnotationImporter.test.mjs` |
| `timeline-writer.test.mjs` | 8 | `tests/timeline-writer.test.mjs` |
| `svgTransformMath.test.mjs` | 10 | `tests/svgTransformMath.test.mjs` |
| `annotationVisibilityRules.test.mjs` | 15 | `tests/annotationVisibilityRules.test.mjs` |
| `rotationInputHelpers.test.mjs` | 34 | `tests/rotationInputHelpers.test.mjs` |
| **Total** | **113** | |

Run command: `npm test` → `node --test tests/*.test.mjs`

**Playwright suite (separate, NOT the 113):** `debug/scenarios/*.spec.mjs` — 8 files (`zoom-flicker`, `overlay-attachment`, `readiness-signals`, `pal-zoom`, `bridge-snapshot`, `zoom-handler`, `render-loop`, `smoke`). Run command: `npm run test:debug`. Targeted at zoom/overlay/viewer smoke, not rotation-handle interactions.

**What these 113 tests cover for Phase 13 relevance:**

| Test file | Relevance to Plan 13-01 | Relevance to Plan 13-02 |
|-----------|-------------------------|-------------------------|
| `rotationInputHelpers.test.mjs` (34) | **Indirect** — tests `normalizeTypedDegrees`, pill position math, constant-radius extension. Does NOT test event delegation or hover-intent state machine. Green after Phase 13 is table-stakes, not a regression signal for the bug class Plan 13-01 fixes. | Not relevant — pure math tests |
| `svgTransformMath.test.mjs` (10) | Not relevant — tests pure `snapAngleToNearest45` + cursor math | Not relevant |
| `zoomController.test.mjs` (7) | Not relevant | Not relevant |
| All others (62 across 7 files) | Not relevant to rotation handle at all | Not relevant |

**Conclusion:** **Zero unit tests exercise event delegation, hover-intent, or edit-mode mtr visibility.** The 113-test pass is a table-stakes regression shield (prove nothing ELSE broke), not a signal that EDIT-13 or EDIT-14 actually works. **UAT is the only validation path for Phase 13 requirements** — hence the 24-cell / 8-cell grid from CONTEXT.md.

**Risk of delegation predicate error:** No unit test catches it. Detection is purely via UAT grid + `console.count` probe + user hover verification. This is acceptable per CONTEXT.md locked decision: "Adding jsdom unit tests for event delegation requires a jsdom-compatible SVG ancestor mock that the current test harness doesn't provide — the test infrastructure cost exceeds the regression protection benefit for a 2-plan surgical phase."

**Confidence:** HIGH — test counts verified via grep.

### Question 8 — `console.count` probe (optimistic-paint invariant)

**Markers:** grep for `SIDE EFFECT` / `drag-wins invariant`:

- `src/hooks/useSVGInteraction.js:809` — "This helper exposes the same optimistic-paint pattern to the typed-commit"
- `src/hooks/useSVGInteraction.js:823` — "SIDE EFFECT (drag-wins invariant — read before refactoring):"

**Invariant documented at `useSVGInteraction.js:823-833`:**

> Setting `visualTransform.rotate` causes `SVGAnnotationLayer.jsx:319`'s derived `isRotating = !!(visualTransform?.rotate)` to become true, which makes `RotationInputField.jsx:312-320`'s drag-wins sync useEffect overwrite `input.value = String(Math.round(angle))`. This is currently a no-op because `liveRotationAngle` (`SVGAnnotationLayer.jsx:330`) reads from `visualTransform.rotate.angle`, so the overwrite value equals the committed value. Do NOT decouple `liveRotationAngle` from `visualTransform.rotate` without revisiting `RotationInputField`'s sync useEffect at lines 312-320 — the no-op becomes a destructive overwrite the moment those two values diverge.

**Applied to Plan 13-01:** During a 2-second drag-rotate, `visualTransform` ticks at 60fps. If the hover-intent effect dep array includes `visualTransform`, the effect tears down and re-attaches listeners 60+ times — eating pointer events AND firing effect body 60+ times.

**Probe verification command (paste into DevTools):**

```js
// Place AT TOP of hover-intent useEffect body during Plan 13-01 implementation:
//   console.count('[EDIT-13] hover-intent effect run');
// Then perform a 2-second drag-rotate on any shape.
// Expected count: ≤3 (initial mount + possibly 1-2 selection changes).
// FAILURE: ≥60 → dep array has tick-rate value, load-bearing invariant broken.
```

**Plan 13-01 preserves invariant because:**
- Dep array stays `[selectedIds, setRotInputVisibleDbg, editingAnnotationIndex]` — none of these tick at 60fps during a drag-rotate
- `selectedIds` is stable across drag (set from `useSVGInteraction`, doesn't change mid-drag)
- `editingAnnotationIndex` is stable (drag happens in select mode, edit state doesn't flip)
- `setRotInputVisibleDbg` is a `useCallback` with stable reference (wrapped `useCallback` at `:176`)

**Gate:** Before committing Plan 13-01, executor MUST run a manual console.count probe: drag-rotate any shape for 2 seconds, observe the count, verify ≤3. If ≥60, STOP — the delegation rewrite inadvertently added a tick-rate dep.

**Confidence:** HIGH.

### Question 9 — Validation Architecture → 13-VALIDATION.md mapping

See the **Validation Architecture** section above for the formal table. The EDIT-13 24-cell and EDIT-14 8-cell grids from CONTEXT.md map one-to-one to test cells. No expansion.

**Sufficient evidence per AC (hierarchy):**

| AC | Minimum sufficient evidence |
|----|-----------------------------|
| EDIT-13 `24 cells × pill appears ≤150ms` | User-reported "appeared within hover window" per cell; re-run on failing cells |
| EDIT-13 `console.count ≤3 over 2s drag-rotate` | Single DevTools Console output pasted back to plan notes |
| EDIT-13 `edit-mode gate` | User verifies pill does NOT arm while editing (single cell) |
| EDIT-13 `no regression` | `npm test` exit 0 + `113 passing` in stdout |
| EDIT-13 `Plan 12-02 focus-loss scenarios` | User re-runs 7 focus-loss scenarios (Tab, click-out, Arrow nudge, Enter, hover during drag, Shift, blur) |
| EDIT-14 `8 cells × mtr fully visible` | User-reported "full circle + connector + icon visible" per cell; screenshot on borderline cases |
| EDIT-14 `border-flush angle=0 baseline` | User enters edit mode on angle=0 rect, confirms no SVG chrome (short-circuit still fires) |
| EDIT-14 `visual-only (no interaction)` | User hovers mtr during edit, confirms pill does NOT arm AND drag does nothing |
| EDIT-14 `counter branch untouched` | `git diff` on `:1052-1099` shows zero modifications + user counter smoke test |
| EDIT-14 `diagnostic identifies clipper` | Markdown table output pasted into plan notes with `CLIPS=YES` rows flagged |
| BOTH `zero counter-session files` | `git show --stat <commit>` greps clean against 7-file allowlist |

**Evidence dependencies (what must exist before advancing):**

- Wave 0 — `npm test` must be green on HEAD before either plan starts (baseline proof)
- Wave 1 of Plan 13-02 — diagnostic output MUST exist and be interpreted before Wave 2 coding begins
- Wave N of both plans — `git status` cross-check MUST be clean before `git commit`

### Question 10 — Commit boundary enforcement

**Counter-session 7-file allowlist (NEVER stage):**
```
src/App.jsx
src/components/PageAnnotationLayer.jsx
src/components/FabricEditCanvas.jsx
src/hooks/useDatabase.js
src/utils/counterNumbering.js
src/utils/svgAnnotationRenderers.jsx
dist/index.html
```

**Standard pre-commit protocol (executor runs BEFORE every `git commit` in Phase 13):**

```bash
# 1. Show the current status — verify no surprise files are staged
git status --short

# 2. Verify NO forbidden files are currently staged. If ANY appear, unstage:
git diff --cached --name-only | \
  grep -E '^(src/App\.jsx|src/components/PageAnnotationLayer\.jsx|src/components/FabricEditCanvas\.jsx|src/hooks/useDatabase\.js|src/utils/counterNumbering\.js|src/utils/svgAnnotationRenderers\.jsx|dist/index\.html)$' \
  && echo "ERROR: counter-session file staged — unstage before committing" \
  || echo "OK: no counter-session files staged"

# 3. If any counter-session files snuck in (step 2 printed ERROR):
git reset HEAD src/App.jsx src/components/PageAnnotationLayer.jsx src/components/FabricEditCanvas.jsx src/hooks/useDatabase.js src/utils/counterNumbering.js src/utils/svgAnnotationRenderers.jsx dist/index.html 2>/dev/null
# Re-run step 2 to confirm clean

# 4. Stage ONLY the Phase 13 files explicitly (NEVER `git add -A` or `git add .`):
# Plan 13-01:
git add src/components/SVGAnnotationLayer.jsx
# Plan 13-02:
git add src/components/SVGAnnotationLayer.jsx src/components/SVGSelectionOverlay.jsx

# 5. Final sanity check:
git diff --cached --name-only
# Should print ONLY `src/components/SVGAnnotationLayer.jsx` (Plan 13-01)
# or both SVGAnnotationLayer + SVGSelectionOverlay (Plan 13-02).

# 6. Commit:
git commit -m "fix(13-01): EDIT-13 hover pill re-arms via event delegation"
# or
git commit -m "fix(13-02): EDIT-14 mtr handle visible on pre-rotated edit entry"

# 7. Post-commit verify:
git show --stat HEAD
# Same file list as step 5.
```

**Hard rules:**
- **NEVER** use `git add -A` or `git add .` for Phase 13 commits
- **ALWAYS** use explicit file paths
- **ALWAYS** run `git status --short` before commit
- **ALWAYS** run `git show --stat HEAD` after commit to verify
- If GSD commit tool is used: pass `--files` argument explicitly: `--files src/components/SVGAnnotationLayer.jsx` (single file for 13-01) or `--files src/components/SVGAnnotationLayer.jsx,src/components/SVGSelectionOverlay.jsx` (two files for 13-02)

**Pre-existing unstaged state caveat:**

From the `gitStatus` in the environment context at session start:
```
M dist/index.html
M src/App.jsx
M src/PageAnnotationLayer.jsx
M src/components/FabricEditCanvas.jsx
M src/hooks/useDatabase.js
M src/utils/counterNumbering.js
M src/utils/svgAnnotationRenderers.jsx
```

**6 of the 7 counter-session files already have uncommitted modifications at session start** (only `src/components/PageAnnotationLayer.jsx` — note this is different from `src/PageAnnotationLayer.jsx` which IS in the status — may need verification of the allowlist path format). Planner MUST instruct executor: these files are in counter-session working state. Leave them untouched. Do not stash. Do not reset. Do not add to any Phase 13 commit.

**Note on path confusion:** CONTEXT.md's allowlist includes `src/components/PageAnnotationLayer.jsx` — the git status shows `src/PageAnnotationLayer.jsx` as modified. These are two separate files. The allowlist file (`src/components/PageAnnotationLayer.jsx`) is the ~9,858-line PAL and is CLAUDE.md-protected. The status-modified file (`src/PageAnnotationLayer.jsx`) is the thin region-polygon wrapper mentioned in CONTEXT.md `do_not_change` as "unrelated to rotation" — still out of scope for Phase 13. Both are out of scope.

**Confidence:** HIGH — direct `git status` inspection at session start.

## Sources

### Primary (HIGH confidence)

- **Source inspection (direct file reads):**
  - `src/components/SVGAnnotationLayer.jsx` — hover-intent effect `:213-313`, short-circuit `:1030-1050`, selection overlay render at `:1229-1237`, svg root `:1009`
  - `src/components/SVGSelectionOverlay.jsx` — mtr group `:167-206`, surrounding transform `:62-66`, destructured props `:20-28`
  - `src/hooks/useSVGInteraction.js` — optimistic-paint pattern + SIDE EFFECT marker `:809, 823-855`, rotate branch (referenced by CONTEXT.md :391-408, :559-568)
  - `src/utils/svgBoundingBox.js` — `getAnnotationBBox` angle propagation `:205, 239, 312, 323, 333, 351, 362`
  - `src/components/FabricEditCanvas.jsx` — container refs `:2307-2309`, no `data-fabric-edit-container` attribute
  - `package.json` — `"test": "node --test tests/*.test.mjs"` script
  - `tests/*.test.mjs` count verification — 113 total across 10 files
  - `debug/playwright.config.mjs` — Playwright config (separate suite, not Phase 13's gate)
  - `.planning/config.json` — `workflow.nyquist_validation: true`
- **Phase 13 CONTEXT.md** — locked decisions for both plans, UAT grids, out-of-scope items
- **Milestone v2.2 research:**
  - `.planning/research/SUMMARY.md` — synthesizer verdicts (Strategy B, Fix A / Option C, Gap 2 defer)
  - `.planning/research/ARCHITECTURE.md` — Fix A / Option C rationale, integration points, clipper hypothesis
  - `.planning/research/PITFALLS.md` — Pitfall 1 (dep-array expansion), 2 (MutationObserver), 4a (overflow:hidden wild goose chase), 4b (short-circuit deletion), 7 (optimistic-paint break), 8 (counter-session staging), 10 (querySelector in render/useMemo)
- **Phase 12 VERIFICATION.md** — open polish gaps documentation for EDIT-13 / EDIT-14 carry-forward, v2.1 113-test baseline confirmed green
- **DOM Level 3 Events spec** — pointerover/pointerout bubble; pointerenter/pointerleave do not

### Secondary (MEDIUM confidence)

- **Project CLAUDE.md** — Always Protected file list, counter-aware sizing rule, 2026-04-10 rasterizer gotcha
- **Plan 12-02 hover-intent effect archaeology** — 7-round focus-loss scenarios, Round 7 activeElement guard fix (confirmed via CONTEXT.md canonical_refs + VERIFICATION.md artifacts table)

### Tertiary (LOW confidence)

- None. All claims trace to either direct source inspection or Phase 13 locked decisions.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps, existing React + DOM events + node:test all present and working
- Architecture: HIGH — both patterns (delegation + isEditing branch) are direct applications of well-known DOM / React idioms to this specific file pair, and both follow the locked strategy from CONTEXT.md
- Pitfalls: HIGH — inherited from comprehensive PITFALLS.md research + direct source inspection at every cited line number
- Open questions: HIGH — all 10 questions answered with verbatim source quotes, ready-to-paste diagnostic script, and verified ancestor check script
- Validation architecture: HIGH — `npm test` is 2 seconds, 113 cases, runs on every machine with Node; UAT grids mapped one-to-one to ACs

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (30 days for a stable code path; diagnostic script MAY need revision if the Syncfusion viewer version or page-div class name changes, but those are not expected in the Phase 13 window)
