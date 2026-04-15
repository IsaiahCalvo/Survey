---
gsd_state_version: 1.0
milestone: v2.3
milestone_name: Tools Polish
status: Roadmap committed. 26/26 v2.3 requirements mapped across Phases 14-18. Ready for plan decomposition.
stopped_at: Completed 14-02-PLAN.md — UX-01/KBD-01/CREATE-01 foundation shipped
last_updated: "2026-04-15T18:47:55.201Z"
last_activity: 2026-04-15 — gsd-roadmapper produced the 5-phase v2.3 roadmap.
progress:
  total_phases: 6
  completed_phases: 1
  total_plans: 5
  completed_plans: 4
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-14)

**Core value:** Line/arrow/text-callout tools match the precision and feel of the `combined-tools` reference app, AND all annotations render through the same SVG pipeline for a unified select / edit / erase / undo story.
**Current focus:** Milestone v2.3 — Phases 14-18 defined, awaiting `/gsd:discuss-phase 14` to kick off plan decomposition for the SVG unification of callouts + shared tool foundation.

## Current Position

Milestone: v2.3 — Tools Polish (combined-tools rewrite + unified render)
Phase: **Phase 14 — Unified SVG Callout Render + Shared Tool Foundation** (next, not started)
Plan: — (populated by `/gsd:plan-phase 14`)
Status: Roadmap committed. 26/26 v2.3 requirements mapped across Phases 14-18. Ready for plan decomposition.
Last activity: 2026-04-15 — gsd-roadmapper produced the 5-phase v2.3 roadmap.

Progress: [..........] 0% (0/5 phases complete, 0/TBD plans complete)

## Performance Metrics

**Velocity (lifetime):**
- v1.0 (Phases 1-3): 3 plans — shipped 2026-03-19
- v2.0 (Phases 8-11): 9 plans — shipped 2026-04-10
- v2.1 (Phase 12): 3 plans — shipped 2026-04-14
- v2.2 (Phase 13): 2 plans — shipped 2026-04-14 (same day as v2.1)
- **Total: 17 plans shipped across 4 milestones**

**v2.3 plan:**
- 5 phases for 26 requirements (14 → 18). CALL-10 as Phase 14 unblocker; lineGeometry wiring as Phase 15; mini-toolbar + curvature pill as Phase 16; callout collision/rollback/resize as Phase 17; callout auto-routing + hover + self-destruct as Phase 18.

**Tests:** 113/113 green at v2.2 close (v2.3 must preserve this baseline)

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

Last session: 2026-04-15T18:47:44.085Z
Stopped at: Completed 14-02-PLAN.md — UX-01/KBD-01/CREATE-01 foundation shipped

### Resume instructions for the next session (read carefully)

**One-line wake-up:** "Resume v2.3. Roadmap Phases 14-18 are committed. Next step: `/gsd:discuss-phase 14` to decompose the Unified SVG Callout Render + Shared Tool Foundation phase (CALL-10 + UX-01 + KBD-01 + CREATE-01) into plans. Flag up front whether `src/App.jsx` needs a narrow-lane waiver for the Delete/Backspace keyboard handler and `activeTool` crosshair coordination."

**Workflow steps:**

1. Read `.planning/ROADMAP.md` v2.3 section — confirm Phase 14 goal, requirements, boundaries, success criteria
2. Read `.planning/REQUIREMENTS.md` — verify Traceability shows CALL-10 / UX-01 / KBD-01 / CREATE-01 → Phase 14
3. Read `.planning/research/CURRENT-REPO-AUDIT.md` "Callout" section + "Risk Areas" — integration points for the unified render
4. Read `.planning/research/COMBINED-TOOLS-AUDIT.md` "Text Callout Tool" + "Shared State & Events" — baseline behavior to match
5. Spawn `/gsd:discuss-phase 14` to produce the plan list (expect 2-3 plans: unified render + render-path callout selection/edit + shared foundation wiring)
6. Commit. Present next step: `/gsd:plan-phase 14`.

**Watch-outs for the next session:**

- Do NOT re-open the 5-phase decomposition. It's locked with 26/26 coverage. If a later phase surfaces a scope gap, insert a decimal phase (14.1, 15.1) via `/gsd:insert-phase` — do not renumber.
- Do NOT touch `src/App.jsx`, `src/components/PageAnnotationLayer.jsx`, `src/components/FabricDrawingCanvas.jsx`, `src/components/FabricEraserCanvas.jsx`, `src/components/FabricEditCanvas.jsx`, `package.json`, `vite.config.js` without an explicit per-phase waiver (Always-Protected per CLAUDE.md).
- Do NOT entangle PAL's curved-line code path with the new SVG-side wiring — leave PAL alone. PAL is the only current consumer of `lineGeometry.js`; Phase 15 imports directly without touching PAL.
- Do NOT restore the stale `[COUNTER WIP — DO NOT TOUCH]` comment at SVGAnnotationLayer.jsx:1072 — it was removed on purpose.
- Do NOT attempt to ship the callout render unification AND the line/arrow mini-toolbar polish in the same phase. Phase 14 is render unification + shared foundation only; line/arrow polish is Phases 15-16.
