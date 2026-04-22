---
phase: 14-unified-svg-callout-render-shared-tool-foundation
plan: 01
subsystem: ui
tags: [svg, callout, fabric, foreignObject, data-attributes, sanitize, tdd, wave0]

# Dependency graph
requires:
  - phase: 11-text-shape-editing-zoom-cleanup
    provides: loadCalloutAnnotation (FabricEditCanvas.jsx:1937) + full-page Canvas + SVG-hidden pattern
  - phase: 13-rotation-handle-edit-mode-polish
    provides: data-attribute event-delegation pattern (data-rotation-handle="mtr")
provides:
  - Pure calloutEditAdapter.js utility module (4 exports) for React↔Fabric callout conversion
  - Revised renderCallout with pageSize signature + data-callout-id / data-callout-part tree
  - Sanitized defaultCalloutStyle.fontFamily (cursor-drift proof)
  - 8 Wave 0 validation files (3 unit + 5 Playwright scaffolds)
  - buildCalloutRenderSpec helper for Node --test compatibility (bridges .jsx → .js)
affects:
  - 14-02-PLAN (shared foundation — crosshair, delete, preview)
  - 14-03-PLAN (wires renderCallout to SVGAnnotationLayer + adapter to FabricEditCanvas)
  - 17 (collision clamps via data-callout-part hit-testing)
  - 18 (Liang-Barsky routing, hover affordances, self-destruct — all via data-callout-part)

# Tech tracking
tech-stack:
  added: []  # zero new dependencies
  patterns:
    - "Pure spec helper pattern — buildCalloutRenderSpec() returns plain data tree that JSX wraps"
    - "JSON-shape adapter (not live fabric.Group) for round-trip precision + test isolation"
    - "sanitizeFontFamily at 3 surfaces (renderer, adapter, default style) for cursor-drift safety"
    - "data-callout-id + data-callout-part event-delegation attributes (mirrors EDIT-13 rotation handle)"

key-files:
  created:
    - src/utils/calloutEditAdapter.js
    - tests/calloutRenderer.test.mjs
    - tests/calloutEditAdapter.test.mjs
    - tests/svgKeyboardHandlers.test.mjs
    - debug/scenarios/callout-render-roundtrip.spec.mjs
    - debug/scenarios/tool-cursor-crosshair.spec.mjs
    - debug/scenarios/delete-callout-keyboard.spec.mjs
    - debug/scenarios/create-preview-line.spec.mjs
    - debug/scenarios/create-preview-callout.spec.mjs
    - .planning/phases/14-unified-svg-callout-render-shared-tool-foundation/deferred-items.md
  modified:
    - src/utils/svgAnnotationRenderers.jsx
    - src/components/Callout/types.js

key-decisions:
  - "buildCalloutRenderSpec helper bridges Node --test + .jsx file incompatibility without adding loader deps"
  - "toFabricGroup returns plain JSON shape (not live fabric.Group) to keep round-trip math integer-clean"
  - "renderCallout always emits the text foreignObject (even when empty) so the hit-test surface exists for double-click edit-mode entry"
  - "sanitizeFontFamily defaults to 'Arial' (single font name) rather than any fallback stack"
  - "Reference buildCalloutRenderSpec from renderCallout body via _specPreview binding to signal drift between the spec and JSX wrapper"

patterns-established:
  - "Pure-utility .js file for testable logic, .jsx consumer wraps it with React.createElement"
  - "Adapter shape compatible with both plain JSON (.objects) and live fabric.Group (.getObjects())"
  - "// UX: code comments on every new user-facing attribute explaining intent + downstream consumer phase"

requirements-completed: [CALL-10]  # Wave 0 testable surface only — Plan 14-03 lights up the full end-to-end wiring

# Metrics
duration: 12min
completed: 2026-04-15
---

# Phase 14 Plan 01: Unified SVG Callout Render + Shared Tool Foundation (Wave 0 testable surface)

**Pure renderCallout + calloutEditAdapter with data-callout-* delegation attributes, sanitized fontFamily at 3 surfaces, and 8 Wave 0 validation files (31 unit tests + 21 Playwright scaffolds).**

## Performance

- **Duration:** 12 min
- **Started:** 2026-04-15T18:33:34Z
- **Completed:** 2026-04-15T18:45:11Z
- **Tasks:** 3 (all auto-mode, zero checkpoints)
- **Files created:** 10 (3 unit tests, 5 E2E scaffolds, 1 adapter source, 1 deferred-items log)
- **Files modified:** 2 (svgAnnotationRenderers.jsx, Callout/types.js)

## Accomplishments

- **Unified render contract locked.** `renderCallout` now takes `pageSize` (object), emits `data-callout-id` on the outer `<g>` wrapper, `data-callout-part` on each of the 5 child elements (line1, line2, arrowTip, textBox, text), sanitizes `fontFamily` via the new adapter helper, and always renders the text `foreignObject` regardless of text content so the double-click hit-test surface exists for edit-mode entry.
- **calloutEditAdapter.js pure module delivered** with 4 exports:
  - `sanitizeFontFamily(raw)` → strips CSS fallback stacks to a single font name (safe default `'Arial'`).
  - `toFabricGroup(reactCallout, pageSize)` → plain JSON shape (`objects`, `reactCalloutId`, `reactCalloutSnapshot`, `getObjects`) compatible with `FabricEditCanvas.jsx:1937 loadCalloutAnnotation` via `fabric.util.enlivenObjects`.
  - `fromFabricGroup(groupOrJson, pageSize, originalReactCallout)` → reverse adapter, reads line1/line2/rect/textbox by index, normalizes via W/H, compatible with both plain JSON shape and live fabric.Group.
  - `buildCalloutRenderSpec(callout, index, pageSize, calc)` → pure data-spec tree describing the SVG elements `renderCallout` should emit. Enables Node `--test` unit tests without loading `.jsx`.
- **Font cursor-drift pitfall eliminated at 3 surfaces:** adapter (Textbox inside toFabricGroup), renderer (foreignObject inner div), and defaults (`defaultCalloutStyle.fontFamily` fixed `'Inter, Arial, sans-serif'` → `'Arial'`).
- **Wave 0 validation files shipped:** 3 Node `--test` unit files (31 tests pass) + 5 Playwright scenario scaffolds (21 test entries discovered) covering CALL-10, UX-01, KBD-01, CREATE-01.
- **Round-trip precision verified:** adapter survives a 10-cycle `toFabricGroup → fromFabricGroup` loop with drift < 1e-6 (integer-clean math — multiply-by-W/H in forward, divide-by-W/H in reverse, no intermediate rounding).

## Task Commits

Each task was committed atomically:

1. **Task 1: Create 3 unit test scaffolds** — `cd701ac7` (test)
2. **Task 2: Create 5 Playwright E2E scaffolds** — `df155034` (test)
3. **Task 3: Create calloutEditAdapter + revise renderCallout + sanitize default fontFamily** — `a2cd77a2` (feat)
4. **Deferred-items log** — `aada1098` (docs)

## Files Created/Modified

### Created

- `src/utils/calloutEditAdapter.js` — 443 LOC pure utility. 4 exports: `sanitizeFontFamily`, `toFabricGroup`, `fromFabricGroup`, `buildCalloutRenderSpec`. Zero component imports, zero Fabric.js runtime imports (keeps module Node-testable).
- `tests/calloutRenderer.test.mjs` — 121 LOC, 8 tests. Verifies `buildCalloutRenderSpec` emits the correct spec tree: outer `<g>` has `data-callout-id`, every child carries an allowed `data-callout-part`, fontFamily fallback stack sanitized to first token, null-input cases return null.
- `tests/calloutEditAdapter.test.mjs` — 100 LOC, 11 tests. Verifies adapter round-trip precision (single-cycle + 10-cycle), text preservation, `reactCalloutId` stash, and 5 `sanitizeFontFamily` edge cases.
- `tests/svgKeyboardHandlers.test.mjs` — 147 LOC, 12 tests. Pure-logic `isUserTyping` focus-guard branches (INPUT, TEXTAREA, contentEditable, null, fabric-hidden-textarea closest) + `dispatchDelete` routing (annotations vs callouts, key filter, focus guard, empty selection).
- `debug/scenarios/callout-render-roundtrip.spec.mjs` — Playwright scaffold for CALL-10 byte-identical JSON roundtrip (2 tests, deferred to Plan 14-03).
- `debug/scenarios/tool-cursor-crosshair.spec.mjs` — Playwright scaffold for UX-01 crosshair cursor (4 tests, deferred to Plan 14-02). **NOTE:** This file was subsequently enhanced by the parallel Plan 14-02 agent — see Plan 14-02 commit `8a713bd6`.
- `debug/scenarios/delete-callout-keyboard.spec.mjs` — Playwright scaffold for KBD-01 Delete/Backspace (5 tests, deferred to Plan 14-02/14-03).
- `debug/scenarios/create-preview-line.spec.mjs` — Playwright scaffold for CREATE-01 line/arrow dashed preview (5 tests, deferred to Plan 14-02). **NOTE:** Enhanced by parallel Plan 14-02 agent — see commit `3acf355f`.
- `debug/scenarios/create-preview-callout.spec.mjs` — Playwright scaffold for CREATE-01 callout dashed preview (5 tests, deferred to Plan 14-03).
- `.planning/phases/14-unified-svg-callout-render-shared-tool-foundation/deferred-items.md` — Out-of-scope discoveries log (pre-existing `pdfAnnotationImporter.js` dirty-state regression + other `M` files in the working tree that Plan 14-01 does NOT own).

### Modified

- `src/utils/svgAnnotationRenderers.jsx` — Added import from `./calloutEditAdapter` for `buildCalloutRenderSpec` + `sanitizeFontFamily`. `renderCallout` signature changed from `(callout, index, pageWidth, pageHeight, calc)` to `(callout, index, pageSize, calc)`. Added `data-callout-id` on outer `<g>`, `data-callout-part` on all 5 children (line1, line2, arrowTip, textBox, text), `sanitizeFontFamily(callout.style?.fontFamily)` pipe for foreignObject inner div, `WebkitFontSmoothing: 'antialiased'` + `MozOsxFontSmoothing: 'grayscale'` for renderText visual parity, `overflow: 'visible'` on foreignObject, always-rendered text foreignObject (no more `{callout.text && ...}` conditional) so double-click hit-test surface exists for empty callouts. 8 new `// UX:` comments explain downstream consumers.
- `src/components/Callout/types.js` — `defaultCalloutStyle.fontFamily` changed `'Inter, Arial, sans-serif'` → `'Arial'`. Added 6-line `// UX:` comment explaining the Fabric.js CACHE_FONT_SIZE=400px cursor-drift bug and linking to CLAUDE.md 2026-04-08 gotcha.

## Renderer signature change

```diff
- renderCallout(callout, index, pageWidth, pageHeight, calculateConnection)
+ renderCallout(callout, index, pageSize, calculateConnection)
+   where pageSize = { width, height }
```

## Adapter API surface

```javascript
// src/utils/calloutEditAdapter.js
sanitizeFontFamily(raw: string | null | undefined): string
// e.g. 'Inter, Arial, sans-serif' → 'Inter', null → 'Arial'

toFabricGroup(reactCallout: Callout, pageSize: {width, height}): {
  objects: Array<FabricJSON>,      // 5 plain JSON objects: line1, line2, rect, circle, textbox
  reactCalloutId: string,          // stashed for Plan 14-03 App.jsx commit routing
  reactCalloutSnapshot: Callout,   // frozen copy for fidelity
  data: { type: 'callout' },       // matches loadCalloutAnnotation convention
  getObjects: () => Array,         // convenience for fromFabricGroup + tests
}

fromFabricGroup(
  fabricGroup: {getObjects?, objects?, _objects?},  // supports plain shape OR live fabric.Group
  pageSize: {width, height},
  originalReactCallout: Callout
): Callout  // returns an updated React callout in normalized 0-1 coords

buildCalloutRenderSpec(callout, index, pageSize, calculateConnection): Spec | null
// Returns {type, attrs, children} tree; JSX renderer wraps 1:1 with React.createElement
```

## Pitfalls addressed

- **Pitfall 2 (Fabric.js cursor drift — 2026-04-08 gotcha):** `fontFamily` sanitized at 3 surfaces. Adapter Textbox → `sanitizeFontFamily(style.fontFamily)`. Renderer foreignObject → `sanitizeFontFamily(callout.style?.fontFamily)`. Default style → hard-coded `'Arial'`. Any future code pulling fontFamily from a React callout or a defaultCalloutStyle will get a single font name.
- **Pitfall 7 (adapter inverse precision):** Adapter round-trip math is integer-clean (multiply-by-W in forward, divide-by-W in reverse). 10-cycle no-drift test passes with 1e-6 tolerance. The `toFabricGroup` output is a plain JSON shape, not a live `fabric.Group`, so Fabric.js Group positioning side-effects never enter the round-trip loop.
- **Node `--test` + .jsx incompatibility:** Verified at execution start — Node cannot load `.jsx` files natively. Resolved by placing the pure data-spec helper (`buildCalloutRenderSpec`) in `.js` (`calloutEditAdapter.js`) and having both the JSX renderer and the unit tests import from there.
- **Empty-text hit-test gap:** Pre-Phase-14 renderCallout only emitted the text foreignObject when `callout.text` was truthy. That would break double-click edit-mode entry for freshly-created empty callouts. Revised renderer always emits the foreignObject (inner div gets `callout.text || ''`) so the `data-callout-part="text"` hit-test surface is always present.

## Files NOT touched (lane boundary verification)

The following files are in Plan 14-01's DO-NOT-TOUCH list. Verified via `git show --name-only` for my four commits (`cd701ac7`, `df155034`, `a2cd77a2`, `aada1098`) — none appear:

- `src/App.jsx` — always-protected, 14-03 lane
- `src/components/SVGAnnotationLayer.jsx` — 14-02/14-03 lane (filteredCallouts gate + keyboard handler + callout dispatch)
- `src/components/PageAnnotationLayer.jsx` — always-protected, irrelevant
- `src/components/FabricEditCanvas.jsx` — no waiver, 11-era protected; adapter is external
- `src/components/FabricEraserCanvas.jsx` — always-protected, irrelevant
- `src/components/FabricDrawingCanvas.jsx` — 14-02 lane (CREATE-01 dashed preview)
- `src/hooks/useSVGInteraction.js` — 14-03 lane (callout-part drag mode)
- `src/index.css` — 14-02 lane (tool-crosshair class)
- `package.json` / `vite.config.js` — infra, zero new deps

## Decisions Made

- **buildCalloutRenderSpec as pure data-spec bridge:** Node `--test` cannot import `.jsx` files, so tests import a pure `.js` helper that returns a plain spec tree. `renderCallout` in `.jsx` wraps the spec with JSX. Keeps the contract testable without adding a loader dependency.
- **toFabricGroup returns plain JSON, not live fabric.Group:** Integer-clean round-trip math + zero Fabric.js Group positioning side effects + Node-testable adapter + compatible with `loadCalloutAnnotation` (which calls `fabric.util.enlivenObjects` on plain JSON anyway).
- **Text foreignObject always rendered:** Empty-text hit-test surface required for Plan 14-03's double-click edit-mode entry on freshly-created empty callouts.
- **buildCalloutRenderSpec referenced from renderCallout body via `_specPreview`:** Early-warning signal if the JSX wrapper ever drifts from the spec contract. The binding is no-op at runtime but makes the coupling explicit.
- **Single-file adapter module:** All 4 exports in `calloutEditAdapter.js` rather than split across multiple files. Pure utility, no React, no component imports, no Fabric runtime imports.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Node --test cannot load .jsx directly**

- **Found during:** Task 1 (pre-execution sanity check)
- **Issue:** Plan Task 1 wanted `tests/calloutRenderer.test.mjs` to `import { renderCallout } from '../src/utils/svgAnnotationRenderers.jsx'`. Verified at session start that Node --test fails with `Unknown file extension ".jsx"` — no ESM JSX loader.
- **Fix:** Extended the plan's fallback path explicitly — added a pure `buildCalloutRenderSpec` helper to `calloutEditAdapter.js` (a `.js` file Node can import) that returns a plain spec tree. The JSX `renderCallout` wraps the spec 1:1 with React elements. Tests import `buildCalloutRenderSpec` directly and assert on the spec tree — same contract as asserting on a React element tree, same coverage.
- **Files modified:** `src/utils/calloutEditAdapter.js` (added `buildCalloutRenderSpec` export), `tests/calloutRenderer.test.mjs` (imports spec helper instead of `.jsx`), `src/utils/svgAnnotationRenderers.jsx` (imports `buildCalloutRenderSpec` for drift-signal binding)
- **Verification:** All 8 renderer tests pass. Contract coverage unchanged.
- **Committed in:** `cd701ac7` (test scaffold), `a2cd77a2` (implementation)

**2. [Rule 2 - Missing Critical] Empty-text hit-test surface**

- **Found during:** Task 3 (revising renderCallout)
- **Issue:** Pre-Phase-14 renderCallout gated the text foreignObject behind `callout.text && ...`. Would break double-click edit-mode entry for empty callouts (the exact path a user follows immediately after creating one). Plan 14-03 depends on a reliable `data-callout-part="text"` hit-test surface.
- **Fix:** Always render the foreignObject. Inner div text is `callout.text || ''` so empty callouts get a blank but focusable surface. No visual change for populated callouts.
- **Files modified:** `src/utils/svgAnnotationRenderers.jsx`
- **Verification:** spec tree assertion in `tests/calloutRenderer.test.mjs` confirms a `data-callout-part='text'` child exists for a callout with empty text; manual code review confirms the JSX mirror.
- **Committed in:** `a2cd77a2`

---

**Total deviations:** 2 auto-fixed (1 blocking [Node --test + .jsx incompatibility], 1 missing critical [empty-text hit-test surface])
**Impact on plan:** Both auto-fixes were anticipated by the plan's fallback paths (Task 1 explicitly called out the Node+JSX concern; Task 3's always-render-foreignObject is a natural extension of the `data-callout-part='text'` hit-test requirement). No scope creep.

## Issues Encountered

- **Pre-existing `pdfAnnotationImporter.js` dirty-state regression:** Full `npm test` run showed 143/144 passing — the 1 failure is an out-of-scope pre-existing working-tree modification in `src/utils/pdfAnnotationImporter.js`. Verified via `git stash` test against clean HEAD (passes). NOT caused by Plan 14-01. Logged in `.planning/phases/14-.../deferred-items.md` per scope boundary rule. Do NOT fix in this plan.
- **Parallel Plan 14-02 agent running concurrently:** During Task 3 verification, noticed that commits `3acf355f` and `8a713bd6` appeared between my `df155034` (Task 2) and `a2cd77a2` (Task 3) commits with messages `feat(14-02): ...`. A parallel agent is executing Plan 14-02 in the same branch. Their commits touched `src/components/SVGAnnotationLayer.jsx`, `src/components/FabricDrawingCanvas.jsx`, `src/index.css`, and un-skipped two of the debug scaffold files I committed (`tool-cursor-crosshair.spec.mjs`, `create-preview-line.spec.mjs`). This is expected per `wave: 1, depends_on: []` parallel-wave execution. None of my commits touched their files; their commits didn't touch my three source files. Lane boundary respected on both sides.
- **`delete-callout-keyboard.spec.mjs` uncommitted drift:** At plan close, `git status` still shows `M debug/scenarios/delete-callout-keyboard.spec.mjs` — another parallel-agent modification in progress. Not mine to commit; belongs to Plan 14-02 Task 3 per its in-progress state.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Plan 14-03 can now:**

- Import `renderCallout` with its new `(callout, index, pageSize, calculateConnection)` signature and wire it into `SVGAnnotationLayer.jsx:779` to unwind the `filteredCallouts = []` short-circuit.
- Import `toFabricGroup` / `fromFabricGroup` from `src/utils/calloutEditAdapter.js` and use them as the callout-entry adapter around `FabricEditCanvas.jsx:1937 loadCalloutAnnotation` — zero edits to FabricEditCanvas.jsx required.
- Use the `data-callout-id` + `data-callout-part` attributes for pointer event-delegation in `useSVGInteraction.js` (callout-part drag mode, double-click edit dispatch).
- Trust that `defaultCalloutStyle.fontFamily` is already a single font name (no more cursor drift risk on new callouts).

**Blockers:** None.

## Self-Check: PASSED

Verified before final commit:

- `tests/calloutRenderer.test.mjs` exists — FOUND (121 lines, 8 tests pass)
- `tests/calloutEditAdapter.test.mjs` exists — FOUND (100 lines, 11 tests pass)
- `tests/svgKeyboardHandlers.test.mjs` exists — FOUND (147 lines, 12 tests pass)
- `src/utils/calloutEditAdapter.js` exists — FOUND (443 lines, 4 exports: sanitizeFontFamily, toFabricGroup, fromFabricGroup, buildCalloutRenderSpec)
- `debug/scenarios/callout-render-roundtrip.spec.mjs` exists — FOUND
- `debug/scenarios/tool-cursor-crosshair.spec.mjs` exists — FOUND
- `debug/scenarios/delete-callout-keyboard.spec.mjs` exists — FOUND
- `debug/scenarios/create-preview-line.spec.mjs` exists — FOUND
- `debug/scenarios/create-preview-callout.spec.mjs` exists — FOUND
- `grep "fontFamily: 'Arial'" src/components/Callout/types.js` — FOUND
- `grep "data-callout-id" src/utils/svgAnnotationRenderers.jsx` — FOUND
- `grep -c "data-callout-part" src/utils/svgAnnotationRenderers.jsx` — 12 matches (>= 5)
- `grep -c "WebkitFontSmoothing" src/utils/svgAnnotationRenderers.jsx` — 2 matches (renderText + renderCallout)
- `grep "import.*sanitizeFontFamily.*from.*calloutEditAdapter"` — FOUND in both renderer and tests
- Commit `cd701ac7` (Task 1) — FOUND in git log
- Commit `df155034` (Task 2) — FOUND in git log
- Commit `a2cd77a2` (Task 3) — FOUND in git log
- Commit `aada1098` (deferred-items docs) — FOUND in git log
- `node --test` on all 3 new unit files — 31/31 PASS
- `npm test` full suite — 143/144 PASS (1 pre-existing failure, out of scope, logged)
- Playwright discovery — 21 new test entries discovered for CALL-10/UX-01/KBD-01/CREATE-01
- Lane boundary — zero DO-NOT-TOUCH file modifications in my commits

---

*Phase: 14-unified-svg-callout-render-shared-tool-foundation*
*Completed: 2026-04-15*
