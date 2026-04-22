---
phase: 14-unified-svg-callout-render-shared-tool-foundation
status: DONE
closed: 2026-04-16
---

# Phase 14 Reconciliation

## Plan vs Actual

- **Planned:** 3 plans (14-01 / 14-02 / 14-03) covering 4 requirements — CALL-10, UX-01, KBD-01, CREATE-01. Move callout off the HTML-overlay React system onto the SVG pipeline, land shared foundation UX (crosshair, Delete, dashed preview).
- **Actual:** 3 plans shipped as planned + 2 hotfixes required during UAT:
  - Hotfix 1 (`1ef738de`): PDF-imported FreeTextCallouts routed through splitter adapter into `callouts[]` so imports render via unified pipeline instead of dead HTML-overlay codepath.
  - Hotfix 2 (`3163b273`, this session): wired `onEraseCallout` prop into the three `<FabricEraserCanvas>` mount sites + moved Phase 14 callout handlers past `addHistoryCheckpoint` to fix a TDZ load-order bug. Closed the eraser-vs-callout UAT gap.
- **Deltas:**
  - Scope stayed locked at 4 requirements; no scope creep.
  - 5 HTML-overlay `Callout/*.jsx` files retired to null-render stubs (~3,412 LOC deleted). `types.js` preserved as enum/factory shim for Phase 15 ARROW-04.
  - `FabricEraserCanvas.jsx` needed a one-time Phase 14 waiver for post-commit SVG bbox hit-test (prop + useEffect ref-sync).
  - One `src/App.jsx` waiver used for the `editType: 'callout'` save-callback wrapper and the callout-handler block.

## Acceptance Criteria Results

- [x] **CALL-10** — Given a text callout, when it renders on the page, then it renders through the same SVG pipeline as the other 9 annotation types (via `<foreignObject>` for text, `data-callout-id` / `data-callout-part` attributes for hit-testing). **PASSED.** Evidence: Rrvrv UAT after `1ef738de` showed imported callout rendering via unified SVG path; HTML-overlay `Callout/*.jsx` files are null-render stubs.
- [x] **UX-01** — Given the line / arrow / callout tool is active, when the pointer enters the page, then the cursor is a crosshair. **PASSED.** Evidence: Plan 14-02 commit `dce2b756` added the `toolCrosshair` conditional class split by `isCreationTool` on SVG and drawing canvas portals.
- [x] **KBD-01** — Given one or more callouts are selected, when the user presses Delete or Backspace (and is not typing in a text input), then the selected callouts are deleted with per-action undo. **PASSED.** Evidence: Plan 14-02 commit `dce2b756` added the window-level keydown handler in `SVGAnnotationLayer.jsx` with `isUserTyping()` focus guard extended to `.fabric-hidden-textarea`. Eraser now routes through the same handler after hotfix `3163b273`.
- [x] **CREATE-01** — Given the line, arrow, or callout tool is active, when the user drags to create, then a dashed preview at 0.6 opacity is shown and reverts to solid stroke at 1.0 opacity on commit. **PASSED.** Evidence: Plan 14-02 commit `dce2b756` added `strokeDashArray: [5, 5]` + `opacity: 0.6` preview to line/arrow in `FabricDrawingCanvas`, reset to defaults *before* `commitShape()`. Plan 14-03 added the callout creation state machine with dashed-preview rendering.

## Boundaries Honored

- DO NOT CHANGE list (from CLAUDE.md "Always Protected"):
  - `src/App.jsx` — ✗ touched under one-time phase waiver (callout handlers block + `editType: 'callout'` save-callback wrapper + 3× `onEraseCallout` prop additions). Documented and scoped.
  - `src/components/PageAnnotationLayer.jsx` — ✓ untouched (old callout handler `createImportedCalloutFromTextbox` at `:1229-1373` flagged as dead code for separate cleanup phase).
  - `src/components/FabricDrawingCanvas.jsx` — ✗ touched under narrow-lane waiver (~5 LOC, `strokeDashArray` / `opacity` preview fields). `zoomGeneration` signal untouched.
  - `src/components/FabricEraserCanvas.jsx` — ✗ touched under narrow-lane waiver (`onEraseCallout` prop + ref-sync + post-commit SVG bbox hit-test). Landed via commit `8cf5ea89`.
  - `src/components/FabricEditCanvas.jsx` — ✓ untouched (callout edit-mode adapter works via transient annotations shape, zero file edits).
  - `src/components/SVGAnnotationLayer.jsx` — ✗ touched under phase ownership (phase is about SVG unification).
  - `package.json` / `vite.config.js` — ✓ untouched.

## Lessons / Carry-forward

1. **Dead-code unwind surfaces hotfixes during UAT.** The `filteredCallouts = []` short-circuit at `SVGAnnotationLayer.jsx:779` gated off not just the new render path but also the PDF-import codepath, which was silently dead before Phase 14 turned dispatch on. Lesson: whenever a phase revives dead code, schedule one UAT pass specifically covering import/export surfaces.
2. **Load-order of `useCallback` with `addHistoryCheckpoint` dep.** New callout handlers (`handleDeleteSelectedCallouts`, `handleCreateCallout`, `handleUpdateCallout`, `handleUpdateCalloutLive`, `handleRequestCalloutEditMode`) had to be declared *after* `addHistoryCheckpoint` in `App.jsx` to avoid a TDZ ReferenceError in the dep array. Left a comment block at the old location explaining the move. Carry-forward: Phase 15+ callbacks that depend on `addHistoryCheckpoint` should be added to the same downstream block.
3. **Eraser does not need structural knowledge of callouts.** The final shape of the eraser-vs-callout fix is a post-commit DOM bbox hit-test against `[data-callout-id]` groups, routing hits to the same `handleDeleteSelectedCallouts` as the Delete key. Reusing the Delete handler means undo works identically (per-action checkpoint). Pattern worth reusing for future "this tool should also affect callouts" needs.
4. **Callout edit-mode adapter via transient annotations shape.** `toFabricGroup` returns a plain JSON shape (not a live `fabric.Group`) that `loadCalloutAnnotation` enlivens via `fabric.util.enlivenObjects`. The save-callback wrapper at the FabricEditCanvas mount site detects `editType === 'callout'` and routes through `fromFabricGroup → setCallouts`. Zero edits to `FabricEditCanvas.jsx`. Pattern scales to any future entity-type adapters.

## Carry-forward work (not blockers)

- App.jsx still has ~995 lines of uncommitted WIP across three unrelated lanes: tool-switch diagnostics harness, fit-page-on-first-open trigger, and miscellaneous small edits. Belongs to separate lanes; left intentionally untouched during Phase 14 close-out. Needs a dedicated cleanup session before Phase 15 committing resumes.
- `src/PageAnnotationLayer.jsx:1229-1373` dead `createImportedCalloutFromTextbox` function flagged for dedicated dead-code cleanup phase.
- `pdfAnnotationImporter.js` `backgroundColor` fallback bug (opaque black for no-fill FreeTextCallouts) — flagged in prior handoff, still open.
- 5 null-stub Callout files (`CalloutCanvas.jsx`, `CalloutComponent.jsx`, `CalloutContextMenu.jsx`, `CalloutEditModal.jsx`, `index.jsx`) can be deleted after all PAL + App.jsx import references are removed.

## Status: DONE

All 4 acceptance criteria met end-to-end. Eraser-vs-callout UAT gap closed. Phase 15 (line/arrow curvature wiring from `src/utils/lineGeometry.js`) is ready to kick off via `/gsd:discuss-phase 15`.
