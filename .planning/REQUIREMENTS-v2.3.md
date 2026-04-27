# Requirements: v2.3 Tools Polish (combined-tools rewrite)

**Defined:** 2026-04-14
**Core Value:** Line/arrow/text-callout tools match the precision and feel of the `combined-tools` reference app. User has granted explicit rewrite permission — don't preserve the current implementations, copy combined-tools as the behavioral baseline first, then add the enhancements on top.

## Scope framing (REVISED 2026-04-14 — read before the list)

User direction shift during requirements review:

1. **Rewrite permission granted.** The current line / arrow / callout implementations are considered bad UX and bad internals. v2.3 may replace `src/components/Callout/*`, the line/arrow branches in `svgAnnotationRenderers.jsx`, the line/arrow branches in `useSVGInteraction.js`, the drawing-tool flow in `FabricDrawingCanvas.jsx` for these three tools, and any adjacent helpers. Previous "preserve existing" out-of-scope items are OBSOLETE.
2. **Copy combined-tools first, then add.** Use combined-tools' math + behaviors + interaction logic as the baseline, then layer the additions (curve-indicator pill, mini-toolbar, etc.) on top. "Similar, not identical" — port is still feature parity, not pixel parity.
3. **SVG display + Fabric-edit-on-demand architecture is unchanged.** Combined-tools uses an always-mounted Fabric canvas; this app uses SVG display + targeted Fabric edit. The rewrite happens *within* this repo's architecture — the ported math goes into SVG renderers + the interaction hook + on-demand Fabric edit, not into a new always-mounted canvas.
4. **Line/arrow should "act like regular shapes"** — inherit the select-lifecycle + mini-toolbar + typed-value hover pill pattern that rect/circle/ellipse already have (v2.1/v2.2 wins).
5. **Callout should "render similar to a text box"** — presumed to mean SVG-first (likely `<foreignObject>` for the content, mirroring how `text` annotations are rendered today), replacing the current separate HTML-overlay `src/components/Callout/` React system.
6. **Curvature indicator mirrors the rotation-pill UX** — hover-reveal pill near the midpoint handle, shows current curvature, typeable to set a custom value, live commit with optimistic paint. Same architectural pattern as `RotationInputField` from v2.1 Phase 12 (Plan 12-02).

Audits of both codebases: `.planning/research/COMBINED-TOOLS-AUDIT.md` and `.planning/research/CURRENT-REPO-AUDIT.md`.

## v2.3 Requirements

22 requirements across 4 categories. Each maps to a roadmap phase.

### Line Tool (6)

- [x] **LINE-01**: User can select a line and drag its middle curvature handle to bend the line into a quadratic curve that visibly passes through the handle position. Curvature is stored as an absolute midpoint `(x, y)` in page coordinates.
- [x] **LINE-02**: User can drag a curved line's middle handle back near the straight baseline and the line auto-resets to straight (10 px drag snap threshold, 1 px render hysteresis). Proximity-based reset only — no click, no keyboard.
- [x] **LINE-03**: User can drag a curved line's start or end handle and the curve reshapes — the midpoint stays fixed in absolute coords. If the new geometry becomes naturally collinear within the snap threshold, the line auto-reverts to straight with a recomputed geometric midpoint.
- [ ] **LINE-04**: User sees a curvature-indicator pill near the midpoint handle that appears on hover-intent (same timing as the rotation pill) and shows the current curvature magnitude. User can click to type a custom curvature value and the line updates live via optimistic paint (same pattern as v2.1 `RotationInputField` + `applyOptimisticRotation`).
- [ ] **LINE-05**: Click-to-create with zero drag distance does not create a line — a minimum drag length is required before a new line is committed. Prevents accidental degenerate zero-length lines during tool clicks.
- [ ] **LINE-06**: Selected line shows a mini-toolbar (color, thickness, arrowhead style picker — `NONE` by default, curvature value read-only when not hovering) at the same relative position and with the same show/hide lifecycle that rect/circle/ellipse mini-toolbars use today. Line annotations "act like regular shapes" in the select lifecycle.

### Arrow Tool (7)

- [x] **ARROW-01**: User can select an arrow and drag its middle curvature handle to bend it. The arrowhead rotates to match the curve's tangent at the endpoint (not the straight start-to-end angle).
- [x] **ARROW-02**: User can drag a curved arrow's middle handle back near straight and the arrow resets to straight with the arrowhead returning to linear tangent. Same thresholds as LINE-02.
- [x] **ARROW-03**: User can drag a curved arrow's start/end handle and the curve reshapes with the midpoint held fixed. Auto-reversion on natural collinearity applies the same way.
- [ ] **ARROW-04**: User can choose the arrowhead style for a selected line or arrow from six options — `NONE`, `SOLID_TRIANGLE`, `V_SHAPE`, `OPEN_CIRCLE`, `OPEN_TRIANGLE`, `HORIZONTAL_LINE` — via the mini-toolbar style picker. Default: `NONE` for lines, `SOLID_TRIANGLE` for arrows. Persists across save/reload.
- [ ] **ARROW-05**: Arrow selection shows the same curvature-indicator pill as LINE-04 (hover-reveal, typeable, live optimistic commit).
- [ ] **ARROW-06**: Click-to-create with zero drag distance does not create an arrow. Same minimum-drag-length rule as LINE-05.
- [ ] **ARROW-07**: Selected arrow shows the same mini-toolbar as LINE-06 (color, thickness, arrowhead style picker, curvature readout).

### Callout (10)

- [ ] **CALL-01**: User cannot drag a callout's arrowTip handle within 30 px of its knee handle. Clamped live to a 30-px circle around the knee along the drag axis.
- [ ] **CALL-02**: User cannot drag a callout's knee handle within 30 px of the closest point on the textbox border. Projected outward live along the box-to-knee axis.
- [ ] **CALL-03**: User cannot drag a callout's textbox into a position within 30 px of the knee handle. Live pop-out along the axis away from the knee (nearest-edge pop-out for exact overlap).
- [ ] **CALL-04**: If a callout drag ends in a visually invalid configuration (arrowTip inside the textbox plus buffer, OR knee within 24 px of arrow), the entire callout snaps back to the positions it held at drag-start — all four part positions restored together.
- [ ] **CALL-05**: User can resize a callout's textbox from any corner at any zoom level with correct geometry. Minimum dimensions enforced consistently across zoom levels, no anchor-jitter, no stale-ref on rapid re-selection. (Bug-fix requirement — four underlying issues enumerated in `CURRENT-REPO-AUDIT.md` Gap 3.)
- [ ] **CALL-06**: Hovering any part of an unselected callout visually reveals the arrowTip and knee handles with a 50 ms hide-delay on mouse-out to prevent flicker.
- [ ] **CALL-07**: When the user drags a callout's textbox across the arrow's path, the knee auto-routes around the box using Liang-Barsky segment clipping so line1 and line2 never cross the textbox interior (port of combined-tools' `calculateCalloutConnection`, ~500 lines of case analysis + fallback `shouldHideLine1` when no valid route exists).
- [ ] **CALL-08**: A newly created callout that exits edit mode with empty text is automatically deleted. Prevents orphaned empty callouts from click-drag-release without typing.
- [ ] **CALL-09**: Hovering an unselected callout shows a selection-preview glow on the textbox border and connector lines — same visual style as the line tool's selection-hover glow, so all three tools have a consistent hover affordance.
- [x] **CALL-10**: Callout renders via SVG (using the same `<foreignObject>`+HTML-text pattern that `text` annotations use today) instead of the current separate HTML-overlay `src/components/Callout/` React system. "Similar to a text box" architecture. The entire current Callout directory may be replaced or removed.

### Shared Interaction (3)

- [x] **UX-01**: While the line, arrow, or callout tool is active and no drag is in progress, the SVG interaction layer shows a `crosshair` cursor. Default/move cursor returns when the tool deactivates or a creation drag starts.
- [x] **KBD-01**: `Delete` or `Backspace` while a line, arrow, or callout is selected removes it from the annotation store (with undo support). Keyboard focus must not be in a text input / editing field. Same shortcut surface as combined-tools' delete handler.
- [x] **CREATE-01**: During the initial click-drag creation of a line, arrow, or callout, a dashed preview is shown at 0.6 opacity following the pointer in real time. Preview uses the same color / thickness settings as the committed annotation will. Preview is removed on mouse-up and replaced by the committed annotation.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Snap-to-angle on line/arrow (Shift-constrain, 45°/90° snap) | Not in combined-tools. User-approved drop 2026-04-14. |
| Arrow-key nudge on selected line/arrow/callout | Not in combined-tools. Out of scope for a port. |
| Callout tail shape variants (curved tail, rounded, multi-segment, etc.) | Not in combined-tools. User-approved drop 2026-04-14. |
| Multiple knees per callout | Combined-tools has exactly one. |
| Adding arrowhead styles to the existing callout tool | Already has 6 styles. Don't add scope. |
| Upgrading Fabric.js 5.5.2 → 6.x | Fabric 5.5.2 is load-bearing. Port behavior, not engine. |
| Changes to annotation save format / Supabase schema | SVG reads same Fabric.js JSON. Zero migration. |
| Changes to Syncfusion PDF viewer configuration | Viewer layer untouched. |
| Always-mounted edit canvas for line/arrow/callout (combined-tools pattern) | SVG display + Fabric-edit-on-demand is architecturally locked. Rewrite stays inside that pattern. |
| Touching `src/App.jsx`, `src/components/PageAnnotationLayer.jsx`, `src/components/FabricEditCanvas.jsx`, `package.json`, `vite.config.js` without explicit per-phase waiver | Always-Protected per `CLAUDE.md`. |
| PAL's curved-line code path | PAL is the ONLY live consumer of `src/utils/lineGeometry.js` today. Don't entangle PAL with the new wiring. Leave PAL alone. |
| Polish on rect / circle / ellipse / pen / highlighter / eraser tools | v2.3 is line/arrow/callout only. |

## Traceability

Which phases cover which requirements. Populated by `gsd-roadmapper` on 2026-04-15.

| Requirement | Phase | Plan | Status |
|-------------|-------|------|--------|
| LINE-01 | Phase 15 | TBD | Pending |
| LINE-02 | Phase 15 | TBD | Pending |
| LINE-03 | Phase 15 | TBD | Pending |
| LINE-04 | Phase 16 | TBD | Pending |
| LINE-05 | Phase 16 | TBD | Pending |
| LINE-06 | Phase 16 | TBD | Pending |
| ARROW-01 | Phase 15 | TBD | Pending |
| ARROW-02 | Phase 15 | TBD | Pending |
| ARROW-03 | Phase 15 | TBD | Pending |
| ARROW-04 | Phase 15 | TBD | Pending |
| ARROW-05 | Phase 16 | TBD | Pending |
| ARROW-06 | Phase 16 | TBD | Pending |
| ARROW-07 | Phase 16 | TBD | Pending |
| CALL-01 | Phase 17 | TBD | Pending |
| CALL-02 | Phase 17 | TBD | Pending |
| CALL-03 | Phase 17 | TBD | Pending |
| CALL-04 | Phase 17 | TBD | Pending |
| CALL-05 | Phase 17 | TBD | Pending |
| CALL-06 | Phase 18 | TBD | Pending |
| CALL-07 | Phase 18 | TBD | Pending |
| CALL-08 | Phase 18 | TBD | Pending |
| CALL-09 | Phase 18 | TBD | Pending |
| CALL-10 | Phase 14 | 14-01, 14-03 | **Complete** — Wave 0 pure-utility (14-01) + Wave 2 end-to-end integration (14-03: filteredCallouts unwound, callout-part drag, edit-mode adapter, creation preview) |
| UX-01 | Phase 14 | 14-02 | **Complete** — tool-crosshair CSS class + isSelectTool/isCreationTool split derivation in SVGAnnotationLayer (Plan 14-02); consumed by Plan 14-03 callout creation path |
| KBD-01 | Phase 14 | 14-02, 14-03 | **Complete** — extended Delete/Backspace handler with callout branch + focus guard (14-02); selectedCalloutIds state + handleDeleteSelectedCallouts wired in App.jsx (14-03) |
| CREATE-01 | Phase 14 | 14-02, 14-03 | **Complete** — line/arrow dashed preview in FabricDrawingCanvas (14-02); callout creation state machine + dashed SVG preview + tool-switch cancellation in SVGAnnotationLayer (14-03) |

**Coverage:**
- v2.3 requirements: 26 total (6 line, 7 arrow, 10 callout, 3 shared)
- Mapped to phases: 26 (Phase 14: 4, Phase 15: 7, Phase 16: 6, Phase 17: 5, Phase 18: 4)
- Unmapped: 0

---
*Requirements defined: 2026-04-14*
*Traceability populated: 2026-04-15 by `gsd-roadmapper` — 26/26 requirements mapped across Phases 14-18.*
