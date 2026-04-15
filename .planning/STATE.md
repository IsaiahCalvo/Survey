---
gsd_state_version: 1.0
milestone: v2.3
milestone_name: Tools Polish (combined-tools rewrite + unified render)
status: active
stopped_at: Milestone v2.3 REQUIREMENTS.md revised to 26 requirements after user scope expansion — rewrite permission granted, unified-render decision added (CALL-10). Session checkpointed before roadmapper spawn to protect context budget (hit 31%). Fresh session must run gsd-roadmapper starting at Phase 14.
last_updated: "2026-04-14T24:45:00.000Z"
last_activity: 2026-04-14 — v2.3 requirements revised from 14 → 26, rewrite permission granted, checkpoint for fresh session.
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-14)

**Core value:** Line/arrow/text-callout tools match the precision and feel of the `combined-tools` reference app, AND all annotations render through the same SVG pipeline for a unified select / edit / erase / undo story.
**Current focus:** Milestone v2.3 — REQUIREMENTS.md revised (26 items), awaiting roadmapper in a fresh session.

## Current Position

Milestone: v2.3 — Tools Polish (combined-tools rewrite + unified render) — **REQUIREMENTS DEFINED, AWAITING ROADMAPPER**
Phase: Not started (Phase 14 will be first once roadmap lands)
Plan: —
Status: REQUIREMENTS.md committed with 26 items. Roadmapper deferred to fresh session for context budget reasons.
Last activity: 2026-04-14 — scope revised after user direction shift; rewrite permission granted; unified-render decision captured; checkpoint written.

Progress: [..........] 0% (requirements defined, roadmap pending)

## Performance Metrics

**Velocity (lifetime):**
- v1.0 (Phases 1-3): 3 plans — shipped 2026-03-19
- v2.0 (Phases 8-11): 9 plans — shipped 2026-04-10
- v2.1 (Phase 12): 3 plans — shipped 2026-04-14
- v2.2 (Phase 13): 2 plans — shipped 2026-04-14 (same day as v2.1)
- **Total: 17 plans shipped across 4 milestones**

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

### Roadmap Evolution

- v1.0 Phases 4-6 superseded by SVG migration
- v1.0 Phase 7 (widen zoom range) deferred
- v2.0 Phases 8-11 shipped 39 requirements
- v2.1 Phase 12 shipped 3 requirements + 9 scope-expansion gap fixes
- v2.2 Phase 13 shipped 2 requirements (one rescoped mid-plan)
- v2.3 phases TBD — roadmapper must decompose 26 requirements starting at Phase 14 in the fresh session

### Pending Todos

None at milestone kickoff. Session-moment log for 2026-04-14 should be reviewed for any graduation candidates during the fresh session.

### Blockers/Concerns

- v2.3 **Scope is now 26 requirements across 4 categories** — the biggest single milestone in the project to date (v2.0 shipped 39 requirements across 4 phases — similar scale). Roadmapper will need to decompose into ~4-6 phases: expect phase boundaries roughly along (1) SVG unification of callout + shared creation preview, (2) line/arrow curvature wiring + mini-toolbar lifecycle, (3) line/arrow curvature pill + keyboard, (4) callout collision + rollback + resize, (5) callout auto-routing + hover affordance. Let the roadmapper propose; don't pre-decompose.

- v2.3 **CALL-10 (SVG unification of callout) is architecturally load-bearing** and probably needs to be Phase 14 — it unblocks every other callout requirement because once the callout renders through `svgAnnotationRenderers.jsx` + `useSVGInteraction.js` like every other annotation, the collision / rollback / resize / hover requirements all fit into the existing SVG interaction pattern rather than inside the current separate React component. Flag this to the roadmapper.

- v2.3 **lineGeometry.js leverage point:** `src/utils/lineGeometry.js` is already a complete port of combined-tools' curvature math (`getCurvedPath`, `getCurveEndAngle`, `shouldSnapToLinear`, `getControlPoint`). Currently consumed only by the protected legacy `PageAnnotationLayer.jsx`. The line/arrow curvature requirements (LINE-01..03, ARROW-01..03) are a wiring job — import and consume, don't re-write.

- v2.3 **Counter WIP marker cleanup done:** the stale `[COUNTER WIP — DO NOT TOUCH]` comment at `SVGAnnotationLayer.jsx:1072-1075` was removed in this session (counter code stable in commit `8ac818bc`). No adjacent-code hazard for the line-type handle branch anymore.

- v2.3 **Fabric 5.5.2 stays locked.** Do NOT upgrade to 6.x. Port behavior, not engine.

## Session Continuity

Last session: 2026-04-14T24:45:00.000Z
Stopped at: v2.3 REQUIREMENTS.md revised to 26 items after scope expansion. Rewrite permission granted. Unified-render decision added. Counter WIP marker cleaned up (1 file). Three atomic commits made. Session checkpointed at 31% context before running `gsd-roadmapper`.

### Resume instructions for the fresh session (read carefully)

**One-line wake-up:** "Resume v2.3. Requirements are locked at 26 items in REQUIREMENTS.md. Read both audit files in `.planning/research/`, then spawn gsd-roadmapper starting at Phase 14. Flag CALL-10 (SVG unification of callout) as the suggested Phase 14 since it unblocks every other callout requirement."

**Workflow steps:**

1. Read `.planning/PROJECT.md` — confirm v2.3 milestone scope (26 reqs, rewrite permission, unified render)
2. Read `.planning/REQUIREMENTS.md` — the 26 requirements locked in this session
3. Read `.planning/research/COMBINED-TOOLS-AUDIT.md` — combined-tools mechanics per tool (skim the H2s: Line Tool, Arrow Tool, Text Callout Tool, Shared State & Events, Surprising Mechanisms)
4. Read `.planning/research/CURRENT-REPO-AUDIT.md` — current state + integration points + gap map + risk areas (section: "Risk Areas")
5. Read this STATE.md for the scope context and the three architectural observations in Blockers/Concerns
6. Spawn `gsd-roadmapper` agent starting at **Phase 14**. Pass: `PROJECT.md`, `REQUIREMENTS.md`, both audit files, `MILESTONES.md`, `config.json`. Ask roadmapper to consider CALL-10 as a possible Phase 14 unblocker.
7. Present roadmap for user approval. Commit.
8. Update `MILESTONES.md` — it's currently missing the v2.2 entry (shipped 2026-04-14 but not logged). Add both v2.2 and v2.3 entries. Commit.
9. Present "Next Up" block pointing to `/gsd:discuss-phase 14`.

**Watch-outs for the fresh session:**

- Do NOT re-ask the scope questions already decided this session (listed in Decisions above)
- Do NOT restore the stale `[COUNTER WIP — DO NOT TOUCH]` comment at SVGAnnotationLayer.jsx:1072 — it was removed on purpose in commit TBD (counter session is done)
- Do NOT touch `src/App.jsx`, `src/components/PageAnnotationLayer.jsx`, `src/components/FabricEditCanvas.jsx`, `package.json`, `vite.config.js` without explicit per-phase waiver (Always-Protected per CLAUDE.md)
- Do NOT entangle PAL's curved-line code path with the new SVG-side wiring — leave PAL alone, it's the ONLY current consumer of `lineGeometry.js`
- If the roadmapper produces more than 6 phases for 26 requirements, ask the user before accepting — that might mean the scope needs re-splitting into v2.3 + v2.4
