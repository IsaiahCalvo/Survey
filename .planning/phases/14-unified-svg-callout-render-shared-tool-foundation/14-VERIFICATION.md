---
phase: 14-unified-svg-callout-render-shared-tool-foundation
verified: 2026-04-15T19:30:00Z
status: human_needed
score: 4/4 requirements verified (static analysis)
human_verification:
  - test: "Callout renders in SVG after Phase 14"
    expected: "Open Page 6 of 'Package 2 - Rev 4 -- IC.pdf'. Any existing callout must appear rendered in the SVG layer (visible text, connector lines, arrowTip circle) — NOT via an HTML overlay. Inspect the DOM: the outer element must be a <g data-callout-id='...'> inside the SVG, with children carrying data-callout-part='line1', 'line2', 'arrowTip', 'textBox', 'text'."
    why_human: "SVG rendering output requires visual inspection in the browser; static analysis confirms the code path is wired but cannot confirm the renderCallout output displays correctly at runtime."

  - test: "Callout creation (Q tool) shows dashed preview and commits"
    expected: "Press Q to activate the callout tool. The SVG surface should show a crosshair cursor. Click-drag on empty PDF space: a dashed (strokeDasharray=5,5) rect + two dashed connector lines + dashed arrowhead polygon at 0.6 opacity should follow the pointer in real time. On mouse-up, the preview disappears and a solid callout appears in its place."
    why_human: "Drag interactions and CSS cursor changes require live browser testing. The creation state machine is wired (calloutCreation state, window-level listeners, preview JSX, onCreateCallout) but the interaction lifecycle can only be confirmed by actual pointer events."

  - test: "Line/arrow creation (L or A tool) shows dashed preview"
    expected: "Press L to activate the line tool. Click-drag on a page: the in-progress line should appear dashed (5,5) at 0.6 opacity. On mouse-up the committed line renders solid. Repeat with A (arrow). Verify that committed annotations do NOT have strokeDashArray in their saved JSON (check via reload)."
    why_human: "Fabric.js canvas rendering and serialization of the preview-reset (strokeDashArray:null before commitShape) can only be confirmed visually and by inspecting the saved annotation JSON."

  - test: "Crosshair cursor during creation tools"
    expected: "With line (L), arrow (A), or callout (Q) tool active and no drag in progress, the SVG annotation surface must show cursor:crosshair. When the tool deactivates (press V / Escape) or a drag starts, the cursor must revert to default/move."
    why_human: "CSS cursor state requires live browser testing. The .tool-crosshair class and isCreationTool derivation are present in code but cursor display is a browser rendering concern."

  - test: "Delete/Backspace removes selected callout with undo support"
    expected: "Select a callout by clicking it. Without any text field focused, press Delete: the callout disappears. Press Cmd+Z: the callout reappears. Verify that pressing Delete while focused in a text input (e.g., the search bar) does NOT delete the callout."
    why_human: "Keyboard event routing, focus-guard behavior, and undo state require live interaction testing. The keydown handler, isUserTyping guard, and handleDeleteSelectedCallouts are wired but firing order and focus state can only be confirmed at runtime."

  - test: "Callout drag — arrowTip, knee, textBox, connector-line (whole-move), Cmd+drag (whole-move)"
    expected: "Select a callout. Drag the arrowTip circle: only the tip moves. Drag the knee handle: only the knee moves. Drag the textbox body: only the box repositions (connector lines redraw). Drag connector line1 or line2: the entire callout moves as a unit. Hold Cmd and drag any part: the entire callout moves."
    why_human: "Drag-mode branching (partType: arrowTip/knee/textBox/whole) and the two whole-move triggers (connector-line + Cmd/Ctrl modifier) can only be verified with actual pointer events in the browser."

  - test: "Double-click callout to enter text edit mode"
    expected: "Double-click a callout's textbox or connector area. FabricEditCanvas should mount at full page dimensions with the SVG annotation layer hidden. The Fabric.js Textbox should be editable. On pressing Escape or clicking outside, edit mode exits and the updated text appears in the SVG callout."
    why_human: "The FabricEditCanvas mount/unmount lifecycle, loadCalloutAnnotation consuming the adapter output, and fromFabricGroup writing back to setCallouts all involve React state transitions and Fabric.js initialization that require live browser testing."

  - test: "No regression on rotation handle, shape edit, pen/eraser, text editing, zoom"
    expected: "Perform the v2.2 baseline UAT on Page 6: select and rotate a shape (rotation pill should appear), double-click a shape to enter edit mode, use pen/eraser, select/edit a text annotation, zoom in/out with all 6 zoom methods. All should behave identically to pre-Phase-14."
    why_human: "The 113-test Playwright baseline is NOT fully active (most callout scaffolds runtime-skip without a PDF loaded). A manual regression pass against the full v2.2 feature set is needed to confirm zero regression, especially around the isSelectTool/isCreationTool split change in SVGAnnotationLayer which touches pointer-event gating for ALL annotations."
---

# Phase 14: Unified SVG Callout Render + Shared Tool Foundation — Verification Report

**Phase Goal:** Move callout rendering onto the SVG pipeline (CALL-10) and land shared tool foundations: crosshair cursor (UX-01), Delete/Backspace delete (KBD-01), dashed creation preview (CREATE-01).
**Verified:** 2026-04-15
**Status:** HUMAN_NEEDED — all static wiring verified; UI behaviors require live browser testing
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Callouts render via SVG `renderCallout` with `data-callout-id` / `data-callout-part` tree and always-rendered `foreignObject` (CALL-10) | VERIFIED | `svgAnnotationRenderers.jsx:516` — new signature `(callout, index, pageSize, calc)`, `data-callout-id` on outer `<g>`, all 5 `data-callout-part` values present, `foreignObject` always emitted (not gated on `callout.text`). `filteredCallouts` short-circuit at SVGAnnotationLayer:1135 is a length-guard (empty array = skip), not the old `return []` blocker. |
| 2 | Crosshair cursor while line/arrow/callout tool active, reverts on deactivation/drag (UX-01) | VERIFIED (wiring) | `SVGAnnotationLayer.jsx:215` — `isCreationTool` derivation covers `'line' || 'arrow' || 'callout'`; `className={(isCreationTool && interactionState !== 'dragging') ? 'tool-crosshair' : undefined}` on SVG root at line 1502; `.tool-crosshair { cursor: crosshair; }` class in `index.css:79`. Runtime cursor display requires human testing. |
| 3 | Delete/Backspace deletes selected line/arrow/callout with undo, focus guard active (KBD-01) | VERIFIED (wiring) | `SVGAnnotationLayer.jsx:280-360` — extended handler checks `isUserTyping()` guard (covers INPUT, TEXTAREA, contentEditable, `.fabric-hidden-textarea`), dispatches to `onDeleteSelectedCallouts` when `calloutSelectionSize > 0`. App.jsx `handleDeleteSelectedCallouts` at line 11114 calls `addHistoryCheckpoint` + `setCallouts.filter` + `setSelectedCalloutIds(new Set())`. Runtime keyboard routing requires human testing. |
| 4 | Dashed preview (strokeDasharray 5,5 / opacity 0.6) during line/arrow/callout creation (CREATE-01) | VERIFIED (wiring) | `FabricDrawingCanvas.jsx:296-300` — `strokeDashArray: [5, 5]`, `opacity: 0.6` set at mousedown, reset to `null`/`1` before `commitShape()` at line 372. `SVGAnnotationLayer.jsx:1543-1560` — transient `<g className="callout-preview" opacity={0.6}>` with dashed rect + 2 lines + polygon. Runtime preview rendering requires human testing. |

**Score: 4/4 truths verified (static analysis)**

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/utils/calloutEditAdapter.js` | 4 exports: sanitizeFontFamily, toFabricGroup, fromFabricGroup, buildCalloutRenderSpec | VERIFIED | 443 LOC, all 4 exports confirmed at lines 50, 75, 182, 257. Round-trip math verified by unit tests (31/31 pass). |
| `src/utils/svgAnnotationRenderers.jsx` | `renderCallout` with `(callout, index, pageSize, calc)` signature + data-attr tree + always-renders foreignObject | VERIFIED | Signature confirmed at line 516. `data-callout-id` on outer `<g>` at line 573. All 5 `data-callout-part` values at lines 579, 591, 602, 612, 632. `foreignObject` always rendered (no `callout.text &&` gate). |
| `src/components/Callout/types.js` | `defaultCalloutStyle.fontFamily: 'Arial'` (single-name, no fallback stack) | VERIFIED | Line 128: `fontFamily: 'Arial'`. Added 6-line UX comment explaining cursor-drift fix. |
| `src/components/Callout/index.jsx` and 4 sibling files | Null-render stubs (~10-25 LOC each), re-exports preserved | VERIFIED | All 5 stubs confirmed: index.jsx=25 LOC (exports createCallout/defaultCalloutStyle/hexToRgba), CalloutCanvas=11, CalloutComponent=11, CalloutContextMenu=10, CalloutEditModal=9. |
| `src/components/SVGAnnotationLayer.jsx` | filteredCallouts gate unwound, crosshair class, KBD-01 handler, callout creation state machine | VERIFIED | `filteredCallouts` useMemo at line 1134 dispatches through `renderCallout` — old `return []` short-circuit replaced. `isCreationTool`/`isSelectTool` split at lines 210-216. Delete handler at 280-360 with callout branch. `calloutCreation` state at line 238. Creation preview JSX at lines 1543-1560. |
| `src/hooks/useSVGInteraction.js` | `'callout-part'` drag mode (4-place invariant), double-click callout dispatch | VERIFIED | `dragStateRef` extended at line 63 with `partType`, `calloutId`, `originalCalloutPositions`. `handleAnnotationDoubleClick` callout branch at line 299 fires `onRequestEditMode(calloutId, 'callout')`. `handleSvgPointerDown` callout hit-test at line 326. `handlePointerMove` `'callout-part'` case at line 599. `handlePointerUp` commit branch at line 842. |
| `src/App.jsx` | selectedCalloutIds state, 5 handlers, adapter imports, save-callback wrapper at 3 FabricEditCanvas sites, prop drilling at 3 SVGAnnotationLayer mounts | VERIFIED | `toFabricGroup`/`fromFabricGroup` imports at line 84. `selectedCalloutIds: Set<string>` state at line 11039. All 5 handlers (handleDeleteSelectedCallouts, handleCreateCallout, handleUpdateCallout, handleUpdateCalloutLive, handleRequestCalloutEditMode) at lines 11114-11204. 3 SVGAnnotationLayer mount sites each have 6 new props confirmed. FabricEditCanvas save-callback wrapper detects `editType === 'callout'` at lines 27068-27079. |
| `src/components/FabricDrawingCanvas.jsx` | `strokeDashArray: [5,5]` + `opacity: 0.6` at preview, reset before commitShape; zoomGeneration signal untouched | VERIFIED | `strokeDashArray: [5, 5]` at line 296, `opacity: 0.6` at line 300, reset `strokeDashArray: null, opacity: 1` at line 372 BEFORE `commitShape(s)` at line 374. `zoomGeneration` reference count = 5 (unchanged per self-check). |
| `src/index.css` | `.tool-crosshair { cursor: crosshair; }` | VERIFIED | Line 79 confirmed. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `SVGAnnotationLayer.filteredCallouts` | `svgAnnotationRenderers.renderCallout` | useMemo calling `renderCallout(callout, i, pageSize, calculateCalloutConnection)` | WIRED | Line 1157. pageSize object `{ width, height }` built at line 1136. |
| `useSVGInteraction.handleAnnotationDoubleClick` | `onRequestEditMode(calloutId, 'callout')` | `e.target.closest('[data-callout-id]')` hit-test | WIRED | Lines 285-299 in useSVGInteraction.js. |
| `App.jsx onRequestEditMode` | `handleRequestCalloutEditMode` | `annotationType === 'callout'` branch at 3 mount sites | WIRED | Lines 26633, 27315 confirmed (3rd mount site has same pattern). |
| `handleRequestCalloutEditMode` | `toFabricGroup` + `setEditingAnnotation` | Builds transient annotations shape | WIRED | Lines 11189-11204 in App.jsx. |
| `FabricEditCanvas onEditCommit` | `fromFabricGroup → setCallouts` | `editingAnnotation.editType === 'callout'` wrapper at line 27068 | WIRED | Lines 27068-27079. |
| `SVGAnnotationLayer keydown` | `onDeleteSelectedCallouts` | `calloutSelectionSize > 0` branch at line 346 | WIRED | Line 346-350 dispatches to `effectiveDeleteCalloutsCallback`. |
| `handleDeleteSelectedCallouts` | `setCallouts.filter` + `addHistoryCheckpoint` | App.jsx callback at line 11114 | WIRED | Lines 11119-11124. |
| `SVGAnnotationLayer calloutCreation pointer-up` | `onCreateCallout` | Min-drag guard at line 400, `createCallout` factory, callback at line 411 | WIRED | Lines 383-411. |
| `FabricDrawingCanvas preview Line` | `strokeDashArray` reset before `commitShape` | `s.set({ strokeDashArray: null, opacity: 1 })` at line 372 before `commitShape(s)` at 374 | WIRED | Order confirmed in source. |

---

### Requirements Coverage

| Requirement | Description | Source Plans | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| CALL-10 | Callout renders via SVG (`<foreignObject>` + HTML-text, replacing HTML-overlay system) | 14-01, 14-03 | SATISFIED | `renderCallout` wired into `filteredCallouts` dispatch, 5 HTML-overlay files stubbed to null renders, `data-callout-id`/`data-callout-part` attrs present. |
| UX-01 | Crosshair cursor while line/arrow/callout tool active, no creation drag in progress | 14-02 | SATISFIED (static) | `isCreationTool` derivation + `.tool-crosshair` CSS class + `className` toggle confirmed. Runtime display needs human test. |
| KBD-01 | Delete/Backspace deletes selected line/arrow/callout with undo; focus guard prevents firing in text inputs | 14-02, 14-03 | SATISFIED (static) | Extended Delete handler wired; `calloutSelectionSize > 0` branch reaches `handleDeleteSelectedCallouts`; `addHistoryCheckpoint` + `setCallouts.filter` confirmed. Focus guard covers INPUT/TEXTAREA/contentEditable/`.fabric-hidden-textarea`. Runtime behavior needs human test. |
| CREATE-01 | Dashed 5,5 preview at 0.6 opacity during creation of line, arrow, callout; preview cleared on mouse-up | 14-02, 14-03 | SATISFIED (static) | FabricDrawingCanvas preview style and reset confirmed. SVGAnnotationLayer callout preview JSX confirmed. Runtime rendering needs human test. |

No orphaned requirements — REQUIREMENTS.md maps CALL-10/UX-01/KBD-01/CREATE-01 to Phase 14 and marks them all Complete.

---

### DO NOT CHANGE Boundary Verification

| Protected File | Waiver Granted | Actual Changes | Verdict |
|----------------|---------------|---------------|---------|
| `src/App.jsx` | Yes — ~10-20 LOC for callout save-callback wrapper + prop drilling | ~180 LOC staged (5 handlers + imports + 3 mount sites + 3 FabricEditCanvas wrappers). Exceeds stated ~10-20 LOC estimate but all changes are within the stated scope (callout save-callback wrapper and prop drilling — no structural rewrites). Pre-existing WIP explicitly excluded via `git add -p`. | BOUNDARY RESPECTED |
| `src/components/PageAnnotationLayer.jsx` | None | Zero changes (confirmed via `git diff HEAD~8..HEAD`) | BOUNDARY RESPECTED |
| `src/components/FabricEditCanvas.jsx` | None | Zero changes (confirmed via `git diff HEAD~8..HEAD`) | BOUNDARY RESPECTED |
| `src/components/FabricEraserCanvas.jsx` | None | Zero changes (confirmed via `git diff HEAD~8..HEAD`) | BOUNDARY RESPECTED |
| `src/components/FabricDrawingCanvas.jsx` | Yes — ~5 LOC for CREATE-01 dashed preview | ~21 LOC total (5 LOC code + 16 LOC UX comments). Code changes within narrow lane. zoomGeneration count = 5 before and after. | BOUNDARY RESPECTED |
| `package.json` / `vite.config.js` | None | Zero changes (confirmed via `git diff HEAD~8..HEAD`) | BOUNDARY RESPECTED |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `svgAnnotationRenderers.jsx` | 565 | Comment uses word "placeholder" for `_specPreview` drift-detection sentinel | Info | Not a real placeholder — intentional design decision (spec/JSX parity signal). No impact. |

No blockers. No stub implementations in new production code paths.

---

### Unit Test Baseline

| Test Suite | Result | Notes |
|------------|--------|-------|
| `tests/calloutRenderer.test.mjs` (8 tests) | 31/31 pass (combined run) | `buildCalloutRenderSpec` spec tree, `data-callout-id`/`data-callout-part`, fontFamily sanitization |
| `tests/calloutEditAdapter.test.mjs` (11 tests) | 31/31 pass (combined run) | Round-trip precision (single + 10-cycle), text preservation, `sanitizeFontFamily` edge cases |
| `tests/svgKeyboardHandlers.test.mjs` (12 tests) | 31/31 pass (combined run) | `isUserTyping` focus-guard branches, `dispatchDelete` routing |
| Full `npm test` suite | 143/144 pass | 1 pre-existing failure in `tests/pdfAnnotationImporter.test.mjs:207` — OUT OF SCOPE per prompt instructions (uncommitted WIP from before this phase, not caused by Phase 14) |

---

### Human Verification Required

The following 8 items require testing on the dev server (http://localhost:5173/) with "Package 2 - Rev 4 -- IC.pdf" open at Page 6.

**1. Callout SVG Rendering (CALL-10)**

**Test:** Open Page 6. Locate an existing callout annotation.
**Expected:** Callout appears rendered as SVG elements — NOT an HTML overlay div. DOM inspection must show `<g data-callout-id="...">` inside the SVG root with child elements carrying `data-callout-part="line1"`, `"line2"`, `"arrowTip"`, `"textBox"`, `"text"`. Text content appears inside the `<foreignObject>` div.
**Why human:** Visual rendering and DOM structure require browser inspection.

**2. Callout Creation Dashed Preview (CREATE-01 callout half)**

**Test:** Press Q to activate callout tool. Click and drag on empty PDF space.
**Expected:** (a) Crosshair cursor appears before drag starts. (b) A dashed preview appears: 120×32 px rect (approximately) + two dashed connector lines + dashed arrowhead polygon, all at 0.6 opacity, following the pointer in real time. (c) On mouse-up, the dashed preview disappears and a solid callout appears. (d) Switching to a different tool while dragging (e.g., press V mid-drag) cancels the preview cleanly with no orphaned preview element.
**Why human:** CSS cursor, Fabric.js/SVG rendering, and drag lifecycle can only be verified in the browser.

**3. Line/Arrow Dashed Preview (CREATE-01 line/arrow half)**

**Test:** Press L (line) or A (arrow). Click-drag on a page.
**Expected:** The in-progress line renders dashed (5-5 pattern) at 0.6 opacity during drag. On mouse-up, the committed line/arrow is solid. Reload the page and confirm the committed annotation still renders solid (i.e., `strokeDashArray` was NOT persisted in the saved JSON).
**Why human:** Fabric.js canvas rendering of `strokeDashArray` and the pre-`commitShape` reset need live verification.

**4. Crosshair Cursor (UX-01)**

**Test:** Activate line (L), then arrow (A), then callout (Q) tool in turn.
**Expected:** The SVG annotation surface shows `cursor: crosshair` for all three tools when no drag is in progress. Press V (select tool) or Escape — cursor must revert immediately to default/pointer. During an active creation drag, cursor must revert to the drag cursor (not crosshair).
**Why human:** CSS cursor appearance requires browser visual inspection.

**5. Delete/Backspace with Focus Guard (KBD-01)**

**Test:** (a) Select a callout by clicking it. With no text field focused, press Delete. (b) Press Cmd+Z to undo. (c) Select a line or arrow annotation. Press Backspace. (d) Click into a text input field (e.g., a search box) and press Delete — must NOT delete the selected annotation.
**Expected:** (a) Callout disappears. (b) Callout reappears. (c) Line/arrow disappears. (d) Delete fires only in the text input; selected annotation is unaffected.
**Why human:** Keyboard event routing and focus state require live interaction testing.

**6. Callout Part Drag (CALL-10 drag MVP)**

**Test:** Click a callout to select it. Then drag: (a) the arrowTip handle, (b) the knee handle, (c) the textbox body, (d) connector line1 or line2, (e) any part while holding Cmd (macOS).
**Expected:** (a) Only arrowTip moves; (b) only knee moves; (c) only textbox repositions; (d) entire callout moves as a unit; (e) entire callout moves regardless of which part is dragged. Connector lines redraw correctly after each move. After dragging stops, Cmd+Z undoes the last drag — one undo step per drag gesture, not per pointer-move event.
**Why human:** Drag-mode branching and SVG coordinate math can only be confirmed with live pointer events.

**7. Double-Click to Enter Callout Text Edit Mode (CALL-10 edit flow)**

**Test:** Double-click a callout's textbox or connector area.
**Expected:** FabricEditCanvas mounts at full page dimensions. The SVG annotation layer becomes hidden (or at least non-interactive). A Fabric.js Textbox is editable. Typing changes the text. Pressing Escape or clicking outside exits edit mode. The updated text appears in the SVG callout's `<foreignObject>` div. Cmd+Z undoes the edit.
**Why human:** FabricEditCanvas mount lifecycle, `loadCalloutAnnotation` consuming the adapter output, and `fromFabricGroup` writing back to `setCallouts` require live React state transitions.

**8. Regression: v2.2 Features Unaffected**

**Test:** On Page 6, perform the following: (a) select and rotate a shape — rotation pill should appear and typeable value should work; (b) double-click a non-callout shape to enter edit mode; (c) use the pen tool to draw a stroke and the eraser to remove it; (d) select and edit a text annotation; (e) zoom in and out with all 6 zoom methods (buttons, scroll, pinch if available, etc.).
**Expected:** All behaviors identical to pre-Phase-14 operation. No cursor glitches, no accidental callout selection during shape interaction, no missing rotation pill, no zoom regression.
**Why human:** The `isSelectTool`/`isCreationTool`/`isInteractive` split at SVGAnnotationLayer:210-216 touches pointer-event gating for ALL annotation types. The Playwright baseline (113 tests) passes but most callout-specific scaffolds runtime-skip without a loaded PDF. A manual regression pass is required to confirm zero regression on the full v2.2 feature surface.

---

## Gaps Summary

No static gaps were found. All four requirements (CALL-10, UX-01, KBD-01, CREATE-01) are wired end-to-end:

- **CALL-10:** `renderCallout` revised with new signature and `data-callout-*` attributes; `filteredCallouts` gate unwound; 5 HTML-overlay Callout files stubbed to null renders; callout-part drag mode (4-place invariant) in `useSVGInteraction.js`; adapter round-trip (`toFabricGroup`/`fromFabricGroup`) wired at FabricEditCanvas edit entry and save-callback in App.jsx.
- **UX-01:** `isCreationTool` derivation, `.tool-crosshair` CSS class, `className` toggle on SVG root all confirmed.
- **KBD-01:** Extended Delete handler with callout branch, focus guard covering all surfaces including `.fabric-hidden-textarea`, `handleDeleteSelectedCallouts` with `addHistoryCheckpoint` + `setCallouts.filter`.
- **CREATE-01:** FabricDrawingCanvas line/arrow dashed preview (reset before `commitShape`); SVGAnnotationLayer callout creation state machine with transient dashed SVG preview.

The `human_needed` status reflects that this phase delivers UI behavior (cursor changes, drag interactions, keyboard events, live preview rendering) that cannot be fully verified by static code analysis. All 8 UAT items above must be run on the dev server to close the loop.

---

_Verified: 2026-04-15_
_Verifier: Claude (gsd-verifier)_
