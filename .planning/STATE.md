---
gsd_state_version: 1.0
milestone: v2.3
milestone_name: Tools Polish (combined-tools port)
status: active
stopped_at: Milestone v2.3 initialized — PROJECT.md/STATE.md updated, dual-codebase audits spawned, this session checkpointed before requirements + roadmap to protect context budget
last_updated: "2026-04-14T23:45:00.000Z"
last_activity: 2026-04-14 — Milestone v2.3 started (line/arrow/text-callout port from combined-tools); checkpoint handoff prepared for fresh session
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

**Core value:** Annotations render correctly at all zoom levels with zero disappearance via SVG viewBox; line/arrow/text-callout tools match the precision and feel of the `combined-tools` reference app.
**Current focus:** Milestone v2.3 — defining requirements after dual-codebase port audit

## Current Position

Milestone: v2.3 — Tools Polish (combined-tools port) — **DEFINING REQUIREMENTS**
Phase: Not started (Phase 14 will be first once roadmap lands)
Plan: —
Status: Dual-codebase port audit spawned. Requirements + roadmap deferred to fresh session to protect context budget.
Last activity: 2026-04-14 — Milestone v2.3 started; PROJECT.md/STATE.md written; combined-tools + current-repo audit agents spawned; session checkpointed.

Progress: [..........] 0% (milestone just initialized)

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

### Roadmap Evolution

- v1.0 Phases 4-6 superseded by SVG migration
- v1.0 Phase 7 (widen zoom range) deferred
- v2.0 Phases 8-11 shipped 39 requirements
- v2.1 Phase 12 shipped 3 requirements + 9 scope-expansion gap fixes
- v2.2 Phase 13 shipped 2 requirements (one rescoped mid-plan)
- v2.3 phases TBD — will be derived from port gap analysis after audits complete

### Pending Todos

None at milestone kickoff.

### Blockers/Concerns

- v2.3 **CRITICAL SCOPE CORRECTION discovered by audit**: The user asked for "arrowhead style options" and "callout tail shape variants" assuming these exist in combined-tools. **They don't.** Combined-tools has exactly ONE arrowhead style (`fabric.Triangle`) and zero tail-shape variety. Meanwhile, THIS repo's callout already has 6 arrowhead styles defined in `src/components/Callout/`. Same for snap-to-angle — combined-tools has **no** angle snapping, no shift-modifier, no arrow-key nudging. The "port from combined-tools" framing needs to be split into (a) features combined-tools actually has that we lack (curvature via midpoint waypoint, collision prevention, lastSafeObjectPos rollback, 30-px MIN_HANDLE_DISTANCE) and (b) features the user wants that must be **invented** or **preserved** rather than ported. **Surface this to the user before writing REQUIREMENTS.md.**

- v2.3 **HUGE LEVERAGE POINT** from the current-repo audit: `src/utils/lineGeometry.js` is already a complete port of combined-tools' bezier math (`getCurvedPath`, `getCurveEndAngle`, `shouldSnapToLinear`, `getControlPoint`) — but the SVG render path **never imports it**; it's only consumed by the protected legacy `PageAnnotationLayer.jsx`. "The math is one import away from enabling curved lines/arrows." A fresh session should treat this as the first-phase entry point, not write new math.

- v2.3 **COUNTER-WIP WARNING**: `SVGAnnotationLayer.jsx:1072-1194` has an active `[COUNTER WIP — DO NOT TOUCH]` block immediately adjacent to the line-type handle branch where the midpoint curvature handle would land. User reported "counter-tool session is done and fully committed" — but the marker is still in-tree. **Before touching that range, re-verify with the user** that the marker is stale and can be removed, or carve a lane that avoids those lines.

- v2.3 architectural mismatch confirmed: combined-tools uses 7 **ungrouped** Fabric objects tagged with `calloutId` + `partType`, routed by a ~500-line `calculateCalloutConnection` using Liang-Barsky clipping. This app's callout is an **entirely separate HTML+SVG React system** under `src/components/Callout/`. The two architectures share no code. Porting callout behavior from combined-tools means extracting the math (clipping, constraint, rollback) and re-wiring it into the React component, not copying the composite-object structure.

- v2.3: combined-tools uses Fabric.js 6.9.1 with always-mounted canvas; this app uses SVG display + mount/unmount Fabric edit canvas. Some combined-tools patterns may not map 1:1 — flagged in the audits.

## Session Continuity

Last session: 2026-04-14T23:45:00.000Z
Stopped at: Milestone v2.3 initialized. PROJECT.md + STATE.md updated. Combined-tools and current-repo audits spawned (findings written to `.planning/research/COMBINED-TOOLS-AUDIT.md` and `.planning/research/CURRENT-REPO-AUDIT.md`). Session checkpointed to preserve context budget before writing REQUIREMENTS.md + running gsd-roadmapper.

### Resume instructions for the fresh session (read carefully)

**BEFORE writing requirements, the fresh session MUST surface the three findings in Blockers/Concerns above to the user and get decisions:**

1. **Scope correction** — combined-tools does NOT have arrowhead style variety, callout tail variants, snap-to-angle, or shift-modifier. User's original ask assumed parity with combined-tools for those, but combined-tools is the thing LACKING those features. Fresh session must present the finding and ask the user: (a) drop those items since they're not in the reference, (b) keep them as "invented beyond the reference", or (c) preserve existing behavior (our callout already has 6 arrowhead styles and knee handles, so "don't break what we have" is a valid ask).
2. **lineGeometry.js leverage point** — `src/utils/lineGeometry.js` already contains combined-tools' curvature math, fully ported, but the SVG render path never imports it. First-phase requirement should be "wire `lineGeometry.js` into the SVG render path for line/arrow" — not "write new curve math". Confirm this framing with the user.
3. **Counter WIP marker in SVGAnnotationLayer.jsx:1072-1194** — user said counter-session is done, but an active `[COUNTER WIP — DO NOT TOUCH]` marker is still in-tree at exactly the line-type handle branch. Ask user to confirm the marker is stale before planning work that touches that range.

**Workflow steps:**

1. Read `.planning/PROJECT.md` — confirm v2.3 milestone scope
2. Read `.planning/research/COMBINED-TOOLS-AUDIT.md` — combined-tools mechanics per tool (51 KB — skim the H2s first, deep-read Line and Callout sections)
3. Read `.planning/research/CURRENT-REPO-AUDIT.md` — current state + integration points + gap map (28 KB)
4. **Raise the three pre-requirements findings above with the user** and wait for decisions
5. Write `.planning/REQUIREMENTS.md` with REQ-IDs. Suggested prefixes: `LINE-*`, `ARROW-*`, `CALL-*`. User-centric, testable, atomic.
6. Commit: `node "/Users/isaiahcalvo/.claude/get-shit-done/bin/gsd-tools.cjs" commit "docs: define milestone v2.3 requirements" --files .planning/REQUIREMENTS.md`
7. Spawn `gsd-roadmapper` agent starting at **Phase 14**. Pass: `PROJECT.md`, `REQUIREMENTS.md`, both audit files, `MILESTONES.md`, `config.json`.
8. Present roadmap for user approval. Commit.
9. Update `MILESTONES.md` with v2.3 entry. Commit.
10. Present "Next Up" block pointing to `/gsd:discuss-phase 14`.

**One-line wake-up for the fresh session:** "Resume v2.3. Read both audit files in `.planning/research/`, surface the 3 scope-correction findings from STATE.md Blockers, then write REQUIREMENTS.md with LINE-/ARROW-/CALL- IDs, then spawn gsd-roadmapper starting at Phase 14."
