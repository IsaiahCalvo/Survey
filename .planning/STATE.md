---
gsd_state_version: 1.0
milestone: v2.3
milestone_name: Tools Polish
status: Phase 14 complete — all 4 v2.3 Phase 14 requirements (CALL-10, UX-01, KBD-01, CREATE-01) functionally complete end-to-end. Ready for /gsd:verify-work + phase RECONCILIATION.md.
stopped_at: Completed 14-03-PLAN.md — Wave 2 integration shipped. Next step:- /gsd:verify-work 14 to run the full Playwright baseline, then phase 14 RECONCILIATION.md.
last_updated: "2026-04-15T19:20:25.110Z"
last_activity: "2026-04-15 — Plan 14-03 executed (3 tasks, 3 commits: c2c05b7a / dce2b756 / 71fcdff9)"
progress:
  total_phases: 6
  completed_phases: 1
  total_plans_in_phase: 3
  completed_plans_in_phase: 3
  percent: 100
  note: "Phase 14 complete (3/3 plans). completed_phases counts only fully-reconciled phases; Phase 14 advances to completed after /gsd:verify-work + RECONCILIATION.md."
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-14)

**Core value:** Line/arrow/text-callout tools match the precision and feel of the `combined-tools` reference app, AND all annotations render through the same SVG pipeline for a unified select / edit / erase / undo story.
**Current focus:** Milestone v2.3 — Phases 14-18 defined, awaiting `/gsd:discuss-phase 14` to kick off plan decomposition for the SVG unification of callouts + shared tool foundation.

## Current Position

Milestone: v2.3 — Tools Polish (combined-tools rewrite + unified render)
Phase: **Phase 14 — Unified SVG Callout Render + Shared Tool Foundation** (COMPLETE — 3/3 plans shipped)
Plan: 14-03 — complete (next: `/gsd:verify-work 14` + phase RECONCILIATION.md)
Status: Phase 14 complete. All 4 requirements (CALL-10, UX-01, KBD-01, CREATE-01) functionally complete end-to-end.
Last activity: 2026-04-15 — Plan 14-03 executed (3 tasks, 3 commits: c2c05b7a / dce2b756 / 71fcdff9)

Progress: [██████████] 100% (Phase 14: 3/3 plans complete, advances to Phase 15 on next plan)

## Performance Metrics

**Velocity (lifetime):**
- v1.0 (Phases 1-3): 3 plans — shipped 2026-03-19
- v2.0 (Phases 8-11): 9 plans — shipped 2026-04-10
- v2.1 (Phase 12): 3 plans — shipped 2026-04-14
- v2.2 (Phase 13): 2 plans — shipped 2026-04-14 (same day as v2.1)
- **Total: 17 plans shipped across 4 milestones**

**v2.3 plan:**
- 5 phases for 26 requirements (14 → 18). CALL-10 as Phase 14 unblocker; lineGeometry wiring as Phase 15; mini-toolbar + curvature pill as Phase 16; callout collision/rollback/resize as Phase 17; callout auto-routing + hover + self-destruct as Phase 18.
- **Phase 14 shipped 2026-04-15** — 3 plans: 14-01 (Wave 0 renderCallout + adapter + tests), 14-02 (Wave 1 crosshair + delete + dashed preview), 14-03 (Wave 2 integration: filteredCallouts unwind + callout-part drag + edit-mode adapter + creation preview). 4 requirements closed.

**Plan metrics (Phase 14):**

| Plan  | Duration | Tasks | Commits | Files  | Notes                                                                   |
| ----- | -------- | ----- | ------- | ------ | ----------------------------------------------------------------------- |
| 14-01 | 12 min   | 3     | 4       | 12     | Wave 0 — renderCallout signature + calloutEditAdapter + 8 test scaffolds |
| 14-02 | ~15 min  | 3     | 3       | 6      | Wave 1 — crosshair + Delete handler + dashed line/arrow preview        |
| 14-03 | ~20 min  | 3     | 3       | 11     | Wave 2 — filteredCallouts unwound + callout-part drag + edit-mode adapter + creation preview + 5 Callout stubs (−3,412 LOC) |

**Tests:** 113/113 green at v2.2 close (v2.3 must preserve this baseline). Plan 14-03 preserves 143/144 unit-test baseline (1 pre-existing pdfAnnotationImporter failure, out of scope per 14-01/14-02 deferred-items.md).

## Accumulated Context

### Decisions

- [v1.0]: Overlay divs as direct children of Syncfusion page divs + CSS transform zoom handling + React portal render loop
- [v2.0]: SVG display + Fabric.js edit-only; zero-timer zoom; same Fabric.js JSON data model
- [v2.0]: `<foreignObject>` for text; mount/unmount Canvas per edit session
- [v2.1]: EDIT-11 as pure `snapAngleToNearest45` helper + one-line wire (matches Fabric `snapThreshold` convention)
- [v2.1]: ZOOM-09 as atomic 2-file commit (`zoomController.js` + `App.jsx` commitZoomInput) — cannot be split
- [v2.1]: EDIT-12 architecture locked to HTML portal (not foreignObject) to avoid IME/focus quirks
- [v2.1]: RotationInputField is uncontrolled input — controlled racing live drag updates swallowed keystrokes
- [v2.1]: Pill orbit radius constant across all rotations via worst-case AABB projection from shape center
- [v2.1]: Plan 12-03 optimistic rotation paint pattern — canonical fix for commit-path latency in SVG annotation layer
- [v2.1]: Full-click-cycle stopPropagation (down + up + click + pointerdown + pointerup) at wrapper boundary required for portaled UI inside interactive SVG layer
- [v2.1]: Phase 12 closed via Option A (backlog Gaps 3+4) rather than holding phase open
- [v2.2]: Gap 2 (off-screen handle relocation) closed `wontfix_superseded_by_typed_input` — 9-tool industry survey
- [v2.2]: Single Phase 13 with 2 plans (one per requirement) — both gaps in same narrow interaction surface
- [v2.2]: EDIT-13 hover pill re-arm via event delegation (`e.target.closest('[data-rotation-handle="mtr"]')`)
- [v2.2]: EDIT-14 rescoped mid-plan — "no Fabric transform handles in edit mode" delivered Figma-style separation under one-time narrow lane waiver for FabricEditCanvas.jsx
- [v2.3]: Replaced standard new-milestone research step with combined-tools + current-repo port audit — port milestone, not domain milestone
- [v2.3]: Stay on Fabric.js 5.5.2; do NOT upgrade to 6.x despite combined-tools being on 6.x. Port behavior, not engine.
- [v2.3]: Feature parity accepted over pixel parity — rendering engines differ (SVG display vs Canvas display)
- [v2.3]: Checkpoint after audits rather than pushing through to roadmap in one session — context budget protection
- [v2.3]: **Rewrite permission granted 2026-04-14.** User: "the current callout, line, and arrow tools suck...I don't care if you think we need to start over...don't worry about preserving anything." Current implementations may be replaced wholesale.
- [v2.3]: **Scope expanded 14 → 26 requirements.** Added curvature indicator pill (LINE-04/ARROW-05), min drag length (LINE-05/ARROW-06), mini-toolbars (LINE-06/ARROW-07), Liang-Barsky auto-routing (CALL-07), empty-text self-destruct (CALL-08), hover glow (CALL-09), **SVG unification (CALL-10)**, Delete/Backspace (KBD-01), dashed creation preview (CREATE-01).
- [v2.3]: **Unified render decision (CALL-10).** User: "I want all annotations to render the same — different rendering makes selection, editing, erasing complicated." Callout moves from its current separate HTML-overlay system (`src/components/Callout/*`) to the same SVG pipeline all 9 other annotation types use, with `<foreignObject>` for text content (same pattern as text annotations).
- [v2.3]: **Curvature indicator mirrors RotationInputField UX.** Hover-reveal pill near midpoint handle, shows current curvature, typeable to commit a custom curve, optimistic-paint commit. Proven v2.1 pattern — reuse helpers directly.
- [v2.3]: **Line/arrow "act like regular shapes"** — inherit the select lifecycle + mini-toolbar + hover pill pattern that rect/circle/ellipse already have. UX unification on top of render unification.
- [v2.3 roadmap]: **5 phases for 26 requirements (14 → 18).** Phase 14 = CALL-10 + shared foundation (UX-01/KBD-01/CREATE-01). Phase 15 = line/arrow curvature wiring (LINE-01..03, ARROW-01..03) + 6-style arrowhead enum (ARROW-04). Phase 16 = mini-toolbar + typeable curvature pill + min-drag (LINE-04..06, ARROW-05..07). Phase 17 = callout collisions + rollback + resize (CALL-01..05). Phase 18 = callout auto-routing + hover affordances + self-destruct (CALL-06..09).
- [v2.3 roadmap]: **CALL-10 lands as Phase 14, not later.** Doing SVG unification first means downstream callout polish (Phases 17-18) builds against the final render path, not a soon-to-be-deleted codepath. Risk of building against the old HTML-overlay system and re-doing the work during unification outweighs any phase-ordering convenience.
- [v2.3 roadmap]: **lineGeometry.js is a wiring job, not a rewrite.** The math (`getCurvedPath`, `getCurveEndAngle`, `shouldSnapToLinear`, `getControlPoint`) is already ported in `src/utils/lineGeometry.js` — Phase 15 consumes it from SVG renderers + `useSVGInteraction.js` without entangling the protected PAL codepath that's currently the only live consumer.
- [v2.3 roadmap]: **Phase 16 curvature pill reuses v2.1 patterns literally.** `RotationInputField` architecture (HTML portal + uncontrolled input + full-click-cycle stopPropagation + constant orbit radius via worst-case AABB projection) and `applyOptimisticRotation` paint pattern carry over verbatim — shape for curvature, not rewrite.
- [Phase 14]: Plan 14-02: split SVGAnnotationLayer isInteractive into isSelectTool+isCreationTool+isInteractive so creation tools get pointerEvents=auto without re-enabling annotation click-to-select on the 3 hit-area sites
- [Phase 14]: Plan 14-02: reset strokeDashArray:null+opacity:1 BEFORE commitShape() in FabricDrawingCanvas, not after — commitShape serializes via toJSON(CUSTOM_PROPS) on its first line
- [Phase 14]: Plan 14-02: Delete/Backspace focus guard extended to .fabric-hidden-textarea via el.closest — Fabric.js IText/Textbox edit mode's hidden textarea consumes Delete keys
- [Phase 14]: Plan 14-01: buildCalloutRenderSpec pure data-spec helper bridges Node --test + .jsx incompatibility — tests import a .js helper that returns a plain spec tree, JSX renderer wraps 1:1 with React.createElement. Avoids adding any loader dep.
- [Phase 14]: Plan 14-01: toFabricGroup returns plain JSON shape (not live fabric.Group) — keeps round-trip math integer-clean at 1e-6 over 10 cycles and dodges Fabric.js Group positioning side effects. loadCalloutAnnotation consumes the shape via fabric.util.enlivenObjects so the adapter drops in.
- [Phase 14]: Plan 14-01: sanitizeFontFamily applied at 3 surfaces (renderer foreignObject, adapter Textbox, defaultCalloutStyle) — CSS fallback stacks cause Fabric.js cursor drift (CLAUDE.md 2026-04-08 gotcha). defaultCalloutStyle.fontFamily changed 'Inter, Arial, sans-serif' → 'Arial'.
- [Phase 14]: Plan 14-01: renderCallout always emits the text foreignObject (even when text is empty) so the data-callout-part='text' hit-test surface exists for freshly-created empty callouts — Plan 14-03 relies on this for double-click edit-mode entry.
- [Phase 14]: Plan 14-03: FabricEditCanvas adapter via transient annotations shape — zero edits to FabricEditCanvas.jsx. toFabricGroup stashes reactCalloutId on editingAnnotation; onEditCommit wrapper detects editType==='callout' and routes through fromFabricGroup→setCallouts.
- [Phase 14]: Plan 14-03: callout drag uses live-paint vs commit-checkpoint split (handleUpdateCalloutLive repaints every pointermove without undo entry; handleUpdateCallout fires once at pointerup as checkpoint-only signal). Mirrors Phase 12 optimistic rotation paint pattern.
- [Phase 14]: Plan 14-03: 4-place invariant enforced for 'callout-part' drag mode — dragStateRef init + handleSvgPointerDown set + handlePointerMove case + handlePointerUp commit + reset. Whole-move triggers: connector-line drag OR Cmd/Ctrl modifier.
- [Phase 14]: Plan 14-03: 5 HTML-overlay Callout/*.jsx files retired to null-render stubs (~3,412 LOC deleted). types.js preserved as enum/factory shim. PAL import contract preserved without a PAL waiver — existing <CalloutOverlay> mount sites render nothing.
- [Phase 14]: Plan 14-03: pre-existing working-tree WIP in App.jsx (tool-switch diagnostics) and SVGAnnotationLayer.jsx (polygon/polyline PDF import) was deliberately NOT staged via git add -p split — belongs to separate lanes.

### Roadmap Evolution

- v1.0 Phases 4-6 superseded by SVG migration
- v1.0 Phase 7 (widen zoom range) deferred
- v2.0 Phases 8-11 shipped 39 requirements
- v2.1 Phase 12 shipped 3 requirements + 9 scope-expansion gap fixes
- v2.2 Phase 13 shipped 2 requirements (one rescoped mid-plan)
- v2.3 Phases 14-18 defined 2026-04-15 for 26 requirements (100% coverage)

### Pending Todos

- Kick off `/gsd:discuss-phase 14` to spawn plan decomposition for the Unified SVG Callout Render + Shared Tool Foundation phase.
- Consider whether `MILESTONES.md` should be updated to log v2.2 (shipped 2026-04-14 but not yet logged) and v2.3 (planning). Not in gsd-roadmapper's scope per this run's instructions, but flagged for the user's next discussion session.
- Session-moment log for 2026-04-14 should be reviewed for any graduation candidates before Phase 14 plan work starts.

### Blockers/Concerns

- v2.3 **CALL-10 ordering risk flagged and resolved**: CALL-10 is Phase 14 (not Phase 18). Downstream phases (17-18) will build against the unified SVG render path, not the old `src/components/Callout/` HTML-overlay React system. If Phase 14 slips or the unified render proves harder than estimated, Phases 15-16 can still proceed in parallel since they target line/arrow (independent of callout render path) — CALL-10 blocks Phases 17-18 only.

- v2.3 **`src/App.jsx` waiver likely needed in Phase 14**: Delete/Backspace keyboard handler lives at App.jsx:~22480 and `activeTool` state is App-level. Phase 14 plan CONTEXT must explicitly call out whether App.jsx touches are required and request the narrow-lane waiver before planning.

- v2.3 **`src/components/FabricEditCanvas.jsx` waiver likely needed in Phase 18**: CALL-08 empty-text self-destruct fires when a newly created callout exits edit mode — the `editType: 'callout'` branch at `FabricEditCanvas.jsx:~1335` may need a small commit-hook. Keep the scope surgical.

- v2.3 **lineGeometry.js leverage point** (unchanged): `src/utils/lineGeometry.js` is already a complete port — Phase 15 imports and consumes, does not rewrite. `PageAnnotationLayer.jsx` remains the only other live consumer and stays untouched.

- v2.3 **Counter WIP marker cleanup done:** the stale `[COUNTER WIP — DO NOT TOUCH]` comment at `SVGAnnotationLayer.jsx:1072-1075` was removed in the previous session (counter code stable in commit `8ac818bc`). No adjacent-code hazard for the line-type handle branch anymore.

- v2.3 **Fabric 5.5.2 stays locked.** Do NOT upgrade to 6.x. Port behavior, not engine.

## Session Continuity

Last session: 2026-04-15T19:20:00Z
Stopped at: Completed 14-03-PLAN.md — Wave 2 integration shipped. Phase 14 functionally complete (all 4 requirements). Next: `/gsd:verify-work 14` to run Playwright baseline + phase RECONCILIATION.md.

### Resume instructions for the next session (read carefully)

**One-line wake-up:** "Resume v2.3. Phase 14 functionally complete (3/3 plans). Next step: `/gsd:verify-work 14` to run the full Playwright baseline against the unified callout render pipeline, then write `.planning/phases/14-.../14-RECONCILIATION.md` per the GSD phase discipline rules, then `/gsd:discuss-phase 15` to kick off line/arrow curvature wiring."

**Workflow steps:**

1. Run `/gsd:verify-work 14` — executes the Phase 14 Playwright subset (callout-render-roundtrip, create-preview-callout, delete-callout-keyboard, tool-cursor-crosshair, create-preview-line) + full 113-test baseline regression check
2. Manually UAT: open `Package 2 - Rev 4 -- IC.pdf` at Page 6, create + drag + edit + delete a callout, verify all behaviors
3. Write `.planning/phases/14-unified-svg-callout-render-shared-tool-foundation/14-RECONCILIATION.md` per `~/.claude/CLAUDE.md` phase discipline rules:
   - Plan vs Actual deltas
   - Acceptance Criteria results (all 4: CALL-10, UX-01, KBD-01, CREATE-01)
   - Boundaries Honored (DO NOT CHANGE list verification)
   - Lessons / Carry-forward
   - Status: DONE | DONE_WITH_CONCERNS
4. Commit the phase closure
5. `/gsd:discuss-phase 15` → Phase 15 (LINE-01..03, ARROW-01..03, ARROW-04) — line/arrow curvature wiring from `src/utils/lineGeometry.js`

**Watch-outs for the next session:**

- Do NOT re-open the 5-phase decomposition. It's locked with 26/26 coverage.
- Do NOT touch `src/PageAnnotationLayer.jsx`, `src/components/PageAnnotationLayer.jsx`, `src/components/FabricDrawingCanvas.jsx`, `src/components/FabricEraserCanvas.jsx`, `src/components/FabricEditCanvas.jsx`, `package.json`, `vite.config.js` without an explicit per-phase waiver.
- Do NOT entangle PAL's curved-line code path with the new SVG-side wiring — leave PAL alone. PAL is the only current consumer of `lineGeometry.js`; Phase 15 imports directly without touching PAL.
- **Phase 14 working tree hygiene:** pre-existing uncommitted WIP in App.jsx (tool-switch diagnostics) and SVGAnnotationLayer.jsx (polygon/polyline PDF import) is STILL uncommitted. Plan 14-03 deliberately did not touch this — it belongs to separate lanes. The next session should decide whether to commit or revert these to a separate branch.
- Delete the 5 null-stub Callout files in a cleanup phase (Phase 15 or later) — they only exist because PAL + App.jsx import paths require them. When PAL and App.jsx no longer import from `./components/Callout`, the stubs can be deleted.
