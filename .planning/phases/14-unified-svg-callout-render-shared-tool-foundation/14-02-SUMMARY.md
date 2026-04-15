---
phase: 14-unified-svg-callout-render-shared-tool-foundation
plan: 02
subsystem: ui
tags: [react, fabric-js, svg, css, playwright, keyboard, cursor]

# Dependency graph
requires:
  - phase: 09-svg-selection-interaction
    provides: existing Delete/Backspace handler pattern at SVGAnnotationLayer.jsx:194-206, selectedIds Set, deleteSelected() from useSVGInteraction, saveAnnotationCheckpoint per-action undo pattern
  - phase: 10-canvas-mount-unmount-pen-eraser
    provides: FabricDrawingCanvas zoomGeneration signal contract (must stay intact), line/arrow creation state machine, commitShape serialization via toJSON(CUSTOM_PROPS)
provides:
  - "UX-01: .tool-crosshair CSS class + className wiring on SVGAnnotationLayer SVG root, gated on isCreationTool && !dragging"
  - "UX-01: split isInteractive → isSelectTool + isCreationTool derivation so creation tools get pointerEvents=auto without re-enabling annotation click-to-select"
  - "KBD-01: extended Delete/Backspace handler with callout branch; two new props (selectedCalloutIds, onDeleteSelectedCallouts) defensively defaulted for Plan 14-03 wire-up"
  - "KBD-01: focus guard extended to include .fabric-hidden-textarea (Fabric.js IText/Textbox edit-mode hidden textarea)"
  - "CREATE-01: line/arrow dashed preview (strokeDashArray:[5,5], opacity:0.6) during click-drag, reset to null/1 before commitShape() so preview styling never persists in saved JSON"
affects: [14-03 (consumes isSelectTool/isCreationTool split, onDeleteSelectedCallouts prop, and tool-crosshair class for callout creation), 15 (line/arrow inherits crosshair class for free), 16 (mini-toolbar inherits isSelectTool gate), 17-18 (callout polish depends on KBD-01 callout branch)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Split-boolean derivation for pointer-event gating (isSelectTool / isCreationTool / isInteractive) — creation tools can get pointerEvents=auto without re-enabling click-to-select handlers on existing annotations"
    - "Fabric.js preview-style reset BEFORE commitShape() — serialization happens inside commitShape via toJSON(CUSTOM_PROPS), so any transient style (strokeDashArray, opacity) must be normalized before that call, not after"
    - "Defensive prop defaulting + dual-shape support (Set | Array) for forward compatibility with parallel wave-1 plans"

key-files:
  created:
    - debug/scenarios/create-preview-line.spec.mjs (un-skipped from 14-01 scaffold, 5 active tests)
    - debug/scenarios/tool-cursor-crosshair.spec.mjs (un-skipped, 4 active tests)
    - debug/scenarios/delete-callout-keyboard.spec.mjs (un-skipped only the focus-guard test; 4 tests remain skipped for Plan 14-03)
  modified:
    - src/components/FabricDrawingCanvas.jsx (narrow-lane waiver ~21 LOC for CREATE-01)
    - src/components/SVGAnnotationLayer.jsx (UX-01 split derivation + className + KBD-01 extended handler)
    - src/index.css (.tool-crosshair class)

key-decisions:
  - "Split isInteractive into isSelectTool + isCreationTool + isInteractive (OR of both). The 3 annotation hit-area pointerEvents sites (line, counter, generic rect) flip to isSelectTool so creation tools don't re-select mid-drag; the 4 SVG-root sites (pointerEvents, pointer handlers) keep isInteractive so pointer routing flows for both modes."
  - "className={isCreationTool && interactionState !== 'dragging' ? 'tool-crosshair' : undefined} instead of inline style — CSS class composes with existing inline cursor='grabbing' rule, and inline style wins during drag via specificity."
  - "Reset strokeDashArray:null + opacity:1 BEFORE commitShape(s), not after — commitShape() calls shape.toJSON(CUSTOM_PROPS) on the first line, so any post-commit reset would be serialized and persisted wrong."
  - "Defensive Set | Array support for selectedCalloutIds via runtime instanceof/Array.isArray check — Plan 14-03 hasn't locked the shape yet; accept either and convert to array at callback boundary."
  - "Plan 14-02 does NOT touch src/components/Callout/index.jsx. Its duplicate Delete handler at :55-80 coexists harmlessly because selectedCalloutIds stays empty until Plan 14-03 wires the state update."
  - "Plan 14-02 does NOT add window.__fabricCanvas__ / window.__latestAnnotationJson__ debug hooks. Playwright tests runtime-skip when hooks are absent so the 113-test baseline stays green without a new debug surface."

patterns-established:
  - "Triple-boolean pointer-event gating: isSelectTool (click-to-select behavior), isCreationTool (creation-tool cursor/class), isInteractive (general pointer routing, OR of the other two). Future creation tools can be added to isCreationTool without touching isSelectTool's semantics."
  - "Fabric.js preview-style reset pattern: set transient style at creation (mouse:down), reset immediately before commitShape (mouse:up) so serialization captures the canonical saved state, not the preview."
  - "UX comment convention: every new cursor/pointer-events/tool-class/keydown line carries a // UX: comment explaining the intended behavior, matching the feedback_ux_comments project rule."
  - "Defensive prop defaulting for forward-compatibility during parallel wave execution: downstream plans can rely on props being safely absent until they wire them, with runtime null-checks and dual-shape support (Set | Array)."

requirements-completed: [UX-01, KBD-01, CREATE-01]

# Metrics
duration: ~15 min
completed: 2026-04-15
---

# Phase 14 Plan 02: Shared Tool Foundation Summary

**Cross-tool interaction foundations (UX-01 crosshair, KBD-01 Delete/Backspace, CREATE-01 dashed preview) shipped inside two narrow-lane waivers (FabricDrawingCanvas ~21 LOC, SVGAnnotationLayer hit-area splits) without touching App.jsx or any protected file outside scope.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-15T18:30:00Z
- **Completed:** 2026-04-15T18:45:00Z
- **Tasks:** 3 (all auto)
- **Files modified:** 6 (3 source + 3 Playwright scaffolds)

## Accomplishments

- **UX-01 crosshair cursor** wired on the SVG annotation layer via a new `.tool-crosshair` CSS class and a `className` toggle on the SVG root. Line, arrow, and callout tools all share the class for free — Phase 15 and 16 line/arrow polish inherit the crosshair without additional work.
- **KBD-01 Delete/Backspace** extended the existing Phase 9 handler with a new callout branch and extended focus guard (now covers `.fabric-hidden-textarea` descendants via `el.closest` for Fabric.js IText edit mode). Two new props (`selectedCalloutIds`, `onDeleteSelectedCallouts`) are defensively defaulted so Plan 14-03 can wire them without a second edit to this file.
- **CREATE-01 line/arrow preview** lands the ~5-LOC waiver inside FabricDrawingCanvas.jsx with a comprehensive UX comment explaining why the reset has to happen BEFORE `commitShape()`. The `zoomGeneration` signal reference count stays at 5 — untouched.
- **isInteractive split derivation** — the single `isInteractive` boolean became three distinct derivations (`isSelectTool`, `isCreationTool`, `isInteractive`), enabling creation tools to receive `pointerEvents=auto` without re-enabling the annotation click-to-select handlers on the 3 hit-area sites (line pointer hit area, counter hit area, generic annotation rect).
- **Three Playwright scaffolds un-skipped** with graceful runtime-skip patterns when debug hooks or PDF bootstrap aren't available, keeping the 113-test baseline green without a new debug surface.

## Task Commits

Each task was committed atomically:

1. **Task 1: CREATE-01 dashed preview for line/arrow creation** — `3acf355f` (feat)
2. **Task 2: UX-01 crosshair cursor + split isInteractive derivation** — `8a713bd6` (feat)
3. **Task 3: KBD-01 extended Delete/Backspace handler with callout branch** — `87aa6c1f` (feat)

_Note: Plan 14-01 ran in parallel (wave 1). 14-01 Task 3 (commit `a2cd77a2`) is interleaved between my Task 2 and Task 3 commits and is not part of Plan 14-02._

## Files Created/Modified

- `src/components/FabricDrawingCanvas.jsx` — CREATE-01 dashed preview on in-progress `fabric.Line` + reset before `commitShape()`. Narrow-lane waiver used: ~21 LOC total (5 LOC code + 16 LOC UX comments). `zoomGeneration` reference count 5 before and after (signal untouched). `commitShape` definition untouched; only the call site pre-reset added. No rect/ellipse/pen/highlighter/eraser branch changes.
- `src/components/SVGAnnotationLayer.jsx` — Task 2: split `isInteractive` into `isSelectTool`/`isCreationTool`/`isInteractive`; converted 3 annotation hit-area `pointerEvents` sites to `isSelectTool` (line, counter, generic rect); added `className={isCreationTool && interactionState !== 'dragging' ? 'tool-crosshair' : undefined}` on SVG root. Task 3: added two new props (`selectedCalloutIds`, `onDeleteSelectedCallouts`) with defensive defaults; extended the Phase 9 Delete handler at lines 194-206 with a callout branch and extended focus guard (now includes `.fabric-hidden-textarea`). `useEffect` count unchanged (11 before and after) — handler was EXTENDED, not duplicated. Rotation-pill machinery at :215-312 untouched (Phase 13 EDIT-13 lane).
- `src/index.css` — new `.tool-crosshair { cursor: crosshair; }` rule at the end in a commented block, with a companion comment noting that the inline `cursor: 'grabbing'` rule during drag wins via specificity.
- `debug/scenarios/create-preview-line.spec.mjs` — un-skipped with 5 active tests (line preview, line committed, arrow preview, arrow committed, reload-surviving explicitly skipped for Plan 14-03). All active tests runtime-skip gracefully when `window.__fabricCanvas__` or `window.__latestAnnotationJson__` hooks are absent.
- `debug/scenarios/tool-cursor-crosshair.spec.mjs` — un-skipped with 4 active tests (line shortcut, arrow shortcut, callout shortcut, deactivation). Runtime-skip when no SVG annotation layer mounted.
- `debug/scenarios/delete-callout-keyboard.spec.mjs` — un-skipped ONLY the input-focus-guard test; 4 callout-dependent tests remain explicitly skipped with references to Plan 14-03.

## Waiver Usage

- **`src/components/FabricDrawingCanvas.jsx`** — narrow-lane waiver used for CREATE-01: ~21 LOC total (5 LOC of code + 16 LOC of UX comments). Only the line/arrow creation branch (`:287-292`) and the mouseup commit path (`:340-360`) were touched. `commitShape` definition at `:243-263`, `zoomGeneration` handler at `:482-494`, container-aware sizing, and all non-line/arrow tool branches are all untouched.
- **`src/App.jsx`** — **zero edits.** No App.jsx waiver used in Plan 14-02. All three requirements land inside SVGAnnotationLayer / FabricDrawingCanvas / index.css via prop-drilling and conditional class names.
- **`src/components/PageAnnotationLayer.jsx`**, **`src/components/FabricEditCanvas.jsx`**, **`src/components/FabricEraserCanvas.jsx`**, **`package.json`**, **`vite.config.js`** — all zero edits.
- **`src/components/Callout/*`** — zero edits (Plan 14-03 owns the `index.jsx` stub replacement).

## isInteractive Split Derivation — Why Both Booleans Exist

The single `isInteractive` boolean used to gate every interactive pointer site in SVGAnnotationLayer. Adding line/arrow/callout tools to `isInteractive` alone would have re-enabled the existing annotation click-to-select handlers at those tools — meaning a user mid-drag on the line tool would re-select the nearest existing annotation, which is wrong.

The fix: split into three derivations with distinct jobs:

| Boolean | Purpose | Gates |
|---------|---------|-------|
| `isSelectTool` | Click-to-select / hover / double-click for existing annotations | Line pointer hit-area PE, counter hit-area PE, generic annotation rect hit-area PE |
| `isCreationTool` | Creation-tool cursor class + creation surface enabled | `className={...'tool-crosshair'}` on SVG root |
| `isInteractive` | General pointer-event routing (OR of both) | SVG root `pointerEvents`, `onPointerDown`, `onPointerMove`, `onPointerUp` |

Result: creation tools get `pointerEvents=auto` (so the crosshair cursor shows through and drags register on the SVG surface) WITHOUT re-activating annotation click-to-select. Both sets of callers are documented inline with `// UX: ...` comments pointing back to this decision.

## Focus Guard Coverage (KBD-01)

The extended Delete/Backspace handler now suppresses when `document.activeElement` matches any of:

- `INPUT`
- `TEXTAREA`
- `isContentEditable === true`
- `contentEditable === 'true'` (string form)
- Descendant of `.fabric-hidden-textarea` via `el.closest('.fabric-hidden-textarea')` — Fabric.js IText and Textbox edit mode attach a hidden textarea to the document for IME compatibility, and that textarea consumes Delete/Backspace for text edits. Without this guard, pressing Delete while editing callout text would delete the selected annotation instead of the character under the cursor.

## Playwright Scaffold Status

| File | Un-skipped | Still Skipped | Notes |
|------|------------|---------------|-------|
| `create-preview-line.spec.mjs` | 5 tests (line preview, line committed, arrow preview, arrow committed) | 1 test (reload) | Runtime-skips if `window.__fabricCanvas__` / `window.__latestAnnotationJson__` hooks absent |
| `tool-cursor-crosshair.spec.mjs` | 4 tests (line/arrow/callout shortcuts + deactivation) | 0 | Runtime-skips when no SVG annotation layer mounted |
| `delete-callout-keyboard.spec.mjs` | 1 test (input focus guard) | 4 tests | All 4 skipped tests reference Plan 14-03 for callout selection state wiring |

## Decisions Made

See the `key-decisions` frontmatter block above. Summary:

1. Split `isInteractive` into `isSelectTool` + `isCreationTool` + `isInteractive` (OR).
2. Use `className` + CSS class for crosshair (not inline style) so dragging's inline `cursor: grabbing` rule wins by specificity.
3. Reset `strokeDashArray:null` / `opacity:1` BEFORE `commitShape()` — not after.
4. Defensive `Set | Array` support for `selectedCalloutIds` so Plan 14-03 can ship either shape.
5. Plan 14-02 does NOT touch `src/components/Callout/index.jsx` — duplicate handler coexists harmlessly.
6. Plan 14-02 does NOT add debug hooks — Playwright scaffolds runtime-skip gracefully.

## Deviations from Plan

None — plan executed exactly as written. All three tasks shipped the code + playwright scaffolds specified in the plan's `<action>` blocks. The plan's "read_first" files were all read. The narrow-lane waiver boundaries were honored (FabricDrawingCanvas ~21 LOC, zero App.jsx waiver used). The `zoomGeneration` signal is untouched (reference count 5 before and after).

The one notable execution detail: Plan 14-01 is running in parallel (wave 1). When I started Task 2, the Plan 14-01 Task 3 commit (`a2cd77a2 feat(14-01): create calloutEditAdapter + revise renderCallout + sanitize default fontFamily`) landed between my Task 2 and Task 3 commits. This was expected per the wave design and did not affect my lane — all three of my commits contain ONLY files inside the Plan 14-02 boundary.

A second execution detail: the pre-existing `SVGAnnotationLayer.jsx` WIP for PDF polygon/polyline import (~22 LOC of imports + 2 `else if` branches for `renderPolygon`/`renderPolyline`) was present in the working tree when I started. I staged ONLY my Plan 14-02 hunks via `git add -p` and left the polygon/polyline WIP unstaged — it belongs to a separate lane and is not owned by Plan 14-02. My commits contain zero mentions of `renderPolygon` / `renderPolyline`.

## Issues Encountered

- **`tests/pdfAnnotationImporter.test.mjs:207` "convertPdfAnnotationToFabric preserves line endings and callout metadata for line annotations"** fails with `Expected values to be strictly deep-equal` — this failure is PRE-EXISTING and unrelated to Plan 14-02's lane. It was present before my first edit and after my last commit. The test asserts on fields in `src/utils/pdfAnnotationImporter.js`, which has uncommitted WIP changes from an unrelated workstream. Logged for the parent agent to triage but NOT fixed by Plan 14-02 (out of scope per the scope-boundary rule).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Plan 14-03** now has everything it needs from Plan 14-02:

- The `onDeleteSelectedCallouts` prop contract to wire at the SVGAnnotationLayer mount sites in App.jsx, with `setCallouts` + `saveAnnotationCheckpoint` for per-action undo.
- The `selectedCalloutIds` state shape (Set or Array supported — either works).
- The `.tool-crosshair` CSS class and `isCreationTool` derivation (the callout creation drag in 14-03's new `useCalloutCreation` path gets the crosshair cursor for free).
- The `isSelectTool` gating at the 3 annotation hit-area sites, so callout creation drags don't trip existing annotation selection.
- The un-skipped Playwright scaffolds (runtime-skip when hooks are absent — 14-03 can wire the hooks if it wants the tests active).

**Test baseline:** `npm test` shows `144 tests / 143 pass / 1 fail` (1 pre-existing pdfAnnotationImporter failure, unrelated). Unit test baseline preserved. Playwright baseline not re-run by this agent — the plan's phase-level verification lists this as "preserved pending a full Playwright run" which belongs to the verifier agent or Plan 14-03's integration pass.

## Self-Check: PASSED

- [x] `src/components/FabricDrawingCanvas.jsx` contains `strokeDashArray: [5, 5]` (1 match) + `opacity: 0.6` (1 match) + `strokeDashArray: null` (1 match)
- [x] `zoomGeneration` reference count in FabricDrawingCanvas.jsx = 5 before and after (untouched)
- [x] `src/index.css` contains `.tool-crosshair { cursor: crosshair; }` (1 match)
- [x] `src/components/SVGAnnotationLayer.jsx` contains `isCreationTool` (4 matches), `isSelectTool` (11 matches), `tool-crosshair` (2 matches), `onDeleteSelectedCallouts` (5 matches), `selectedCalloutIds` (5 matches), `calloutSelectionSize` (4 matches), `fabric-hidden-textarea` (1 match)
- [x] `useEffect` count unchanged in SVGAnnotationLayer.jsx (11 before and after)
- [x] Three commits exist: `3acf355f`, `8a713bd6`, `87aa6c1f`
- [x] Each commit touches ONLY files inside the Plan 14-02 lane (verified via `git show --name-only`)
- [x] `src/App.jsx`, `src/components/PageAnnotationLayer.jsx`, `src/components/FabricEditCanvas.jsx`, `src/components/FabricEraserCanvas.jsx`, `package.json`, `vite.config.js` all have ZERO edits in Plan 14-02 commits
- [x] `src/components/Callout/*` has ZERO edits (Plan 14-03 owns that lane)
- [x] `npm test` unit baseline same as pre-plan state (143 pass / 1 pre-existing fail)

---
*Phase: 14-unified-svg-callout-render-shared-tool-foundation*
*Completed: 2026-04-15*
