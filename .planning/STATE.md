---
gsd_state_version: 1.0
milestone: v2.3
milestone_name: Tools Polish
status: Plan 27-05 shipped — React surface for the CRDT foundation landed (YDocProvider context + useYDoc hook + StorageFailureBanner with all 4 copy variants per 27-UI-SPEC.md). YDocProvider mounted at App.jsx document-open boundary via per-phase narrow waiver (1 import + 1 JSX wrap around <PDFViewer>). Live UAT verified single-user round-trip — pen-stroke drawn, page refreshed, stroke reappeared. applyUpdate-only invariant remains green; license gate green; test baseline preserved (290/6/3); always-protected files (PAL/Fabric/SVG/vite.config.js) byte-identical except App.jsx narrow waiver. Phase 27 functionally complete (5/5 plans); next step is /gsd:verify-work 27 + 27-RECONCILIATION.md.
stopped_at: Completed 27-05-PLAN.md (YDocProvider + useYDoc + StorageFailureBanner + App.jsx narrow waiver mount; live UAT confirmed single-user round-trip)
last_updated: "2026-04-27T19:56:19.764Z"
last_activity: "2026-04-27 — Plan 27-05 executed (2 auto tasks + 1 checkpoint:human-verify, 2 commits: fe100060 / ae91f9fb; user approved after live UAT round-trip)"
progress:
  total_phases: 14
  completed_phases: 3
  total_plans: 14
  completed_plans: 13
  percent: 93
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-14)

**Core value:** Line/arrow/text-callout tools match the precision and feel of the `combined-tools` reference app, AND all annotations render through the same SVG pipeline for a unified select / edit / erase / undo story.
**Current focus:** Milestone v2.3 — Phase 15 in progress (Plans 15-01 Wave 0 + 15-02 Wave 1 renderer + 15-03 Wave 1 interaction all shipped 2026-04-17; phase close pending reconciliation).

## Current Position

Milestone: v2.4 — CRDT Foundation + Real-Time Sync (Yjs port; SVG/Fabric layers immutable)
Phase: **Phase 27 — CRDT Foundation** (5/5 plans shipped 2026-04-27; functionally complete, awaiting `/gsd:verify-work 27` + 27-RECONCILIATION.md)
Plan: 27-05 — complete (src/components/collab/YDocProvider.jsx shipped — React context provider mounting ydocLifecycle for the active doc; src/hooks/useYDoc.js shipped — context-consumer hook returning the locked shape; src/components/collab/StorageFailureBanner.jsx shipped — banner with all 4 copy variants per 27-UI-SPEC.md, role=alert, aria-live=polite, dismiss button; src/components/collab/StorageFailureBanner.css shipped — locked CSS variables + 2 type weights + .svg-annotations--hydrating/--hydrated fade-in classes for the deferred wrapper-div opt-in; src/App.jsx — per-phase narrow waiver: 1 import + 1 JSX wrap around <PDFViewer> with docId={tab.file?.id}, all other Always-Protected files byte-identical, zoomGeneration signal preserved; live UAT verified single-user round-trip — pen-stroke drawn, page refreshed, stroke reappeared). Next: `/gsd:verify-work 27` to run the full Phase 27 verification baseline, then write 27-RECONCILIATION.md per CLAUDE.md phase discipline rules, then `/gsd:discuss-phase 28` for the transport spike + auth + server validator.
Status: Plan 27-05 shipped — React surface + App.jsx mount landed. Phase 27 functionally complete (5/5 plans); CRDT foundation end-to-end functional for single-user persistence. applyUpdate-only invariant remains green; license gate green; test baseline preserved (290 pass / 6 fail pre-existing / 3 skipped — identical to pre-Plan-27-05). Always-Protected file scope honored — only the per-phase narrow App.jsx waiver was used (1 import + 1 JSX wrap; +27 / -24 lines, 24 deletions = re-indentation of wrapped block, NOT logical removals).
Last activity: 2026-04-27 — Plan 27-05 executed (2 auto tasks + 1 checkpoint:human-verify, 2 commits: fe100060 / ae91f9fb; user approved after live UAT round-trip)

Progress: [██████████] 100% Phase 27 functionally complete (5/5 plans); v2.4 milestone overall: 5/5 of Phase 27, 0/4 of Phase 28-29-32-33-34 (those phases not yet planned/executed); v2.3 closed at Phase 15

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
| Phase 15 P01 | 7min | 3 tasks | 10 files |
| Phase 15 P02 | 6min | 3 tasks | 7 files |
| Phase 15 P03 | 11min | 4 tasks | 5 files |
| Phase 27 P03 | 2min | 2 tasks | 2 files |
| Phase 27 P01 | 11min | 3 tasks | 13 files |
| Phase 27 P02 | 3min | 2 tasks | 4 files |
| Phase 27 P04 | 4min | 3 tasks | 5 files |
| Phase 27 P05 | 3min | 3 tasks | 5 files |

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
- [Phase 15]: Plan 15-01: file-level `test.describe.skip` wrapper with dynamic `await import('../src/utils/lineRenderHelpers.js')` inside the body — Plan 15-02 flips the single `describe.skip` → `describe` to un-skip the whole file atomically. Dynamic import inside the skipped describe prevents `ERR_MODULE_NOT_FOUND` while the helper does not yet exist.
- [Phase 15]: Plan 15-01: sidestepped pre-existing node-canvas NODE_MODULE_VERSION 116↔127 mismatch by simulating Fabric.Line.toJSON(['data']) shape in tests instead of importing fabric directly. Logged rebuild follow-up in 15-deferred-items.md (infra, out of Plan 15-01 zero-src-change scope).
- [Phase 15]: Plan 15-02: straight branch byte-identical to pre-Phase-15 renderLine. buildLineRenderSpec's straight branch reproduces the exact center-relative x1/y1/x2/y2 + lineEndX/lineEndY shortening for filled-triangle arrowheads. Verified by tests/svgLineRenderer.test.mjs #1 + #2.
- [Phase 15]: Plan 15-02: two entry points for arrowhead rendering. Module-scoped renderArrowheadFromSpec(spec) is single source of truth for kind→element mapping. Exported renderArrowhead(style,tipX,tipY,angleDeg,color,sw) wraps buildArrowheadRenderSpec + dispatches. Internal renderLine curved branch bypasses buildArrowheadRenderSpec (spec already in spec.arrowhead).
- [Phase 15]: Plan 15-02: Playwright phase15-arrowhead-styles.spec.mjs kept as test.fixme (plan-sanctioned fallback). No window.__test_injectAnnotation hook in src/ today. Plan 15-03 annotation-injection harness is the natural unblocker. Spec-level contract already locked by 14 unit tests (svgLineRenderer + renderArrowhead).
- [Phase 15]: Plan 15-03: Pitfall-2 defensive preserve-write in endpoint drag pointermove + pointerup using ds.originalMidpoint captured at dispatch. Auto-revert via shouldRevertEndpointCurve + getLineEndpoints(targetObj) canonical endpoint derivation (dodges stale Fabric bbox reads).
- [Phase 15]: Plan 15-03: lineDragMath.js extracted as pure-JS helper module with zero React/DOM deps — Node --test unit-testable without JSX loader. Matches Phase 14 buildCalloutRenderSpec precedent. 5 exports (deriveMidpointFromPointer, shouldRevertEndpointCurve, applyMidpointToAnnotation, clearMidpointFromAnnotation, resolveMidpointHandlePosition) cover the full drag-commit contract.
- [Phase 15]: Plan 15-03: 3 Playwright primary-case scenarios upgraded to real UI-driven flows with runtime-skip fallback (Phase 14 pattern); 3 secondary-case scenarios kept as test.fixme because app does not expose window.__injectAnnotation test hook. Contract locked by unit tests instead (tests/lineDragMath.test.mjs + Plan 15-02's svgLineRenderer.test.mjs + renderArrowhead.test.mjs).
- [v2.4]: Phase 27 Plan 03 ships AUTH-03 as a schema-level enforcement (server_ts TIMESTAMPTZ NOT NULL DEFAULT NOW()) on doc_yjs_updates AND activity_log — application code physically cannot insert without it. Inline COMMENT ON COLUMN documents the AUTH-03 attribution in pg_description for Supabase Studio visibility.
- [Phase 27]: Plan 27-03: stub deny-all RLS policies named `<table>_phase27_stub_deny_all` so Phase 28 can DROP POLICY by exact name without ambiguity. Forward migration is fully idempotent (CREATE TABLE/INDEX IF NOT EXISTS + DROP POLICY IF EXISTS before each CREATE POLICY). Defends Pitfall 1.
- [Phase 27]: Plan 27-03: bytea-from-day-one for update + state + state_vector columns. No TEXT columns for binary data. encoding_version SMALLINT NOT NULL DEFAULT 1 ships in initial schema so future Yjs encoding versions roll forward by writing a different value, no schema migration. Defends Pitfalls 15 + 17.
- [Phase 27]: Plan 27-03: rollback file uses defensive DROP POLICY + DROP INDEX before DROP TABLE CASCADE, all idempotent (IF EXISTS). FK ON DELETE CASCADE on documents(id) means document deletion auto-cleans Y.Doc updates, snapshots, and activity log.
- [Phase 27]: Plan 27-01 Option A: license allowlist expanded with BlueOak-1.0.0/Python-2.0/Zlib + @syncfusion/* paid-EULA waiver + 6 per-package legacy waivers; AGPL/GPL/SSPL hard-block intact
- [Phase 27]: Plan 27-01: custom JSON parser instead of license-checker --onlyAllow flag — handles compound license strings (OR=consumer-picks, AND=all-required), 12-case in-script self-test verifies AGPL still blocks under both compound forms
- [Phase 27]: Plan 27-01: per-test existence-guard skip pattern (skip: !existsSync(file)) — Wave 0 tests auto-flip from skip to run when later plans land their respective production modules; cleaner than Phase 15's file-level describe.skip wrapper for plans owning multiple modules
- [Phase 27]: Plan 27-02: HMR-safe registry via globalThis.__ydocRegistry__ Map stash + autoLoad:false on Y.Doc construction locks applyUpdate-only invariant at constructor; releaseYDoc never destroys (Pitfall 21); Plan 27-01's 6 scaffolds flip skip→green automatically. Test baseline 280→286 pass.
- [Phase 27]: Plan 27-04: Web Locks election on `y-doc-${documentId}` with `mode:'exclusive'` + never-resolving callback promise gates IndexeddbPersistence to a single leader tab — defends Pitfall 2 (yjs/y-indexeddb#25 multi-tab corruption) by code, not convention. Loser tabs participate via BroadcastChannel + Y.applyUpdate with REMOTE_BC_ORIGIN frozen-object reference for echo-loop short-circuit.
- [Phase 27]: Plan 27-04: storageFailureDetector emits stable codes ('quota_exceeded' / 'invalid_state' / 'version_mismatch') from window.unhandledrejection — defends silent-fallback anti-pattern (CONTEXT.md decision). options.windowRef test-injection seam preserves SSR safety while supporting Plan 27-01 scaffold's fakeWindow contract.
- [Phase 27]: Plan 27-04: crdtFeatureFlag.isCRDTEnabled() three-tier read order (localStorage CRDT_LAYER_DISABLED='1' > VITE_CRDT_LAYER_DISABLED='1' > default ON). Read-only API — no setter exposed; developers toggle via DevTools. Silent kill switch (zero console calls).
- [Phase 27]: Plan 27-04: Aligned Plan 27-01 storageFailureDetector scaffold to locked Pattern 4 `{detach}` return shape (4 destructuring sites) — Rule 3 blocking fix needed for scaffold flip skip→green per plan success criterion.
- [Phase 27]: Plan 27-04: ydocLifecycle.js self-documenting comment rewritten to avoid the literal applyUpdate-only invariant grep pattern (`a Y.Doc directly` instead of the regex-matchable form) — Rule 3 blocking fix to keep invariant test green while still documenting the rule.
- [Phase 27]: Plan 27-05: YDocProvider mount point chosen as the OUTERMOST `<PDFViewer>` wrap in App.jsx (line 38607) with `docId={tab.file?.id}`, NOT around `<SyncfusionPDFContainer>` at line 28519. Plan permitted both options; outer mount means the entire viewer subtree (sidebar, toolbars, annotation layers, banner host) sits inside Y.Doc context — matches the plan's "attach as early as possible after pdfFile.id becomes truthy" guidance.
- [Phase 27]: Plan 27-05: Outer YDocProvider component is a pure routing branch (kill switch / null docId returns frozen null-shape context without calling useEffect). Only the inner YDocProviderInner (keyed on docId) owns stateful hooks — React rules-of-hooks safe and `key={docId}` forces a clean state reset on PDF switch (no stale isHydrating / storageState bleed across documents).
- [Phase 27]: Plan 27-05: 100ms role-polling interval auto-clears once role becomes 'leader' or 'loser' (Web Locks election resolves async). Avoids exposing onRoleChange in the lifecycle public API; trade-off is 1-2 frames of 'unknown' on a fresh mount, acceptable because no UI reads role yet (Phase 33 presence pill is the first consumer).
- [Phase 27]: Plan 27-05: 500ms hydration timeout fallback per 27-UI-SPEC.md acceptance criterion ("annotations visible within <500ms of document open"). Caps the perceived wait when IndexeddbPersistence 'synced' never fires (fresh doc with no cached state).
- [Phase 27]: Plan 27-05: Wrapper-div fade-in opt-in deliberately deferred. .svg-annotations--hydrating / --hydrated CSS classes ship in StorageFailureBanner.css (single source of truth for Phase 27 visual polish), but no wrapper applies them yet because doing so would either touch SVGAnnotationLayer.jsx (Always-Protected) or extend the App.jsx waiver beyond "mount only". Phase 32 hardening can pick this up; for now annotations appear instantly, which Plan 27-05 UAT step 1 explicitly accepts.
- [Phase 27]: Plan 27-05: Manual storage-banner UAT replaced with automated test coverage. Modern browsers (Chrome incognito included) permit IndexedDB by default so the banner does not fire under the planned scenario. User accepted Plan 27-01's 4 scaffold tests + Plan 27-04's 8 co-located tests as sufficient coverage. Banner code reviewed against 27-UI-SPEC.md verbatim (all 4 codes, role=alert, aria-live=polite, dismiss button, sticky positioning, locked CSS variables, 2 type weights).
- [Phase 27]: Plan 27-05: Banner uses exactly 2 type weights (400 / 600), zero deviation from 27-UI-SPEC.md. font-weight: 600 reserved for the heading; body, action link, secondary metadata, dismiss button all 400. Action link interactivity signaled by underline + accent color (#4A90E2), NOT by font weight — matches Linear / Notion link convention.

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

Last session: 2026-04-27T19:55:46.073Z
Stopped at: Completed 27-05-PLAN.md (YDocProvider + useYDoc + StorageFailureBanner + App.jsx narrow waiver mount; live UAT confirmed single-user round-trip)

### Resume instructions for the next session (read carefully)

**One-line wake-up:** "Resume v2.4. Phase 27 functionally complete (5/5 plans). Live UAT confirmed single-user Y.Doc round-trip. Next step: `/gsd:verify-work 27` for the full Phase 27 verification baseline, then write `.planning/phases/27-crdt-foundation/27-RECONCILIATION.md` per CLAUDE.md phase discipline rules, then `/gsd:discuss-phase 28` to kick off the transport spike + auth + server validator."

**Workflow steps:**

1. Run `/gsd:verify-work 27` — executes the Phase 27 verification baseline (applyUpdate-only invariant grep + license gate + co-located test suites + the 5 phase27 Playwright scenarios still test.fixme'd, optional un-fixme as part of verification)
2. Manually re-confirm UAT if desired: open `Package 2 - Rev 4 -- IC.pdf` at Page 6, draw an annotation, refresh, confirm persistence (already verified once during Plan 27-05 close)
3. Write `.planning/phases/27-crdt-foundation/27-RECONCILIATION.md` per `~/.claude/CLAUDE.md` phase discipline rules:
   - Plan vs Actual deltas (5 plans landed; CONTEXT.md acceptance criteria 1, 2, 5, 6, 7, 8 verified; AC 3 & 4 deferred to Phase 29 / Electron main-process work; AC 5 substituted automated test coverage for manual incognito test per user approval)
   - Acceptance Criteria results (all 8 from 27-CONTEXT.md, with verification map per 27-05-SUMMARY.md "Reconciliation Prep" section)
   - Boundaries Honored: DO NOT CHANGE list — package.json (Plan 27-02 waiver, scoped) + src/App.jsx (Plan 27-05 narrow waiver, mount only); all other Always-Protected files byte-identical
   - Lessons / Carry-forward (wrapper-div fade-in opt-in deferred to Phase 32; Plan 27-01 Playwright scenarios still test.fixme — naturally unfreezes with Phase 29 Fabric ↔ Y.Map binding)
   - Status: DONE | DONE_WITH_CONCERNS (concerns: deferred fade-in wrapper, deferred Playwright un-fixme — both already documented as planned deferrals)
4. Commit the phase closure
5. `/gsd:discuss-phase 28` → Phase 28 (transport spike + auth + server validator). Phase 27 schema (doc_yjs_updates + doc_yjs_state + activity_log) is ready; lifecycle layer's onStorageState channel is ready to extend with transport_offline codes.

**Watch-outs for the next session:**

- Do NOT touch `src/components/PageAnnotationLayer.jsx`, `src/components/FabricDrawingCanvas.jsx`, `src/components/FabricEraserCanvas.jsx`, `src/components/FabricEditCanvas.jsx`, `src/components/SVGAnnotationLayer.jsx`, `vite.config.js` without an explicit per-phase waiver. `src/App.jsx` and `package.json` waivers granted for Phase 27 are scoped to that phase only and do NOT carry forward.
- The 5 phase27 Playwright scenarios are still `test.fixme`'d. The single-user round-trip is unblocked, but the two-tab-sync scenarios depend on Phase 29's Fabric ↔ Y.Map binding to make annotations visible across tabs. Naturally defer the un-fixme to Phase 29 (or a Phase 27 follow-up plan if reconciliation wants green Playwright as a gate).
- The wrapper-div fade-in opt-in (`.svg-annotations--hydrating` / `--hydrated` CSS classes ship in StorageFailureBanner.css; no wrapper applies them yet) is the natural Phase 32 hardening pickup.
- Pre-existing working tree WIP from Phase 14 may still be uncommitted in some untracked files (`HANDOFF.md`, `scripts/make-test-pdf.cjs`). Plan 27-05 deliberately did not touch them — they belong to separate lanes.
- The Cmd/Ctrl+S UX patch (`477fe90e`) committed during the Plan 27-05 UAT pause is non-phase scope. Confirm it's in good shape; not a Phase 27 concern.
