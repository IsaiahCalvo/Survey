# Roadmap: PDF Annotation App

## Milestones

- [x] **v1.0 Zoom Flicker Fix** — Phases 1-3 (shipped 2026-03-19), Phases 4-7 superseded/deferred
- [x] **v2.0 SVG Migration** — Phases 8-11 (shipped 2026-04-10) — [archive](milestones/v2.0-ROADMAP.md)
- [x] **v2.1 Shape Edit Polish & Foundation Wins** — Phase 12 (shipped 2026-04-14, DONE_WITH_CONCERNS) — [archive](milestones/v2.1-ROADMAP.md)
- [x] **v2.2 Rotation Handle Polish** — Phase 13 (shipped 2026-04-14)
- [x] **v2.3 Tools Polish (combined-tools rewrite)** — Phases 14-15 shipped 2026-04-17 (CALL-10 + line/arrow curvature wiring); Phases 16-18 PARKED (mini-toolbar / callout collisions / auto-routing — superseded by v2.4 data-integrity priority); Phase 19 (AutoCAD selection) status TBD. Status: DONE_WITH_CONCERNS.
- [ ] **v2.4 Multi-User Collaboration (CRDT Rebuild)** — Phases 27-34 (planning, 28 requirements). Yjs CRDT replaces last-write-wins simple-sync; per-user undo + offline merge + activity log + 4-role permissions + device attribution. ~2 months realistic. Highlights stay on legacy path through v2.4 (folded into v2.5). See [research summary](research/SUMMARY.md).
- [ ] **v3.0 PDF-Native Annotations (bake-on-export)** — Phase 20 (Foundations DONE 2026-04-25), Phases 21-26 (B–G outlined; concrete tasks land per-phase) — [plan](../docs/superpowers/plans/2026-04-25-pdf-native-annotations.md). Parallel work to v2.4.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

<details>
<summary>v1.0 Zoom Flicker Fix (Phases 1-7) - Phases 1-3 SHIPPED 2026-03-19</summary>

- [x] **Phase 1: Overlay Attachment Foundation** - Persistent overlay divs as direct children of Syncfusion page divs (completed 2026-03-18)
- [x] **Phase 2: Zoom Handler** - CSS transforms on overlay divs during zoom for visual stability (completed 2026-03-18)
- [x] **Phase 3: Render Loop Rewrite** - React portals render into persistent overlay divs (completed 2026-03-19)
- [ ] ~~**Phase 4: PAL Zoom Simplification**~~ - Superseded by SVG migration (4 failed attempts)
- [ ] ~~**Phase 5: Page Container Re-attachment**~~ - Superseded by SVG migration
- [ ] ~~**Phase 6: Dead Code Removal**~~ - Superseded by SVG migration
- [ ] ~~**Phase 7: Widen Zoom Range**~~ - Deferred to future milestone

</details>

<details>
<summary>v2.0 SVG Migration (Phases 8-11) - SHIPPED 2026-04-10</summary>

- [x] **Phase 8: SVG Display Foundation** - All 7 annotation types render as SVG with viewBox auto-scaling, replacing Canvas-based display
- [x] **Phase 9: SVG Selection and Interaction** - Click-to-select, drag-to-move, resize handles, and multi-select in SVG without Canvas
- [x] **Phase 10: Canvas Mount/Unmount (Pen + Eraser)** - Fabric.js Canvas mounts conditionally for pen/highlighter drawing and eraser operations (completed 2026-03-27)
- [x] **Phase 11: Text/Shape Editing + Zoom Cleanup** - Targeted Canvas mount for text/shape editing, zoom integration, and removal of old timer machinery (completed 2026-04-02)

</details>

<details>
<summary>v2.1 Shape Edit Polish & Foundation Wins (Phase 12) — SHIPPED 2026-04-14 (DONE_WITH_CONCERNS)</summary>

- [x] **Phase 12: Shape Edit Polish** — Soft Shift-snap at 45° with 3° threshold (EDIT-11), rotation degree input field for exact angles (EDIT-12, delivered with 2 polish gaps), zoom floor lowered to 10% (ZOOM-09) (completed 2026-04-14)

See [`milestones/v2.1-ROADMAP.md`](milestones/v2.1-ROADMAP.md) for full phase details, 3-plan breakdown, decisions, issues resolved/deferred, and carry-forward lessons.

</details>

<details>
<summary>v2.2 Rotation Handle Polish (Phase 13) — SHIPPED 2026-04-14</summary>

- [x] **Phase 13: Rotation Handle Edit-Mode Polish** — Hover pill re-arm via event delegation (EDIT-13) + rescoped "no Fabric transform handles in edit mode" (EDIT-14, Figma-style separation under narrow waiver)

</details>

### v2.3 Tools Polish (combined-tools rewrite + unified render)

- [ ] **Phase 14: Unified SVG Callout Render + Shared Tool Foundation** — Port the text callout off its current HTML-overlay React system onto the same SVG pipeline all other annotations use (via `<foreignObject>`), and land the three cross-tool interaction foundations (crosshair cursor, Delete/Backspace, dashed creation preview) while the SVG interaction layer is already being touched for callouts.
- [ ] **Phase 15: Line/Arrow Curvature + Arrowhead Styles** — Wire the already-ported `lineGeometry.js` curvature math (`getCurvedPath` / `getCurveEndAngle` / `shouldSnapToLinear`) into the SVG renderers + `useSVGInteraction.js` midpoint drag mode, and lift the 6-style arrowhead enum from the callout system into the line/arrow data model + render.
- [ ] **Phase 16: Line/Arrow Mini-Toolbar + Curvature Pill + Min-Drag** — Line/arrow "act like regular shapes" with a mini-toolbar matching rect/circle/ellipse lifecycle, a hover-reveal typeable curvature pill mirroring the v2.1 `RotationInputField` + `applyOptimisticRotation` pattern, and a minimum-drag-length threshold on creation.
- [ ] **Phase 17: Callout Handle Collisions + Rollback + Resize** — 30-px collision constraints between arrowTip/knee/textbox handles, whole-callout snap-back on drop into invalid configurations, and correct corner-resize geometry at all zoom levels (fix four underlying issues enumerated in CURRENT-REPO-AUDIT.md Gap 3).
- [ ] **Phase 18: Callout Auto-Routing + Hover Affordances + Self-Destruct** — Liang-Barsky auto-routing so the knee wraps around the textbox without the connector lines crossing the interior, hover-reveal knee/arrowTip handles with 50 ms hide delay, selection-preview hover glow, and empty-text self-destruct on edit-mode exit.
- [ ] **Phase 19: AutoCAD Window + Crossing Selection** — Port the dormant AutoCAD-style marquee selection from the Fabric canvas layer to the SVG selection surface. Drag left-to-right draws a solid blue box that selects only annotations fully enclosed; drag right-to-left draws a dashed green box that selects any annotation the box touches. Reuses existing rectangle-intersection geometry math via a thin adapter — no changes to the geometry library itself.

### v2.4 Multi-User Collaboration (CRDT Rebuild)

**Phase numbering note:** Phases 19-26 were already reserved (Phase 19 = v2.3 AutoCAD selection; Phases 20-26 = v3.0 PDF-Native Annotations parallel milestone). v2.4 numbering starts at **Phase 27** to avoid collision with v3.0's reserved range.

**Sequencing:**
- Phases 27 → 28 → 29 are strict-sequential (foundation must land before transport spike, transport must be decided before Fabric↔Yjs binding).
- Phases 30 (migration dual-write) → 31 (migration cutover seal) are sequential — cutover depends on dual-write era stability.
- Phases 32 (multi-tab + persistence hardening) and 33 (activity log + awareness) are **parallelizable** — independent file lanes after Phase 31.
- Phase 34 (sharing UX + revocation) is last — depends on activity log (33) and seal flag (31).

**Milestone-level concerns (carry-forward to every v2.4 phase plan):**
- Always-Protected files (`src/App.jsx`, `src/components/PageAnnotationLayer.jsx`, `src/components/FabricDrawingCanvas.jsx`, `src/components/FabricEraserCanvas.jsx`, `src/components/FabricEditCanvas.jsx`, `src/components/SVGAnnotationLayer.jsx`, `package.json`, `vite.config.js`) are protected by default. Most v2.4 phases need narrow-lane waivers for App.jsx (auth surfaces, sharing modals, activity log sidebar mounts, Cmd+Z handler rewire) and `package.json` (yjs deps land in Phase 27).
- Top 5 critical pitfalls (any one = data loss / security breach): (1) Migration partial-state — old clients keep writing legacy rows during rollout; defended by Phase 30/31 dual-write + seal. (2) y-indexeddb multi-tab corruption (yjs/y-indexeddb#25) — defended by Web Locks election in Phase 27. (3) Y.Doc vs RLS mismatch — removed collaborator's local Y.Doc keeps accepting edits silently rejected on flush; defended by Phase 28 server-side validator + Phase 34 forced local destroy. (4) Echo loop — local Fabric event → Y.Map → observer fires → Fabric → loop; defended by mandatory transaction-origin pattern in Phase 29. (5) 1-second verify-wipe regression (the simple-sync killer in CRDT clothing) — defended by applyUpdate-only rule in Phase 27.
- Highlights stay on legacy sync path through v2.4 (Excel-sync risk; folded into v2.5).
- SVG-display + Fabric-edit-on-demand split is load-bearing and immutable; CRDT layer wraps under it, never replaces.

- [x] **Phase 27: CRDT Foundation (Yjs install + per-doc Y.Doc + IndexedDB persistence)** — Install `yjs@^13.6.30` + `y-protocols@^1.0.7` + `y-indexeddb@^9.0.12`, build `<YDocProvider docId>` mounted at document-open boundary, Y.Doc registry keyed by document_id, Web Locks election for multi-tab safety, snapshot architecture (`doc_yjs_state` + `doc_yjs_updates` schema design), `applyUpdate`-only-never-replace rule, license CI gate. Defends pitfalls 1, 2, 5, 10, 12, 15, 17, 20, 21, 22. **Functionally complete 2026-04-27 (5/5 plans); awaiting `/gsd:verify-work 27` + 27-RECONCILIATION.md.**
- [x] **Phase 28: Transport Spike + Auth + Server Validator (TIMEBOX 1 WEEK)** — Build a custom Supabase Realtime adapter (~150-300 LOC default) AND a Hocuspocus prototype side-by-side; benchmark against go/no-go criteria (binary frame stability, 2-5 concurrent peer load, server-side update validator capability). Lock the transport choice. Land RLS policies on `doc_yjs_updates` + `doc_yjs_state`. Defends pitfalls 3, 14, 15, 16. **Functionally complete (6/6 plans).**
- [x] **Phase 29: Fabric ↔ Yjs Binding + Per-User Undo (HIGHEST RISK)** — `crdtAnnotationBridge.js` (one-direction-at-a-time Fabric ↔ Y.Map), origin tags (`{source:'local-fabric',userId,deviceId,sessionId}`), `applyingRemote` guard, `Y.UndoManager` with `trackedOrigins: new Set([clientID])` for per-user undo, registry-based `Map<annoId, FabricObject>` lookup, `useAnnotationsCRDT` hook over `useSyncExternalStore + observeDeep`. Defends pitfalls 4, 6, 7, 8. **Functionally complete (6/6 plans); 29-RECONCILIATION.md DONE_WITH_CONCERNS.**
- [x] **Phase 30: Migration Phase A — Dual-Write Era** — Every new annotation writes BOTH legacy `document_annotations` row AND CRDT update; old clients read legacy column; new clients read CRDT column. Idempotent backfill keyed by `client_anno_id`. No "diff = delete" logic anywhere. Reads never bleed across paths. **Closed 2026-04-29 (7/7 plans); verifier passed 19/19 acceptance criteria; 30-RECONCILIATION.md DONE; 9 carry-forward polish/deferred items tagged for later phases.**
- [ ] **Phase 31: Migration Phase B — Cutover Seal** — `migrated_at` flag on `documents` row, DB trigger / RLS makes legacy table read-only post-seal, v2.3 client opening sealed doc gets "please update" gate (not corrupted data). Source-of-truth flips to Y.Doc.
- [ ] **Phase 32: Multi-Tab + Persistence Hardening** — Web Locks stress-test with 2-tab Playwright scenarios, periodic Y.Doc compaction job, IndexedDB-quota UX, BroadcastChannel for same-user-same-doc cross-tab. Production hardening for offline + cross-device. Parallelizable with Phase 33.
- [ ] **Phase 33: Activity Log + Awareness + Cross-Device Resume** — Server-side `update` listener writes `activity_log` (Postgres, server-authoritative timestamps), filterable sidebar UI (user / device / page / date / action type), click-to-jump, `Y.Awareness` channel for presence pill, "Where am I picking up?" cross-device resume banner, right-click "Tags" + properties three-dot "Tags" surface, sync chip clarity (offline / syncing / up-to-date). Parallelizable with Phase 32.
- [ ] **Phase 34: Sharing UX + Permission Revocation + Legacy Decommission** — 4-role UI (Owner / Editor / Commenter / Viewer), email-invite flow, role change + revoke, `permission_revoked` realtime event → forced local Y.Doc destroy + IndexedDB wipe + "Your access has been removed" notice, decommission `useAnnotationCloudSync` / `cloudSyncMigration` / `cloudSyncQueue` legacy code. Closes v2.4.

## Phase Details

<details>
<summary>v1.0 + v2.0 phase details (collapsed — shipped)</summary>

### Phase 8: SVG Display Foundation
**Goal**: All committed annotations render correctly as SVG elements with browser-native zoom scaling via viewBox, replacing Canvas-based display rendering
**Depends on**: v1.0 Phase 3 (overlay div foundation -- already shipped)
**Requirements**: DISP-01, DISP-02, DISP-03, DISP-04, DISP-05, DISP-06, DISP-07, DISP-08, DISP-09, DISP-10, DISP-11
**Success Criteria** (what must be TRUE):
  1. User sees all 7 annotation types (pen strokes, highlights, lines, arrows, callouts, shapes, text) rendered on the PDF at correct positions -- visually matching the previous Canvas-based rendering
  2. User can zoom in/out using any method and annotations scale smoothly with zero disappearance, zero flicker, and zero JavaScript coordination
  3. Pen and highlighter strokes appear at exactly the correct position (pathOffset handling verified) -- no 50-200px offset errors
  4. Stroke widths on lines, shapes, and arrows remain constant thickness regardless of zoom level (non-scaling-stroke)
  5. Region/space filtering still works -- toggling a space or module shows/hides the correct annotations
**Plans**: 2 plans

Plans:
- [x] 08-01-PLAN.md -- SVGAnnotationLayer core + renderer toggle + tier 1 types (pen, highlights, lines, arrows)
- [x] 08-02-PLAN.md -- Tier 2 types (shapes, text, callouts) + eraser rendering + full PAL-level filtering

### Phase 9: SVG Selection and Interaction
**Goal**: Users can select, move, and resize annotations entirely in SVG without mounting a Canvas
**Depends on**: Phase 8
**Requirements**: INTR-01, INTR-02, INTR-03, INTR-04, INTR-05, INTR-06, INTR-07, INTR-08, INTR-09, INTR-10
**Success Criteria** (what must be TRUE):
  1. User can click an annotation to select it and see a visual highlight with 8 resize handles at corners and midpoints
  2. User can drag a selected annotation to move it, and the annotation stays at the new position after release
  3. User can drag resize handles to scale an annotation, and the annotation renders correctly at the new size
  4. User can select multiple annotations (shift-click), drag them as a group, and delete the group
  5. Double-clicking an annotation transitions to edit mode (the trigger point for Canvas mount in later phases)
**Plans**: 3 plans

Plans:
- [x] 09-01-PLAN.md -- Utility modules + selection hook + SVGSelectionOverlay + wiring into SVGAnnotationLayer
- [x] 09-02-PLAN.md -- Drag-to-move + resize handles + rotation handle
- [x] 09-03-PLAN.md -- Multi-select (shift-click) + group drag/delete + double-click edit trigger

### Phase 10: Canvas Mount/Unmount (Pen + Eraser)
**Goal**: Fabric.js Canvas mounts only when the user activates pen, highlighter, or eraser tools, captures the work, and unmounts cleanly
**Depends on**: Phase 9
**Requirements**: EDIT-01, EDIT-02, EDIT-03, EDIT-04, EDIT-05, EDIT-09, EDIT-10
**Success Criteria** (what must be TRUE):
  1. User selects the pen or highlighter tool, draws strokes on the page, switches to a different tool, and the strokes persist in SVG -- no Canvas remains mounted
  2. User selects the eraser tool, erases part of an existing annotation, switches tools, and the erased result persists in SVG correctly
  3. User switches tools rapidly (pen -> select -> eraser -> pen) and no strokes are lost, no stale Canvas elements remain in the DOM, and no console errors appear
  4. User is mid-stroke when zoom occurs, and the in-progress stroke is auto-committed before Canvas unmounts -- no data loss
**Plans**: 2 plans

Plans:
- [x] 10-01-PLAN.md -- useFabricCanvas hook + FabricDrawingCanvas (pen/highlighter) + App.jsx wiring
- [x] 10-02-PLAN.md -- FabricEraserCanvas (annotation loading + boolean path subtraction) + App.jsx wiring + full verification

### Phase 11: Text/Shape Editing + Zoom Cleanup
**Goal**: Text and shape annotations are editable via targeted Canvas mount, and all old zoom timer machinery is removed
**Depends on**: Phase 10
**Requirements**: EDIT-06, EDIT-07, EDIT-08, ZOOM-01, ZOOM-02, ZOOM-03, ZOOM-04, ZOOM-05, ZOOM-06, ZOOM-07, ZOOM-08
**Success Criteria** (what must be TRUE):
  1. User double-clicks a text annotation, edits the text content inline, clicks away, and the updated text appears in SVG -- Canvas disappears after commit
  2. User double-clicks a shape or callout, modifies its properties (color, stroke, size), and changes persist in SVG after commit
  3. User zooms while Canvas is mounted for editing, and the Canvas receives a CSS transform for visual stability then remounts at correct dimensions after settle
  4. All 6 zoom methods work with zero timer coordination -- no freeze, snapshot, confirm-pending, or settle timers remain in the codebase
  5. Dead props (onScaleApplied, presentationApiRegistry, isHidden) and the old 5-timer zoom system functions are fully removed from App.jsx and PageAnnotationLayer
**Plans**: 2 plans

Plans:
- [x] 11-01-PLAN.md -- FabricEditCanvas component (text/shape/callout editing) + App.jsx edit mode wiring
- [x] 11-02-PLAN.md -- Old 5-timer zoom system removal from App.jsx + dead prop cleanup from PAL + CLAUDE.md update

</details>

### Phase 12 details archived

See [`milestones/v2.1-ROADMAP.md`](milestones/v2.1-ROADMAP.md) for Phase 12's
full goal, dependencies, requirements, success criteria, 3-plan breakdown,
key decisions, issues resolved/deferred, and technical debt.

### Phase 13: Rotation Handle Edit-Mode Polish

**Goal**: Close out the rotation interaction story by fixing the two Phase 12 carry-forward gaps so the rotation handle and its hover pill behave correctly across every edit-mode entry/exit transition. Users should never need a deselect/reselect workaround to re-arm the pill, and a pre-rotated shape should never enter edit mode with a clipped rotation handle.

**Depends on**: Phase 12 (v2.1 — RotationInputField + optimistic-paint pattern + 113/113 test baseline)

**Requirements**: EDIT-13, EDIT-14

**Why a single phase with two plans (not two phases):** Both gaps live in the same narrow interaction surface — rotation handle chrome during edit-mode transitions on shapes selected in `SVGAnnotationLayer.jsx`. They share the same UAT grid (`{angle=0, angle=30} × {edit exit via click-off / Escape / Enter-commit}`), the same lane-safety profile (SVG-side fixes only, zero counter-session WIP touched), and the same regression baseline (113/113 v2.1 tests + Plan 12-02's 7-round focus-loss scenarios). Splitting into two phases would duplicate verification overhead with no isolation benefit. A single Phase 13 with one plan per requirement keeps the milestone surgical and the reconciliation trivial.

**Success Criteria** (what must be TRUE — all four verified by human UAT at both `angle=0` AND `angle=30` shapes):

  1. **Pill re-arms after every edit-mode exit path** — User selects a shape, double-clicks into edit mode, exits edit mode via click-off / Escape / Enter-commit (all three exit paths), hovers the rotation handle, and sees the typed-degree pill appear within the existing 150ms hover-intent window — without needing to deselect and reselect first. Verified for `editType='shape'` (rect, circle, ellipse) AND `editType='text'`.

  2. **Rotation handle visible on edit-mode entry for pre-rotated shapes** — User double-clicks a shape that already has a non-zero angle (verified at `angle=30`) and sees the full rotation handle (circle + connector + icon) rendered without clipping by any container or page-div ancestor. Visual-only visibility is sufficient; the handle does not need to be draggable in edit mode (rotation interaction is already provided by select-mode drag and the typed-degree pill). Verified for rect, circle, ellipse, and text edit modes.

  3. **No regressions to v2.1 baseline** — All 113/113 v2.1 tests remain green. Plan 12-02's 7-round focus-loss scenarios (RotationInputField focus on Tab, click-out, Arrow nudge, Enter commit, hover during drag, Shift modifier, blur) all still pass. The optimistic-paint pattern is preserved: `console.count` on the hover-intent effect body during a 2-second drag-rotate fires ≤3 times (never at 60fps).

  4. **Counter-session lane stays untouched** — Final commit set for Phase 13 includes ZERO files from the 7-file counter-session WIP allowlist. `git status` cross-check before every commit confirms `src/App.jsx`, `src/components/PageAnnotationLayer.jsx`, `src/components/FabricEditCanvas.jsx`, `src/hooks/useDatabase.js`, `src/utils/counterNumbering.js`, `src/utils/svgAnnotationRenderers.jsx`, and `dist/index.html` are untouched by Phase 13's diffs.

**Plans**: 2 plans

Plans:
- [x] **13-01-PLAN.md — EDIT-13 hover pill stale-ref fix (Gap 3)** — DONE 2026-04-14, commit 6cf9e8c9 — Modify the hover-intent `useEffect` in `SVGAnnotationLayer.jsx:213-313` so the rotation pill re-arms after any edit-mode exit path. Strategy A acceptable (add `editingAnnotationIndex` to dep array + early-return gate at effect top); Strategy B preferred (event delegation on stable SVG ancestor via `e.target.closest('[data-rotation-handle="mtr"]')`). Both must gate on `editingAnnotationIndex == null`. Preserves the load-bearing `eslint-disable react-hooks/exhaustive-deps` invariant by NOT adding tick-rate values (`annotations`, `visualTransform`) to the dep array. Files in scope: `src/components/SVGAnnotationLayer.jsx` only.

- [x] **13-02-PLAN.md — EDIT-14 mtr handle visibility fix (Gap 4)** — DONE 2026-04-14 — Rescoped mid-plan to "no Fabric transform handles in edit mode for any shape" (Figma-style separation). See v2.2 RECONCILIATION for rescope rationale.

### Phase 14: Unified SVG Callout Render + Shared Tool Foundation

**Goal**: Users see the text callout rendered through the same SVG pipeline as every other annotation type (via `<foreignObject>` for the text content, mirroring how text annotations work today), and experience consistent crosshair cursor + Delete/Backspace + dashed creation preview across line, arrow, and callout tools — so all downstream callout polish (collisions, rollback, resize, auto-routing, hover glow) can build against a single unified interaction surface instead of the soon-to-be-deleted `src/components/Callout/` HTML-overlay React system.

**Depends on**: Phase 13 (v2.2 — hover-intent event delegation pattern + 113/113 test baseline), rewrite permission granted 2026-04-14

**Requirements**: CALL-10, UX-01, KBD-01, CREATE-01

**Why this is Phase 14 (the unblocker):** CALL-10 is architecturally load-bearing — once the callout renders through `svgAnnotationRenderers.jsx` + `useSVGInteraction.js` like every other annotation type, the other 9 callout requirements (CALL-01..09) fit into the existing SVG interaction pattern instead of having to be built inside the separate `src/components/Callout/` system and then re-built during unification. Doing CALL-10 first means Phases 17-18 build forward against the final render path, not a dead codepath. The three shared-tool foundations (UX-01 crosshair, KBD-01 Delete/Backspace, CREATE-01 dashed preview) ride along in this phase because they touch the same SVG interaction layer that callouts are being moved into, and because lines/arrows in Phase 15+ will need them as a baseline before their own mini-toolbar work lands.

**Boundary notes (CLAUDE.md Always-Protected):**
- `src/App.jsx` — **per-phase waiver required if touched.** This phase may need to update App-level `activeTool` handling for the new crosshair-cursor contract and the Delete/Backspace keyboard handler (currently at App.jsx:~22480). Flag loudly in plan CONTEXT; prefer routing through existing handlers when possible.
- `src/components/SVGAnnotationLayer.jsx` — in scope for this phase (owns SVG render dispatch + hover/cursor layer).
- `src/components/PageAnnotationLayer.jsx` — DO NOT CHANGE. PAL's legacy callout code is untouched; this phase moves the *new* React callout system, not PAL's.
- `src/components/FabricEditCanvas.jsx` — may need `editType: 'callout'` branch updates once unified callouts enter edit mode via double-click. Flag in plan CONTEXT if touched.
- `src/components/Callout/*` — this directory is explicitly in scope for replacement/removal per user rewrite permission.

**Success Criteria** (what must be TRUE):

  1. **Unified render path** — User creates, selects, and views a text callout on a page at any zoom level and the callout renders through `svgAnnotationRenderers.jsx` (new `renderCallout` implementation using `<foreignObject>` for the text content, same pattern as `renderText`), not through a CSS-transformed React overlay. The old `src/components/Callout/CalloutCanvas.jsx` + `CalloutComponent.jsx` + `index.jsx` system is no longer mounted for new callouts; the directory is either removed or reduced to a type-only shim.

  2. **Crosshair while tool active (UX-01)** — User activates line, arrow, or callout tool and the SVG interaction surface shows a `crosshair` cursor until the tool deactivates or a creation drag starts. Default/move cursor returns immediately on deactivation.

  3. **Delete/Backspace on selection (KBD-01)** — User selects a line, arrow, or callout (single-select), presses `Delete` or `Backspace` with no text-input focused, and the selected annotation is removed from the store with undo support. Keyboard shortcut is suppressed when focus is in a text input / contentEditable / Fabric editing field.

  4. **Dashed creation preview (CREATE-01)** — User starts a click-drag to create a line, arrow, or callout and sees a dashed preview at 0.6 opacity following the pointer in real time using the same color/thickness as the committed annotation will have. Preview disappears on mouse-up and is replaced by the committed SVG annotation.

  5. **Data-model continuity** — Existing callouts saved under the old HTML-overlay system continue to load, render, and select correctly through the new unified SVG path. No Supabase schema change. A callout round-tripped through save + reload + save is byte-identical in its Fabric.js JSON fields.

**Plans**: 3 plans

- [x] `14-01-PLAN.md` — Wave 0 test scaffolds (3 unit + 5 Playwright) + revise `renderCallout` with page-coord signature + data attributes + new `calloutEditAdapter.js` utility + sanitize `defaultCalloutStyle.fontFamily` to single-name (wave 1, parallel) — **DONE 2026-04-15** (`14-01-SUMMARY.md`: 31/31 new unit tests pass, 21 Playwright scaffolds discoverable, 4 commits, lane boundary respected)
- [x] `14-02-PLAN.md` — Shared foundation: UX-01 crosshair class + pointerEvents split derivation + KBD-01 extended Delete/Backspace handler + CREATE-01 line/arrow dashed preview with pre-commit reset (narrow-lane FabricDrawingCanvas waiver ~10-15 LOC) (wave 1, parallel) — **DONE 2026-04-15**
- [ ] `14-03-PLAN.md` — Integration: unwind `filteredCallouts` gate + replace 5 Callout HTML-overlay files with null-render stubs + `callout-part` drag mode (4-place invariant) + edit-mode entry via `calloutEditAdapter` + FabricEditCanvas save-callback wrapper + callout creation state machine + un-skip 3 Playwright scenarios (narrow-lane App.jsx waiver) (wave 2)

### Phase 15: Line/Arrow Curvature + Arrowhead Styles

**Goal**: Users can select a line or arrow, drag its middle handle to bend it into a quadratic bezier that passes through the handle position, drag it back near straight to auto-reset, and drag endpoints of a curved line/arrow to reshape the curve with the midpoint held fixed — and users can choose from six arrowhead styles (`NONE`, `SOLID_TRIANGLE`, `V_SHAPE`, `OPEN_CIRCLE`, `OPEN_TRIANGLE`, `HORIZONTAL_LINE`) on the selected line/arrow, with the arrowhead correctly rotating to the curve's tangent when curved.

**Depends on**: Phase 14 (shared crosshair/Delete/preview foundation in place)

**Requirements**: LINE-01, LINE-02, LINE-03, ARROW-01, ARROW-02, ARROW-03, ARROW-04

**Why these seven together:** LINE-01..03 and ARROW-01..03 are the same wiring job against the already-ported `src/utils/lineGeometry.js` — one new `'midpoint'` drag mode in `useSVGInteraction.js`, two renderer branches (`<line>` → `<path d="M x1 y1 Q cx cy x2 y2">` when `data.midpoint` present), one new handle render in `SVGAnnotationLayer.jsx:~1263`, and the `getCurveEndAngle` tangent swap for curved-arrow heads. The math is already ported — do not rewrite. ARROW-04 (six arrowhead styles) joins this phase because the style picker's `arrowheadStyle` field lives inside the same line/arrow data model that's being extended with `data.midpoint`, the six render-switch cases are adjacent to the tangent math, and the enum is a direct lift from the existing callout system's `ARROWHEAD_STYLES` at `src/components/Callout/types.js:9-16` + `CalloutComponent.jsx:951-1089`.

**Boundary notes:**
- `src/utils/lineGeometry.js` — CONSUME, do not rewrite. `getCurvedPath`, `getCurveEndAngle`, `shouldSnapToLinear`, `getControlPoint` are already correct ports of combined-tools' math.
- `src/components/PageAnnotationLayer.jsx` — DO NOT CHANGE. PAL is the only current live consumer of `lineGeometry.js`; leave its curved-line codepath alone. The new SVG-side wiring imports from `lineGeometry.js` directly without entangling PAL.
- `src/components/SVGAnnotationLayer.jsx` — in scope for the new midpoint handle render at the existing `isLineType` branch (line 1221-1264). Stay out of the adjacent rotation-handle/counter zones.
- `src/utils/svgAnnotationRenderers.jsx` — in scope for `renderLine` curved-path branch + arrow tangent swap.
- `src/hooks/useSVGInteraction.js` — in scope for the new `'midpoint'` drag mode alongside the existing `'endpoint'` mode.
- `src/components/FabricDrawingCanvas.jsx` — minimal changes only (tag new line/arrow JSON with the `arrowheadStyle` default when creating). Do not remove or rename the `zoomGeneration` signal.

**Success Criteria** (what must be TRUE):

  1. **Middle curvature handle on line (LINE-01 + LINE-02)** — User selects a line, sees a third handle at its midpoint, drags it away from the straight baseline, and sees the line bend into a quadratic curve that visibly passes through the handle position at t=0.5 (not a naive bezier control point — use the `getCurvedPath` derivation). Dragging the midpoint handle back within 10 px of the straight line auto-snaps the line to straight (drag threshold 10 px, render hysteresis 1 px). Proximity-based reset only — no click, no keyboard.

  2. **Endpoint drag preserves curve midpoint (LINE-03)** — User drags a curved line's start or end handle and the curve reshapes with the midpoint held fixed in absolute page coordinates (not rigid-translated with the endpoint). If the new start+end+midpoint alignment becomes naturally collinear within the 10 px threshold, the line auto-reverts to straight with a recomputed geometric midpoint.

  3. **Curved arrow tangent (ARROW-01 + ARROW-02 + ARROW-03)** — User selects an arrow, drags its middle handle to curve it, and sees the arrowhead rotate to match the curve's tangent at the endpoint via `getCurveEndAngle(start, end, midpoint)` — not the straight start-to-end angle. Straightening via the same 10 px snap threshold returns the arrowhead to linear tangent. Endpoint drag preserves the midpoint with the same auto-reversion rule as lines.

  4. **Six arrowhead styles (ARROW-04)** — User can select any line or arrow and choose from `NONE`, `SOLID_TRIANGLE`, `V_SHAPE`, `OPEN_CIRCLE`, `OPEN_TRIANGLE`, `HORIZONTAL_LINE` for the head style. Defaults: `NONE` for lines, `SOLID_TRIANGLE` for arrows. Style persists across save/reload through the Fabric.js JSON `arrowheadStyle` field and renders correctly at every zoom level. (The picker UI itself ships in Phase 16 alongside the mini-toolbar; in this phase the style is readable/writable programmatically and renders correctly, so a plan can verify via manual JSON edit + reload.)

  5. **No regression to straight line/arrow rendering** — Existing saved straight lines and arrows with no `data.midpoint` field continue to render through the plain `<line>` branch at identical visual output as v2.2, and 113/113 baseline tests still pass.

**Plans**: 3 plans

Plans:
- [x] 15-01-PLAN.md — Wave 0 validation scaffolding (4 unit test files + 4 Playwright scaffolds + baseline capture README; no src/ changes) — **DONE 2026-04-17** (`15-01-SUMMARY.md`: 14 green unit tests + 14 file-level-skipped tests + 13 Playwright fixme scaffolds, 3 commits, zero src/ changes)
- [ ] 15-02-PLAN.md — Wave 1 renderer: pure-JS lineRenderHelpers.js + renderArrowhead React helper + curved-path branch in renderLine
- [ ] 15-03-PLAN.md — Wave 1 interaction: lineDragMath.js + midpoint handle in SVGAnnotationLayer.jsx + 'midpoint' drag mode + endpoint auto-revert in useSVGInteraction.js

### Phase 16: Line/Arrow Mini-Toolbar + Curvature Pill + Min-Drag

**Goal**: Users interact with selected lines and arrows the same way they interact with selected rect/circle/ellipse shapes — a mini-toolbar with color, thickness, and arrowhead style picker appears at the same relative position and with the same show/hide lifecycle, a hover-reveal curvature pill near the midpoint handle shows the current curvature magnitude and accepts typed values with optimistic-paint commits (mirroring the v2.1 `RotationInputField` + `applyOptimisticRotation` pattern), and a minimum-drag-length threshold on creation prevents accidental zero-length annotations.

**Depends on**: Phase 15 (curvature data model + midpoint handle wired in)

**Requirements**: LINE-04, LINE-05, LINE-06, ARROW-05, ARROW-06, ARROW-07

**Why these six together:** LINE-06 and ARROW-07 are the mini-toolbar lifecycle (one implementation reused for both). LINE-04 and ARROW-05 are the curvature pill — architecturally a copy of `RotationInputField` targeting the midpoint handle instead of the mtr handle, using the same HTML-portal + full-click-cycle stopPropagation + uncontrolled-input + constant-orbit-radius pattern from v2.1 Phase 12 Plan 12-02, plus `applyOptimisticRotation`-shaped paint helper for curvature. LINE-05 and ARROW-06 are min-drag-length checks in the creation mouseup handler — same check, two call sites. All six land in `FabricDrawingCanvas.jsx` (creation + min-drag) and `SVGAnnotationLayer.jsx` / new curvature-pill component (selection chrome), so they share the same file lane and verification grid.

**Boundary notes:**
- `src/components/FabricDrawingCanvas.jsx` — in scope for min-drag-length check on line/arrow mouseup. Do not touch the `zoomGeneration` signal.
- `src/components/SVGAnnotationLayer.jsx` — in scope for the new mini-toolbar + curvature-pill render (stable mount points for hover delegation).
- New file expected: `src/components/CurvatureInputField.jsx` (or similar) — mirrors `RotationInputField.jsx` architecture verbatim; share any helpers that make sense with `rotationInputHelpers.js`.
- `src/hooks/useSVGInteraction.js` — minor changes for hover-intent event delegation on the midpoint handle (reuse the `data-rotation-handle` pattern from v2.2 EDIT-13).
- Reuse the v2.2 hover-intent event-delegation pattern (`e.target.closest('[data-curvature-handle="mid"]')`) for the pill re-arm story.

**Success Criteria** (what must be TRUE):

  1. **Mini-toolbar parity (LINE-06 + ARROW-07)** — User selects a line or arrow and sees a mini-toolbar at the same relative position and with the same show/hide lifecycle as the rect/circle/ellipse mini-toolbars today (appears on select, hides on deselect, follows the shape across zoom + pan). Toolbar contains color picker, thickness control, and arrowhead style picker (six options from ARROW-04). Curvature value reads out in the toolbar (read-only when the curvature pill is not hovered). Lines default to `NONE` arrowhead; arrows default to `SOLID_TRIANGLE`.

  2. **Hover-reveal typeable curvature pill (LINE-04 + ARROW-05)** — User hovers the midpoint handle of a selected line or arrow and, after the same hover-intent timing as the rotation pill (~150 ms), sees a curvature-indicator pill showing the current curvature magnitude. User clicks the pill, types a custom curvature value, and sees the line/arrow update live via optimistic paint (the visual updates before the store commit lands, using a `applyOptimisticRotation`-shaped helper adapted for curvature). The pill uses the same HTML-portal + full-click-cycle stopPropagation + uncontrolled-input architecture as `RotationInputField`, and the orbit radius around the midpoint stays constant across curvature magnitudes (worst-case AABB projection, v2.1 canonical pattern).

  3. **Minimum-drag creation threshold (LINE-05 + ARROW-06)** — User clicks on the page with the line or arrow tool active without dragging (zero pointer displacement on mouseup, or displacement below the threshold) and NO line/arrow is created — the creation drag is cancelled silently, no zero-length annotation appears in the store, and no console error fires. Threshold is tunable in one place in `FabricDrawingCanvas.jsx`.

  4. **No regression to rotation pill or mini-toolbar baselines** — 113/113 baseline tests still pass, Plan 12-02's 7-round focus-loss scenarios (RotationInputField focus on Tab, click-out, Arrow nudge, Enter commit, hover during drag, Shift modifier, blur) still pass for rotation, and the rect/circle/ellipse mini-toolbars are visually unchanged.

**Plans**: TBD (populated by `/gsd:plan-phase 16`)

### Phase 17: Callout Handle Collisions + Rollback + Resize

**Goal**: Users can no longer drag a callout's arrowTip / knee / textbox handles into visually broken configurations (handles overlapping, knee inside textbox, arrowTip stuck under the textbox) — live 30 px collision constraints push handles apart during drag, invalid on-drop configurations snap the entire callout back to its drag-start positions, and the corner resize math produces correct geometry at every zoom level without anchor-jitter or stale-ref on rapid re-selection.

**Depends on**: Phase 14 (unified SVG render for callout — collision + resize code is built against the new render path, not the old HTML-overlay system)

**Requirements**: CALL-01, CALL-02, CALL-03, CALL-04, CALL-05

**Why these five together:** All five are constraint / rollback / resize math that lives in the callout drag state machine. CALL-01..03 are three symmetric min-separation clamps (arrowTip↔knee, knee↔textbox border, textbox↔knee) — one constraint helper reused in three drag branches. CALL-04 (on-drop rollback) is the safety net that catches edge cases the live clamps miss. CALL-05 (corner resize) is the same file lane as the collision branches — the four underlying bugs (stale-ref on rapid re-select, hardcoded dragOffset, pixel-vs-normalized min-dimensions, corner math jitter + no flip support) are enumerated in `CURRENT-REPO-AUDIT.md` Gap 3 and must all be fixed together to give a coherent resize story.

**Boundary notes:**
- Post-Phase-14, the callout drag state machine lives in the new unified SVG path (probably `useSVGInteraction.js` + new callout-specific helpers under `src/utils/`). Exact file paths depend on how Phase 14 decomposes. Plan CONTEXT must re-read the post-Phase-14 file map before starting.
- `src/components/PageAnnotationLayer.jsx` — DO NOT CHANGE. PAL's legacy callout path is untouched.
- `src/App.jsx` — DO NOT CHANGE unless resize needs container-aware measurement (`containerEl.offsetWidth / pageSize.width`) reads from App-level refs. Flag in plan CONTEXT.

**Success Criteria** (what must be TRUE — all verified at 50%, 100%, and 200% zoom):

  1. **30 px live collision clamps (CALL-01 + CALL-02 + CALL-03)** — User drags a callout's arrowTip handle toward the knee and the handle is clamped live to a 30 px circle around the knee along the drag axis (CALL-01). User drags the knee toward the textbox border and the knee is projected outward live along the box-to-knee axis so it never enters a 30 px buffer around the closest point on the border (CALL-02). User drags the textbox toward the knee and the textbox pops out live along the axis away from the knee (nearest-edge pop-out on exact overlap) so the knee never enters its 30 px buffer (CALL-03).

  2. **On-drop rollback (CALL-04)** — User drops a drag in a visually invalid configuration (arrowTip inside the textbox plus its buffer, OR knee within 24 px of the arrowTip after all live clamps have run) and the entire callout snaps back to the positions it held at drag-start — all four part positions (arrowTip, knee, textBoxPosition, textBoxWidth/Height) are restored together atomically.

  3. **Resize correctness at all zoom levels (CALL-05 — four underlying bugs fixed)** — User grabs any of the four corner handles at 50%, 100%, and 200% zoom and resizes the textbox: (a) min-width / min-height constraints are enforced consistently at every zoom level (normalized-space or screen-space, not raw pixels), (b) no anchor-jitter when the pointer crosses the anchor corner, (c) no stale-ref on rapid re-selection (the initial-state ref is captured from the current `callouts` array synchronously, not one render behind), (d) the hardcoded `{x:0, y:0}` dragOffset bug from `handleCornerMouseDown` is fixed. All four bugs from `CURRENT-REPO-AUDIT.md` Gap 3 closed.

  4. **No regression to single-select / move / keyboard delete** — User can still single-click the callout to select, drag the textbox to move the whole callout, and press Delete/Backspace to remove — all behaviors from Phase 14 still work.

**Plans**: TBD (populated by `/gsd:plan-phase 17`)

### Phase 18: Callout Auto-Routing + Hover Affordances + Self-Destruct

**Goal**: Users see the callout connector auto-route around the textbox when the user drags the box across the connector path (Liang-Barsky segment clipping so the connector lines never cross the textbox interior), unselected callouts show a hover-reveal selection glow on the textbox border + connector lines and hover-reveal arrowTip + knee handles with a 50 ms hide-delay, and a newly created callout that exits edit mode with empty text self-destructs to prevent orphaned empty callouts from click-drag-release-without-typing.

**Depends on**: Phase 17 (collision / rollback / resize infrastructure in place — hover affordances render on top of the stable drag-state model)

**Requirements**: CALL-06, CALL-07, CALL-08, CALL-09

**Why these four together:** All four are callout polish on top of the stable collision / rollback / resize foundation from Phase 17. CALL-07 (Liang-Barsky auto-routing) is ~500 lines of case analysis ported from `combined-tools/src/lib/calloutGeometry.ts:calculateCalloutConnection` — large, but self-contained inside the connector render function. CALL-06 (hover-reveal handles) and CALL-09 (hover glow) share the same hover-intent machinery and reuse the v2.2 event-delegation pattern (`e.target.closest('[data-callout-id=...]')`). CALL-08 (empty-text self-destruct) is a small check in the callout edit-mode exit handler but lives in the same file lane as the hover affordances.

**Boundary notes:**
- New expected files: `src/utils/calloutRouting.js` (or similar) — house the ported Liang-Barsky math from `combined-tools/src/lib/calloutGeometry.ts`. Existing `src/utils/calloutGeometry.js` is currently dead code on the SVG path (see CURRENT-REPO-AUDIT.md) — may be replaced, renamed, or consolidated at planner's discretion.
- `src/components/FabricEditCanvas.jsx` — in scope minimally for the empty-text check on callout edit-mode exit. The `editType: 'callout'` branch at `FabricEditCanvas.jsx:~1335` may need a small commit-hook. Flag any broader changes in plan CONTEXT.
- Reuse hover-intent event delegation pattern from v2.2 EDIT-13.

**Success Criteria** (what must be TRUE):

  1. **Liang-Barsky auto-routing (CALL-07)** — User drags a callout's textbox so that the straight `arrowTip → knee → boxEdge` connector would visually cross the textbox interior, and the knee auto-routes around the box so that neither line1 (arrowTip → knee) nor line2 (knee → boxEdge) ever crosses the textbox interior. The ~500-line case analysis from `combined-tools/src/lib/calloutGeometry.ts:calculateCalloutConnection` is ported, including the `shouldHideLine1` fallback when no valid route exists. Verified by dragging the textbox in a full circle around the arrowTip at 100% zoom and observing no interior crossings.

  2. **Hover-reveal knee / arrowTip handles with 50 ms hide delay (CALL-06)** — User moves the pointer over any part of an unselected callout and the arrowTip + knee handles fade/reveal visually. Moving the pointer away hides them after a 50 ms delay to prevent flicker on transit across adjacent elements. Same hover-intent pattern as rect/circle/ellipse rotation pill, targeting the callout hit surface via event delegation.

  3. **Selection-preview hover glow (CALL-09)** — User hovers an unselected callout and sees a subtle selection-preview glow on the textbox border + connector lines, matching the line tool's selection-hover glow style from Phase 16 — so line, arrow, and callout all share a consistent "you could click me" hover affordance.

  4. **Empty-text self-destruct (CALL-08)** — User starts a click-drag-release to create a callout but never types any text, and when the callout exits edit mode (click-off / Escape / Enter-commit) the empty callout is automatically removed from the store. User does not see orphaned empty callout rectangles after failed creation attempts. The check fires only on *newly created* callouts; existing callouts with empty text are not deleted on edit-mode exit (safety against accidental data loss).

  5. **v2.3 closes with all 26 requirements verified** — At phase close, the Traceability table in `.planning/REQUIREMENTS.md` shows all 26 requirements with Status = Complete, 113+/113+ baseline tests green, and the line / arrow / text callout tools pass a human UAT script at 50% / 100% / 200% zoom.

**Plans**: TBD (populated by `/gsd:plan-phase 18`)


### Phase 27: CRDT Foundation (Yjs install + per-doc Y.Doc + IndexedDB persistence)

**Goal**: Establish a working single-user Yjs round-trip (Y.Doc → IndexedDB → reload → state restored) wrapped under the unchanged SVG-display + Fabric-edit-on-demand layers, with the architectural invariants that defend against the simple-sync data-loss class baked in from day one.

**Depends on**: v2.3 line/arrow/callout work in stable shape (Phases 14-15 shipped; 16-18 parked). No blocking dependency on Phase 19 AutoCAD selection.

**Requirements**: AUTH-03 (server-authoritative timestamp data model on every transaction)

**Boundary notes (CLAUDE.md Always-Protected):**
- `package.json` — **per-phase waiver REQUIRED.** This is the phase where `yjs@^13.6.30` + `y-protocols@^1.0.7` + `y-indexeddb@^9.0.12` install. Surgical edit; no other dep changes.
- `src/App.jsx` — **per-phase waiver REQUIRED.** Mount `<YDocProvider>` at the document-open boundary (where `documentId` becomes non-null). Narrow lane.
- All other Always-Protected files (PAL, FabricDrawingCanvas, FabricEraserCanvas, FabricEditCanvas, SVGAnnotationLayer) — DO NOT CHANGE. CRDT layer wraps under React state; display/edit layers don't learn about Yjs in this phase.

**Success Criteria** (what must be TRUE):
  1. **Single-user Y.Doc round-trip works** — User opens a PDF, makes annotations, closes the tab/window, reopens the PDF → annotations come back via y-indexeddb. Zero regression on single-user UX vs v2.3.
  2. **Multi-tab safety baked in** — Two tabs of the same document in the same browser/Electron window cannot duplicate updates. Web Locks API election (`navigator.locks.request("y-doc-{docId}", { mode: "exclusive" })`) gates `IndexeddbPersistence` instantiation. Loser tab degrades to read-only via BroadcastChannel from the lock-holder. Verified via 2-tab Playwright scenario.
  3. **Schema designed (not yet populated)** — `doc_yjs_updates (bytea append-only log)`, `doc_yjs_state (bytea snapshot)`, and `activity_log (server-authoritative)` tables exist in Supabase migrations. RLS policies stub'd (full policies in Phase 28).
  4. **applyUpdate-only invariant enforced** — Lint rule or test prohibits `new Y.Doc()` outside the YDocProvider's first-mount path. No code path replaces Y.Doc state on rehydrate; merge-only via `Y.applyUpdate(doc, update)`.
  5. **License CI gate green** — All three Yjs packages MIT-verified; no AGPL contamination introduced.

**Plans**: 5 plans

Plans:
- [x] 27-01-PLAN.md — Wave 0: test scaffold + license CI gate (6 node:test scaffolds + 5 Playwright scenarios + license-gate workflow + check-licenses script) — shipped 2026-04-27
- [x] 27-02-PLAN.md — Wave 1: yjs trio + license-checker install + ydocRegistry.js (the ONE allowed `new Y.Doc(` site) — shipped 2026-04-27
- [x] 27-03-PLAN.md — Wave 1: Supabase migration for doc_yjs_updates + doc_yjs_state + activity_log + RLS stubs (AUTH-03 server_ts column lands here) — shipped 2026-04-27
- [x] 27-04-PLAN.md — Wave 2: ydocLifecycle (Web Locks election + IndexeddbPersistence + BroadcastChannel) + storageFailureDetector + crdtFeatureFlag — shipped 2026-04-27
- [x] 27-05-PLAN.md — Wave 3: YDocProvider + useYDoc hook + StorageFailureBanner + App.jsx mount (per-phase narrow waiver) + UAT checkpoint — shipped 2026-04-27

### Phase 28: Transport Spike + Auth + Server Validator (TIMEBOX 1 WEEK)

**Goal**: Decide the transport layer (custom Supabase Realtime adapter vs self-hosted Hocuspocus) by building both as throwaway prototypes against the Phase 27 foundation, benchmarking go/no-go criteria, and locking the choice. Land the server-side update validator that enforces RLS state on every CRDT update at write-time.

**Depends on**: Phase 27 (Y.Doc foundation + schema)

**Requirements**: AUTH-01 (user attribution at transaction origin), AUTH-02 (device attribution)

**Boundary notes:**
- `src/App.jsx` — narrow waiver if auth/transport wires through App-level context.
- `package.json` — narrow waiver only IF Hocuspocus path wins (would add `@hocuspocus/provider`). Custom Supabase path adds zero new packages.
- New files expected: `src/lib/collab/SupabaseYjsProvider.js` (default path) OR `src/lib/collab/HocuspocusYjsProvider.js` (fallback path).

**Success Criteria** (what must be TRUE):
  1. **Transport decision documented with go/no-go evidence** — Both prototypes built. Benchmark results (binary frame stability, 2-5 concurrent peer fan-out, message rate at typical drag-edit cadence). One transport chosen, the other archived as reference.
  2. **Auth handshake gates every CRDT update** — Supabase JWT carried on Realtime channel + every Postgres write. Token refresh handled (token expiry mid-session does not break the channel).
  3. **Server-side update validator works** — Every incoming CRDT update is run through current RLS state (Postgres function or Edge Function). Updates from a revoked collaborator are rejected with `update_rejected` event back to client.
  4. **User + device attribution lands at transaction origin** — Every `ydoc.transact(fn, origin)` carries `{ userId, deviceId, sessionId, clientID, serverTs }`. Device label defaults to OS hostname (Electron `os.hostname()`); renameable in account settings (data path only — UI is Phase 33).
  5. **RLS policies fully active** — `doc_yjs_updates` + `doc_yjs_state` gated on `user_can_access_document(doc_id, 'editor')` for INSERT, `'viewer'` for SELECT. Verified via SQL test from a non-collaborator JWT.

**Plans**: 6 plans

Plans:
- [x] 28-01-PLAN.md — Wave 0 test scaffolds + benchmark harness skeleton + 28-BENCHMARK.md shell (zero src/ changes) — shipped 2026-04-27
- [x] 28-02-PLAN.md — SupabaseYjsProvider (default-path) + originBuilder + deviceId + authSessionBridge (AUTH-01/02 data path; Pitfall 1 defense) — shipped 2026-04-28
- [x] 28-03-PLAN.md — HocuspocusYjsProvider (fallback-path wrapper, package.json waiver gated on spike outcome; uninstalled at 28-04 close because Supabase won) — shipped 2026-04-27
- [x] 28-04-PLAN.md — Multi-peer throttled-network benchmark + 28-BENCHMARK.md decision lock = supabase + checkpoint:decision (validator surface = postgres-trigger) — shipped 2026-04-28
- [x] 28-05-PLAN.md — Supabase migration: drop Phase 27 stub policies, real RLS + user_can_access_document helper + BEFORE INSERT trigger + Pitfall 3 indexes — shipped 2026-04-28
- [x] 28-06-PLAN.md — Wire chosen transport into YDocProvider + extend StorageFailureBanner (3 new copy variants) + ReSignInModal + ReadOnlyGate (Blocker 1 fix: App.jsx UNTOUCHED, gate moved into child component); UAT Task 5 DEFERRED to Phase 34 close per user instruction (cross-account testing blocked by sharing-UX gap: dashboard query filters by user_id only + Supabase Storage RLS scopes binary to owner's user_id prefix) — shipped 2026-04-28

**Phase 28 status:** All 6 plans landed. Ready for `/gsd:verify-work 28` + 28-RECONCILIATION.md (DONE_WITH_CONCERNS — UAT cross-account portion deferred to Phase 34). 8 phase28 bot accounts in real Supabase project (`cvamwtpsuvxvjdnotbeg`) + `.bot-credentials.json` LEFT IN PLACE pending the deferred UAT.

### Phase 29: Fabric ↔ Yjs Binding + Per-User Undo (HIGHEST RISK)

**Goal**: Wire the existing Fabric edit canvas + SVG display layer to read from / write to Y.Doc via a one-direction-at-a-time bridge (Y → Fabric on edit-mount, Fabric → Y on commit), with per-user `Y.UndoManager` scoped to local clientID. This phase carries the highest pitfall density (4 critical/high pitfalls converging) — plan accordingly.

**Depends on**: Phase 28 (transport locked, server validator active)

**Requirements**: COLLAB-02 (concurrent edits to two different annotations on same page never collide), COLLAB-03 (concurrent edits to same annotation merge per-property LWW), UNDO-01 (Cmd+Z undoes own most recent action), UNDO-02 (undo never erases collaborator work), UNDO-03 (undo restores original creation user + timestamp), UNDO-04 (Cmd+Shift+Z redoes own undone action)

**Boundary notes:**
- `src/App.jsx` — narrow waiver REQUIRED. Cmd+Z / Cmd+Shift+Z keyboard handlers rewire to `undoManager.undo()` / `.redo()`.
- `src/components/FabricEditCanvas.jsx` — narrow waiver REQUIRED. Edit-canvas commit path must call into `crdtAnnotationBridge.applyFabricCommit` instead of `setAnnotationsByPage`. Surgical — preserve `zoomGeneration` signal contract.
- `src/components/SVGAnnotationLayer.jsx` — DO NOT CHANGE. SVG layer reads JSON from React state (now derived from Y.Doc); never learns about Yjs.
- `src/components/PageAnnotationLayer.jsx`, `src/components/FabricDrawingCanvas.jsx`, `src/components/FabricEraserCanvas.jsx` — DO NOT CHANGE.
- New files expected: `src/lib/collab/crdtAnnotationBridge.js` (pure functions, no React, no Fabric instance), `src/lib/collab/crdtUndoManager.js`, `src/hooks/useAnnotationsCRDT.js` (useSyncExternalStore + observeDeep).

**Success Criteria** (what must be TRUE):
  1. **No echo loop** — User drags a rectangle, `object:modified` fires once, exactly one `Y.Map.set` occurs, exactly zero remote-observer fires re-trigger Fabric.set on the same object. Verified by drawing 1000 strokes; CPU stays under 30%, IndexedDB grows linearly. (Pitfall 4)
  2. **Concurrent edits to different annotations on same page never collide** (COLLAB-02) — Two clients, same page, different shapes; both edits land cleanly. Y.Map property-level merge.
  3. **Concurrent edits to the same annotation merge per-property** (COLLAB-03) — Two clients edit color and position simultaneously on the same shape; both properties land via per-property LWW (timestamp tiebreak in `meta.updatedAt`). No conflict modal.
  4. **Per-user undo never erases collaborator work** (UNDO-01 + UNDO-02) — User A draws, User B draws, User A presses Cmd+Z → only User A's stroke reverts. Y.UndoManager constructed with `trackedOrigins: new Set([localClientID])`. Canonical Playwright test required. (Pitfall 7)
  5. **Undo restores original author + creation timestamp** (UNDO-03) — Undoing a delete resurrects the annotation with all `meta.{authorId, deviceId, createdAt}` intact (Y.Map tombstone resurrection).
  6. **Redo works** (UNDO-04) — Cmd+Shift+Z / Ctrl+Y redoes the most recently undone action without affecting collaborator work.
  7. **SVG-Fabric-Y.Doc identity contract holds** — Annotation IDs are stable uuids; lookups across all three layers use the same key. Per-mount registry `Map<annoId, FabricObject>` populated on mount, cleared on unmount. (Pitfall 6)

**Plans**: 6 plans

Plans:
- [ ] 29-01-PLAN.md — Wave 0 test scaffolds (13 unit + 13 e2e existsSync skip-guarded; zero src/ changes)
- [ ] 29-02-PLAN.md — Wave 1 crdtAnnotationBridge.js (pure module — applyFabricCommit + applyFabricDelete + applyYUpdateToFabric + isApplyingRemote belt + microtask reset)
- [ ] 29-03-PLAN.md — Wave 1 crdtUndoManager.js (per-user Y.UndoManager with memoized origin reference equality — Pitfall 7 mitigation)
- [ ] 29-04-PLAN.md — Wave 2 useAnnotationsCRDT hook + YDocProvider mounts UndoManager + App.jsx handleUndo/handleRedo waiver
- [x] 29-05-PLAN.md — Wave 2 FabricEditCanvas commit-path waiver + per-word stopCapturing + mid-drag cancel + identity-contract registry + awareness publish + interaction-state publish (eraser session bracket DEFERRED to Phase 33+; FabricEraserCanvas owns eraser exclusively per CLAUDE.md)
- [ ] 29-06-PLAN.md — Wave 2 CollaboratorOutlineOverlay + StorageFailureBanner annotation_remote_deleted variant + toast queue + restore wiring

### Phase 30: Migration Phase A — Dual-Write Era

**Goal**: Every new annotation written by a v2.4 client persists to BOTH the legacy `document_annotations` row AND the new CRDT update path. v2.3 clients still in the wild read the legacy column; v2.4 clients read the CRDT column. Reads never bleed across. Idempotent backfill keyed by `client_anno_id` runs once per (user, document) on first v2.4 open.

**Depends on**: Phase 29 (Fabric ↔ Yjs bridge stable)

**Requirements**: MIGRATE-01 (existing v2.3 annotations appear correctly in v2.4 with no data loss; original creation user becomes recorded author with "before-v2.4" device tag)

**Boundary notes:**
- `src/services/annotationCloudSync.js` — narrow waiver REQUIRED. Dual-write logic lands here.
- New files expected: `src/lib/collab/crdtBackfill.js` (advisory-locked first-open import).
- `src/components/PageAnnotationLayer.jsx` — DO NOT CHANGE.
- All Always-Protected files except as noted — DO NOT CHANGE.

**Success Criteria** (what must be TRUE):
  1. **Dual-write works** — User on v2.4 creates a new annotation; the row appears in both `document_annotations` (legacy) and `doc_yjs_updates` (new). v2.3 client reading the same document via legacy path sees it. v2.4 client reading via CRDT path sees it. (Pitfall 1)
  2. **Backfill is idempotent** — Running the per-document backfill twice produces no duplicates (key = `client_anno_id`; same key + deep-equal value = harmless). Verified by re-running backfill in Playwright.
  3. **No "diff = delete" logic anywhere** — Code review + lint rule confirms migration code path replaces, never reconciles. The simple-sync killer pattern is banned by construction.
  4. **Existing v2.3 annotations migrate cleanly** (MIGRATE-01) — Annotations created in v2.3 + earlier appear correctly in v2.4. Original `created_by` user becomes `meta.authorId`; `meta.deviceId` = `"before-v2.4"`; `meta.createdAt` preserved.
  5. **Highlights skipped** — `annotation_type` filter excludes highlights; they stay on legacy path through v2.4 (Excel-sync risk; folded into v2.5).

**Plans**: 7 plans

Plans:
- [x] 30-01-PLAN.md — Wave 0 test scaffolds (8 unit + 4 e2e fixme'd + scripts/check-no-diff-delete.mjs CI gate; per-test existsSync skip-guards) — revised in iteration 1 to add 3 hook scaffolds (useDualWriteQueue, useAnnotationCloudSync.dualWrite, useTabPendingDualWrite) _(complete 2026-04-28)_
- [x] 30-02-PLAN.md — Wave 1 crdtBackfill.js (Web Locks election + bridge applyFabricCreate per row + createdAt override pass; idempotent per-(user, document); MIGRATE-01 author/device/timestamp preservation) _(complete 2026-04-28)_
- [x] 30-03-PLAN.md — Wave 1 crdtDualWriteQueue.js (localStorage-backed retry queue; latest-version-wins replacement; quarantine after 10 attempts; 30-second stuck threshold; isCRDTEnabled() guard against Pitfall 30-6) _(complete 2026-04-28)_
- [x] 30-04-PLAN.md — Wave 2 annotationCloudSync.js narrow waiver — dualWriteFabricCommit + dualWriteFabricDelete fan-out; highlight carve-out filter; half-failed-save enqueue (revision iteration 1 also adds skipLegacy: true opts flag for caller-side dedup) _(complete 2026-04-28)_
- [x] 30-05-PLAN.md — Wave 2 UI surfaces — StorageFailureBanner code='sync_queue_stuck' + useDualWriteQueue hook + QuarantineMarkerOverlay component + TabBar red dot capability _(complete 2026-04-28)_
- [x] 30-06-PLAN.md — Wave 3 YDocProvider mount — runBackfill kickoff (deferred via Promise.resolve.then) + 1Hz drainQueue tick + sync_queue_stuck banner gate + QuarantineMarkerOverlay sibling render at (0,0) (per-annotation bbox feed deferred to Phase 32) + manual UAT checkpoint _(complete 2026-04-29; code in cf437356 from 2026-04-28; silent migration UAT passed; failure-banner + quarantine UAT deferred to post-30-07)_
- [x] 30-07-PLAN.md — Wave 4 live wiring — useAnnotationCloudSync fans out dualWriteFabricCommit + dualWriteFabricDelete at all 4 fabric call sites (CONTEXT.md AC-1) + useTabPendingDualWrite hook + TabBar tab item render wires the per-tab dot via the hook (CONTEXT.md AC-13). App.jsx untouched. _(complete 2026-04-29; commits 8f8f2025 + 64ea2a9a; Phase 30 functionally complete pending UAT for failure-banner + quarantine flows + reconciliation)_

### Phase 31: Migration Phase B — Cutover Seal

**Goal**: Flip read source-of-truth from legacy `document_annotations` to Y.Doc. Add `migrated_at` flag on `documents` row. DB trigger / RLS policy makes legacy table read-only for sealed documents. v2.3 clients opening a sealed document get a "please update the app" gate, not corrupted data.

**Depends on**: Phase 30 (dual-write era proven stable in production)

**Requirements**: MIGRATE-02 (v2.3 client opening migrated v2.4 document sees "please update" gate, not corrupted data)

**Boundary notes:**
- New Supabase migration files (DB triggers + RLS policies for seal enforcement).
- `src/App.jsx` — narrow waiver REQUIRED for the v2.3-detected "please update" gate UI.
- All Always-Protected files except App.jsx — DO NOT CHANGE.

**Success Criteria** (what must be TRUE):
  1. **`migrated_at` seal flag enforces read-only on legacy** — DB trigger blocks INSERT/UPDATE/DELETE on `document_annotations` when `documents.migrated_at IS NOT NULL` (for non-highlight rows). Verified via SQL test.
  2. **v2.3 client gate works** (MIGRATE-02) — A v2.3 client opening a sealed document sees a "please update the app" banner with a one-click upgrade link. NO partial document, NO silent corruption.
  3. **v2.4 read path sources from Y.Doc only** — Post-seal, `useAnnotationsCRDT` reads from Y.Doc; legacy column is dead-code for v2.4 client.
  4. **Rollback path documented** — If seal flip causes regression, unsetting `migrated_at` restores legacy read path. Source-of-truth recoverable.
  5. **Highlights still on legacy** — Highlight read path unchanged; seal applies only to non-highlight annotation_types.

**Plans**: TBD (populated by `/gsd:plan-phase 31`)

### Phase 32: Multi-Tab + Persistence Hardening

**Goal**: Production-harden the offline-first + cross-device + multi-tab story. Stress-test the Phase 27 Web Locks election. Add periodic Y.Doc compaction (snapshot consolidation). Ship IndexedDB-quota UX. BroadcastChannel for same-user-same-doc cross-tab sync. Parallelizable with Phase 33 if capacity allows.

**Depends on**: Phase 31 (cutover sealed; Y.Doc is canonical)

**Requirements**: OFFLINE-01 (edit while disconnected; changes persist locally), OFFLINE-02 (reconnect → silent merge; no conflict modal), OFFLINE-03 (two devices both made offline changes; both merge cleanly via per-property LWW), OFFLINE-04 (sync chip shows offline-and-queued / syncing / up-to-date)

**Boundary notes:**
- New files expected: `src/lib/collab/yDocCompaction.js` (periodic snapshot job), `src/lib/collab/multiTabSync.js` (BroadcastChannel coordinator).
- `src/App.jsx` — narrow waiver REQUIRED for sync chip mount + state wiring.
- All other Always-Protected files — DO NOT CHANGE.

**Success Criteria** (what must be TRUE):
  1. **Offline editing works** (OFFLINE-01) — User disconnects internet, makes 10+ annotations, app stays responsive, changes persist locally in y-indexeddb, visible immediately in SVG.
  2. **Reconnect = silent merge** (OFFLINE-02) — User reconnects; queued offline changes sync automatically; remote changes that landed during the offline window merge in. Zero conflict modals.
  3. **Two-device offline merge** (OFFLINE-03) — Device A and Device B both edit the same document offline; both reconnect; both sets merge cleanly via per-property LWW (timestamp tiebreak).
  4. **Sync chip clarity** (OFFLINE-04) — Corner sync chip shows clearly: "Offline — N changes queued" / "Syncing N changes…" / "Up to date" — three states are visually distinct, not subtle dot color changes.
  5. **Multi-tab Web Locks stress test passes** — 2-tab Playwright scenario: open same doc in two tabs, make edits in tab A, switch to tab B, edits visible without IndexedDB corruption. Lock election survives 100+ tab open/close cycles.
  6. **Compaction job runs** — After N updates (configurable, default 100), a snapshot is written to `doc_yjs_state` and old updates beyond `through_seq` are archived/pruned. Cold-load applies snapshot + recent updates instead of replaying full log.

**Plans**: TBD (populated by `/gsd:plan-phase 32`)

### Phase 33: Activity Log + Awareness + Cross-Device Resume

**Goal**: Server-side `update` listener writes one row per CRDT transaction to `activity_log` (Postgres, server-authoritative timestamps). Sidebar UI shows full history newest-first, filterable by user / device / page / date range / action type, click-to-jump. `Y.Awareness` channel powers presence pill (avatars / names of users currently in the doc). "Pick up where you left off" cross-device resume banner highlights most recently edited annotation. Right-click "Tags" + properties three-dot "Tags" surface the per-annotation authorship metadata. Parallelizable with Phase 32.

**Depends on**: Phase 31 (Y.Doc canonical; activity events flowing reliably)

**Requirements**: AUTH-04 (right-click Tags entry shows author + device + last editor + timestamps), AUTH-05 (properties three-dot Tags entry surfaces same data), COLLAB-01 (two users on separate accounts see each other's changes within ~1s), COLLAB-04 (presence indicator for users currently in document), LOG-01 (Activity Log sidebar, newest first), LOG-02 (entries show user / device / action / type / page / human-readable timestamp), LOG-03 (filter by user / device / page / date range / action type), LOG-04 (click entry to jump to annotation if still exists), RESUME-01 ("pick up where you left off" banner highlights most recently edited annotation with one-click jump), AUTH-06 (renameable device label UI in account settings)

**Boundary notes:**
- `src/App.jsx` — narrow waiver REQUIRED for activity log sidebar mount, presence pill mount, resume banner mount, account settings device label rename.
- New files expected: `src/components/ActivityLogSidebar.jsx`, `src/components/PresencePill.jsx`, `src/components/ResumeBanner.jsx`, `src/components/TagsPopover.jsx`, `src/lib/collab/awarenessProvider.js`.
- `src/components/SVGAnnotationLayer.jsx` — narrow waiver if right-click context menu mount happens here.
- All other Always-Protected files — DO NOT CHANGE.

**Success Criteria** (what must be TRUE):
  1. **Activity log captures every change** (LOG-01 + LOG-02) — Server-side listener on `doc_yjs_updates` INSERT writes one row per transaction to `activity_log` with `{user, device, action (create/edit/delete), annotation_type, page, server_ts}`. Sidebar shows newest-first.
  2. **Filters work** (LOG-03) — User can filter by user, device, page, date range, and action type. Results update live.
  3. **Click-to-jump works** (LOG-04) — Clicking an entry navigates to the annotation's page and selects it (if still exists; otherwise shows "annotation has been deleted" toast).
  4. **Real-time collaboration visible within ~1s** (COLLAB-01) — Two users on separate accounts editing the same document see each other's creates / edits / deletes within ~1 second.
  5. **Presence pill shows everyone on same page** (COLLAB-04) — Avatar/name pill in corner shows users currently in the document on the same page (Y.Awareness, throttled at 5Hz for selection / tool / editingAnnotationId; 30Hz for cursor).
  6. **Tags surface on every annotation** (AUTH-04 + AUTH-05) — Right-click any annotation → Tags entry shows: created by USER on DEVICE at TIMESTAMP; last edited by USER on DEVICE at TIMESTAMP. Properties panel three-dot menu → "Tags" surfaces the same data.
  7. **Cross-device resume works** (RESUME-01) — Opening a document on Mac that was last edited on Windows shows a banner: "Pick up where you left off — last edit 12 minutes ago on Surface, page 14, sticky note" with one-click jump.
  8. **Renameable device label** (AUTH-06) — User can rename their device label in account settings ("Mac" → "Office iMac"); rename applies prospectively to new edits and is reflected on past edits via the renamed device id.

**Plans**: TBD (populated by `/gsd:plan-phase 33`)

### Phase 34: Sharing UX + Permission Revocation + Legacy Decommission

**Goal**: Ship the 4-role sharing UI (Owner / Editor / Commenter / Viewer), email-invite flow, role change, revoke. On revoke, `permission_revoked` realtime event triggers forced local Y.Doc destroy + IndexedDB wipe + "Your access has been removed" notice on the revoked client. Decommission legacy non-highlight sync code (`useAnnotationCloudSync` / `cloudSyncMigration` / `cloudSyncQueue`). Closes v2.4.

**Depends on**: Phase 31 (sealed cutover; activity log enables permission audit) AND Phase 33 (activity log + awareness shipped)

**Requirements**: PERM-01 (share via email + assign role: Owner / Editor / Commenter / Viewer), PERM-02 (Editor + Owner can create / edit / delete annotations), PERM-03 (Commenter can view + add comments but cannot edit annotations), PERM-04 (Viewer can only see annotations), PERM-05 (Owner can change role or remove access; removed collaborator's open session immediately stops accepting edits and shows "access removed" notice with close-document button)

**Boundary notes:**
- `src/App.jsx` — narrow waiver REQUIRED for sharing modal mount + revoke notice mount.
- New files expected: `src/components/SharingModal.jsx`, `src/components/AccessRemovedNotice.jsx`, `src/lib/collab/permissionRevocation.js`.
- `src/services/annotationCloudSync.js` + `src/services/cloudSyncMigration.js` + `src/services/cloudSyncQueue.js` + `src/hooks/useAnnotationCloudSync.js` — DELETE in this phase. Legacy non-highlight sync decommissioned.
- `src/services/documentAnnotationService.js` — DO NOT CHANGE. Highlights stay on legacy path.

**Success Criteria** (what must be TRUE):
  1. **4-role sharing works** (PERM-01) — User can share a document by inviting an email; recipient gets invite; on accept, role assignment lands in `document_collaborators`. Roles: Owner / Editor / Commenter / Viewer.
  2. **Editor + Owner have full edit** (PERM-02) — Editor and Owner can create, edit, and delete any annotation.
  3. **Commenter can view + comment-only** (PERM-03) — Commenter sees all annotations, can add comments (comment UX scaffolded; full comment threads deferred to v2.4.x or v2.5 per FEATURES.md), cannot create / edit / delete annotations. UI gates client-side; RLS gates server-side.
  4. **Viewer is read-only** (PERM-04) — Viewer sees annotations only. No pen / shape / callout tools available; RLS rejects any write.
  5. **Revoke is immediate and complete** (PERM-05) — Owner removes a collaborator. Revoked client's open session: (a) realtime channel emits `permission_revoked` event, (b) local Y.Doc is destroyed, (c) IndexedDB for that doc is wiped, (d) "Your access has been removed" notice appears with close-document button, (e) revoked client cannot reach the doc on next open. (Pitfall 3)
  6. **Legacy non-highlight sync decommissioned** — `useAnnotationCloudSync` / `cloudSyncMigration` / `cloudSyncQueue` deleted from tree. `git grep useAnnotationCloudSync` returns zero matches outside historical migrations.
  7. **v2.4 closes with all 28 requirements verified** — Traceability table in REQUIREMENTS.md shows all 28 reqs Status = Complete. Highlight-on-legacy carry-forward documented for v2.5.

**Plans**: TBD (populated by `/gsd:plan-phase 34`)

## Progress

**Execution Order:**
Phases execute in numeric order: 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Overlay Attachment Foundation | v1.0 | 1/1 | Complete | 2026-03-18 |
| 2. Zoom Handler | v1.0 | 2/2 | Complete | 2026-03-18 |
| 3. Render Loop Rewrite | v1.0 | 2/2 | Complete | 2026-03-19 |
| 4. PAL Zoom Simplification | v1.0 | - | Superseded | - |
| 5. Page Container Re-attachment | v1.0 | - | Superseded | - |
| 6. Dead Code Removal | v1.0 | - | Superseded | - |
| 7. Widen Zoom Range | v1.0 | - | Deferred | - |
| 8. SVG Display Foundation | v2.0 | 2/2 | Complete | 2026-04-10 |
| 9. SVG Selection and Interaction | v2.0 | 3/3 | Complete | 2026-04-10 |
| 10. Canvas Mount/Unmount (Pen + Eraser) | v2.0 | 2/2 | Complete | 2026-03-27 |
| 11. Text/Shape Editing + Zoom Cleanup | v2.0 | 2/2 | Complete | 2026-04-02 |
| 12. Shape Edit Polish | v2.1 | 3/3 | Complete | 2026-04-14 |
| 13. Rotation Handle Edit-Mode Polish | v2.2 | 2/2 | Complete | 2026-04-14 |
| 14. Unified SVG Callout Render + Shared Tool Foundation | 3/3 | Complete   | 2026-04-15 | - |
| 15. Line/Arrow Curvature + Arrowhead Styles | 3/3 | Complete   | 2026-04-17 | - |
| 16. Line/Arrow Mini-Toolbar + Curvature Pill + Min-Drag | v2.3 | 0/TBD | Not started | - |
| 17. Callout Handle Collisions + Rollback + Resize | v2.3 | 0/TBD | Not started | - |
| 18. Callout Auto-Routing + Hover Affordances + Self-Destruct | v2.3 | 0/TBD | Not started | - |
| 20. PDF-Native Annotations — Foundations (Phase A) | v3.0 | 4/4 | Complete (DONE_WITH_CONCERNS) | 2026-04-25 |
| 27. CRDT Foundation | 5/5 | Complete    | 2026-04-27 | - |
| 28. Transport Spike + Auth + Server Validator | v2.4 | Complete    | 2026-04-28 | 2026-04-28 |

### Phase 35: Per-User Delete Authority + Confirm-Before-Wipe

**Goal:** Replace the interim 2026-04-27 diff-detection wipe brake with a permission-based delete-authority model (Drawboard / Lumin pattern). Two roles — collaborator (default) and document author/owner — gate selection, hover, eraser, marquee, and bulk-delete. Two confirmation modals (collaborator's "delete all of mine" + owner's "delete cross-author with breakdown") plus a 5-6 second undo toast on every delete. One-time owner-only cleanup banner for brake-suppressed residue. Brake retired; per-session "user-deleted IDs" filter retired.
**Requirements**: 12 acceptance criteria locked in 35-CONTEXT.md (no traceability IDs; phase added mid-milestone outside the original requirement plan)
**Depends on:** Phase 34
**Plans:** 1/6 plans executed

Plans:
- [ ] 35-01-PLAN.md — Wave 0 test scaffolds (4 unit + 6 e2e fixme'd)
- [ ] 35-02-PLAN.md — Permission helper modules (permissionScope + bulkDeletePlan + cleanupResidueAudit, pure JS)
- [ ] 35-03-PLAN.md — Selection / hover / marquee / eraser scope wiring
- [ ] 35-04-PLAN.md — ConfirmDeleteModal + UndoToast + bulk-delete interceptor
- [ ] 35-05-PLAN.md — Wipe brake retirement + sync_residue_cleanup banner
- [ ] 35-06-PLAN.md — e2e fixme flip + verification pass

---
*Last updated: 2026-04-28 — v2.4 Phase 28 (Transport Spike + Auth + Server Validator) functionally complete (6/6 plans shipped). Plan 28-06 landed the user-facing surface: StorageFailureBanner extended with 3 new copy variants (transport_offline, permission_revoked, login_expiry_failure); ReSignInModal shipped as the only new component (inline re-sign-in form on document page, no fullscreen takeover); ReadOnlyGate shipped as the kicked-collaborator read-only mode dispatcher (body[data-readonly] + window-capture-phase keydown listener; renders null); locked transport (custom Supabase Realtime adapter per 28-BENCHMARK.md tiebreaker rule #1) + authSessionBridge mounted inside YDocProvider's existing useEffect. **Plan 28-06 Blocker 1 fix executed verbatim — App.jsx ZERO diff for all of Phase 28** (28-CONTEXT.md narrow waiver NOT exercised; the only Phase 27/28 footprint in App.jsx is the existing Plan 27-05 <YDocProvider> mount line). Manual UAT (Task 5) DEFERRED to Phase 34 close per user instruction — cross-account testing blocked by a sharing-UX gap: the document dashboard query filters by user_id = auth.uid() only (so shared docs don't appear in collaborator file lists) AND Supabase Storage RLS scopes the PDF binary to the OWNER's user_id prefix path (so non-owner collaborators cannot fetch the binary). 8 phase28 bot accounts + .bot-credentials.json LEFT IN PLACE pending the deferred UAT. Phase 27 + Phase 28 unit suites green (33 / 30 pass / 3 skipped / 0 fail); applyUpdate-only invariant green; license CI green; package.json restored to pre-spike state (Hocuspocus packages uninstalled when Supabase won the bake-off). Phase 28 awaiting `/gsd:verify-work 28` + 28-RECONCILIATION.md. Next: Phase 29 (Fabric ↔ Yjs Binding + Per-User Undo).*
