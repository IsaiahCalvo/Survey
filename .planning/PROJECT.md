# PDF Annotation App

## What This Is

A PDF annotation application for mechanical/electrical engineers at mid-size firms. Post-v2.0 uses SVG display + Fabric.js edit-only architecture: SVG `viewBox` handles all zoom scaling with zero timer coordination, Fabric.js Canvas mounts only during active drawing/editing. Core zoom, display, rotation, and shape editing shipped through v2.2. Current focus (v2.3): porting line / arrow / text callout tool UX from the reference `combined-tools` codebase for feature-complete precision tools.

## Core Value

Annotations render correctly at all zoom levels with zero disappearance via SVG viewBox, **and** line/arrow/text-callout tools feel as precise and polished as the reference `combined-tools` app — natural curvature, no collision between handles, full hover/cursor/keyboard parity.

## Previous Milestone: v2.0 SVG Migration ✓ COMPLETE (2026-04-10)

Phases 8-11 shipped. SVG display + Fabric.js edit-only architecture fully
landed with zero-timer zoom. All 39 v2.0 requirements met. See MILESTONES.md.

## Previous Milestone: v2.1 Shape Edit Polish & Foundation Wins ✓ COMPLETE (2026-04-14, DONE_WITH_CONCERNS)

Phase 12 shipped. Soft Shift-snap rotation (EDIT-11), rotation degree input
field (EDIT-12), and zoom floor at 10% (ZOOM-09). Plan 12-01 scope-expanded
in-flight to include 9 dual-path shape edit gap bugs. Plan 12-03 was an
unplanned gap-closure for 12-02's Enter-commit latency via a reusable
optimistic-paint helper. Two polish gaps deferred to v2.2. See MILESTONES.md.

## Previous Milestone: v2.2 Rotation Handle Polish ✓ COMPLETE (2026-04-14)

Phase 13 shipped. EDIT-13 hover pill re-arm via event delegation, EDIT-14
rescoped mid-plan to "no Fabric transform handles in edit mode" (Figma-style
separation). v2.1 carry-forward gaps closed. See MILESTONES.md.

## Current Milestone: v2.3 Tools Polish (combined-tools rewrite + unified render)

**Goal:** Rewrite the line, arrow, and text callout tools using `combined-tools` as the behavioral baseline, and unify callout rendering onto the same SVG pipeline the other 7 annotation types already use. User-granted rewrite permission 2026-04-14 — don't preserve the current implementations.

**Target features (26 requirements — see REQUIREMENTS.md):**
- Line (6): middle bezier curvature handle, snap-curve-to-straight reset, curve-preserving endpoint drag, typeable curvature pill, minimum-drag creation, mini-toolbar lifecycle
- Arrow (7): same as line + curved-tangent arrowhead + 6-style arrowhead picker (lifted from callout) + mini-toolbar
- Callout (10): 30-px handle collision (arrowTip↔knee, knee↔box, box↔knee), on-drop rollback, resize correctness, hover-reveal handles, Liang-Barsky auto-routing, empty-text self-destruct, hover glow, **SVG unification (CALL-10)**
- Shared (3): crosshair cursor, Delete/Backspace, dashed creation preview at 0.6 opacity

**Starting phase:** 14 (v2.2 ended at Phase 13)
**Reference codebase:** `/Users/isaiahcalvo/Desktop/combined-tools` (Fabric.js 6.9.1, same author)
**Research approach:** Dual-codebase audits in `.planning/research/COMBINED-TOOLS-AUDIT.md` + `.planning/research/CURRENT-REPO-AUDIT.md` (port milestone, not new-domain).

## Requirements

### Validated

- ✓ PDF viewing with Syncfusion viewer — existing
- ✓ Fabric.js annotation drawing tools (pen, shapes, callouts, regions) — existing
- ✓ Annotation persistence via Supabase — existing
- ✓ Search highlights overlay — existing
- ✓ Lightweight proxy rendering during pan/scroll — existing
- ✓ Undo/redo for annotations — existing
- ✓ Overlay divs as direct children of Syncfusion page divs — v1.0 Phase 1
- ✓ CSS transform zoom handling on overlay divs — v1.0 Phase 2
- ✓ React portals render into persistent overlay divs — v1.0 Phase 3
- ✓ SVG display layer for all 7 annotation types with viewBox auto-scaling — v2.0 Phase 8
- ✓ SVG selection, drag, resize, multi-select — v2.0 Phase 9
- ✓ Fabric.js Canvas mount-on-demand for pen/eraser — v2.0 Phase 10
- ✓ Targeted Canvas for text/shape/callout editing + zero-timer zoom — v2.0 Phase 11
- ✓ Circle edit handle alignment, live scaling, clipping fixes — post-v2.0 cleanup (2026-04-12)
- ✓ Shape rotation soft-snaps to 45° increments while Shift is held (3° threshold) — v2.1 Phase 12 (EDIT-11)
- ✓ Rotation degree input field near the rotation handle for exact typed angles — v2.1 Phase 12 (EDIT-12)
- ✓ Zoom floor lowered to 10% — v2.1 Phase 12 (ZOOM-09)
- ✓ Dual-path SVG↔Fabric edit parity for rect/circle/ellipse — v2.1 Phase 12 (9 gap bugs)
- ✓ Rotation pill re-arms on hover after returning from edit mode via click-off — v2.2 Phase 13 (EDIT-13)
- ✓ No Fabric transform handles in edit mode for any shape (Figma-style separation) — v2.2 Phase 13 (EDIT-14 rescoped)

### Active (v2.3 Tools Polish — 26 requirements in REQUIREMENTS.md)

See `.planning/REQUIREMENTS.md` for the full REQ-IDed list. Summary:

- LINE-01..06 (6): curvature handle + reset + endpoint reshape + typeable curvature pill + min drag + mini-toolbar
- ARROW-01..07 (7): same as line + curved-tangent arrowhead + 6-style arrowhead picker
- CALL-01..10 (10): 30-px collisions + rollback + resize fix + hover handles + Liang-Barsky auto-route + empty-text self-destruct + hover glow + **SVG unification (render via foreignObject like text annotations, replace `src/components/Callout/` directory)**
- UX-01, KBD-01, CREATE-01 (3): crosshair cursor + Delete/Backspace + dashed creation preview

### Out of Scope

- Changes to annotation data model or Supabase storage format — SVG reads same Fabric.js JSON
- Changes to Syncfusion PDF viewer configuration — viewer layer unchanged
- Real-time collaborative editing — future milestone
- Mobile/touch gesture support beyond basic pinch zoom — future milestone
- Widen zoom range beyond 500% ceiling — deferred (PERF-02); 10% floor shipped in v2.1
- Fabric edit canvas shape rotation snap — SVG-path snap only for v2.1, Fabric-path rotation out of scope
- Blur-commit and invalid-value revert for RotationInputField — de-scoped in v2.1 12-02 UAT
- SVG select-mode flip for line/arrow/path/text — only rect/circle/ellipse supported (v2.1)
- Rotation handle relocation when off-screen — closed `wontfix_superseded_by_typed_input` (v2.2)
- Upgrading Fabric.js 5.5.2 → 6.x — port behavior, not engine (v2.3)
- New tool types beyond line / arrow / text callout in v2.3 — tight scope
- Rectangle / circle / pen / highlighter / eraser polish in v2.3 — deferred

## Context

- Reference app at `/Users/isaiahcalvo/Desktop/Syncfusion-PDF-App` uses SVG overlays with viewBox, zero zoom timers
- Industry standard: Nutrient/PSPDFKit, PDF.js, pdf-annotate.js, Hypothesis all use SVG for annotations
- v1.0 Phases 1-3 established overlay div foundation (still valid)
- v2.0 shipped 2026-04-10: SVG display + Fabric.js edit-only fully landed; zero-timer zoom working
- v2.1 shipped 2026-04-14: shape edit rotation precision + zoom floor 10%
- v2.2 shipped 2026-04-14: rotation handle polish
- **v2.3 reference:** `/Users/isaiahcalvo/Desktop/combined-tools` is the target UX — Fabric.js 6.9.1, React 18 + TypeScript, Tailwind + shadcn/ui, same author as this app. combined-tools uses pure Fabric.js for both display and edit; this app uses SVG display + Fabric-edit-only post-v2.0, so exact copy is unlikely — feature parity accepted over pixel parity.
- v2.3 known gaps at kickoff: no middle curvature handles on line/arrow, text callout handle collision, text callout resize issues
- Counter-tool session shipped 2026-04-14 (`feat(counter): Step 7 mini-toolbar + edit-mode handle hide + zoom sizing fixes`, commit `8ac818bc`) — no longer a collision lane
- Reusable patterns graduated from v2.1: (a) drag-rotate optimistic-paint pattern for commit-path latency; (b) full-click-cycle stopPropagation on portaled UI inside interactive SVG layer

## Constraints

- **Fabric.js**: Stay on 5.5.2 for the edit canvas — do NOT upgrade to 6.x even though combined-tools is on 6.x. Fabric 5.5.2 is load-bearing.
- **Data model**: Same Fabric.js JSON format — no migration needed, SVG reads it directly
- **Browser support**: SVG `vector-effect: non-scaling-stroke` supported in Chrome, Firefox 15+, Safari 5.1+, Electron
- **Architecture**: SVG display + Fabric-edit-only is locked — any combined-tools pattern that assumes an always-mounted canvas must be adapted to the mount/unmount model

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| SVG display + Fabric.js edit-only (v2.0) | 5-timer system intractable after 4 failed fixes; industry standard is SVG | ✓ Good — shipped 2026-04-10 with zero-timer zoom |
| Keep same Fabric.js JSON data model | Zero migration, SVG reads same format, undo/redo unchanged | ✓ Good — zero data migration across v2.0–v2.2 |
| Use `<foreignObject>` for text annotations | Fabric's toSVG has text positioning bugs | ✓ Good — shipped in v2.0 Phase 8 |
| Mount/unmount Canvas per edit session | 5-15ms creation cost negligible, massive memory savings | ✓ Good — shipped in v2.0 Phase 10/11 |
| EDIT-11 as pure helper + one-line wire (v2.1) | Matches Fabric `snapThreshold` convention; unit-testable at the boundary | ✓ Good — shipped |
| ZOOM-09 as atomic 2-file commit (v2.1) | Cannot be split without producing broken intermediate state | ✓ Good — shipped in `df43b0f8` |
| Plan 12-01 scope expansion — fold 9 gap bugs (v2.1) | Dual-path SVG↔Fabric edit parity landing coherently in one plan > deferring | ✓ Good — architectural lift unified |
| Phase 12 close via Option A (v2.1) | Ship the three core requirements now, backlog Gaps 3+4 to v2.2 | ✓ Good — closed in v2.2 |
| EDIT-14 rescoped mid-plan (v2.2) | Original AC (mtr visible on pre-rotated edit entry) unsolvable in narrow lane; "no Fabric transform handles in edit mode" delivered the underlying Figma-style intent | ✓ Good — RECONCILIATION.md documents rescope |
| Canvas 2D vs SVG rasterizer delta is NOT fixable in JS | Mathematically confirmed in Phase 11; rasterizers are different engines | ✓ Good — no more pixel-snapping hacks |
| v2.3 port combined-tools UX over upgrading to Fabric 6.x | Upgrade risk > port risk; Fabric 5.5.2 is load-bearing | — Pending |
| v2.3 feature parity accepted over pixel parity | Rendering engines differ (SVG vs Canvas); user approved feel-match | — Pending |
| v2.3 replace GSD domain research with dual-codebase port audit | Port milestone, not new-domain milestone | — Pending |
| v2.3 scope expansion: rewrite permission + 26 reqs (was 14) | User: "the current tools suck...don't worry about preserving anything". Copy combined-tools as behavioral baseline, then add on. | — Pending |
| v2.3 **unified render**: callout onto SVG pipeline (CALL-10) | User: "I want all annotations to render the same — different rendering makes selection, editing, erasing, undo difficult". Replaces `src/components/Callout/` HTML-overlay system with foreignObject pattern (like text annotations). | — Pending |
| v2.3 curvature indicator = hover-reveal pill mirroring RotationInputField UX | User explicitly asked for the rotation-pill pattern on the midpoint handle: hover-reveal + typeable input + optimistic commit. Proven v2.1 pattern. | — Pending |
| v2.3 line/arrow "act like regular shapes" = mini-toolbar + standard select lifecycle | User: line/arrow should inherit the same select/edit/mini-toolbar pattern as rect/circle/ellipse. Unification of interaction UX, not just rendering. | — Pending |

---
*Last updated: 2026-04-14 after v2.3 scope revision (14 → 26 reqs, rewrite permission, unified render decision)*
