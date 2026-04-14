# Requirements: v2.2 Rotation Handle Polish

**Defined:** 2026-04-14
**Core Value:** Annotations render correctly at all zoom levels with zero disappearance via SVG viewBox; shape editing feels precise and predictable at every zoom level down to 10%.

## v2.2 Requirements

Two carry-forward polish gaps from v2.1 Phase 12 that close out the rotation interaction story. Both are SVG-side fixes that avoid the counter-session lane entirely.

### Shape Edit Rotation Polish

- [x] **EDIT-13**: User can hover the rotation handle after returning from edit mode via click-off and see the typed-degree rotation pill re-arm within the hover-intent window, without needing to fully deselect and reselect the shape. Applies to all 7 annotation types that currently support shape editing (rect, circle, ellipse, line, arrow, path/callout wrappers). Carry-forward from v2.1 Gap 3. — **DONE 2026-04-14** (Plan 13-01, commit 6cf9e8c9, UAT verified)

- [ ] **EDIT-14**: User can double-click into edit mode on a pre-rotated shape (angle ≠ 0°) and see the rotation handle (mtr) fully visible and not clipped by any container boundary. Visual-only visibility is sufficient — the handle does not need to be draggable in edit mode since rotation interaction is already provided by select-mode drag and the typed-degree pill. Applies to rect, circle, ellipse, and text edit modes. Carry-forward from v2.1 Gap 4.

## v2.3+ Requirements (Deferred)

Items identified but pushed to a future milestone.

### Shape Edit Polish (continued)

- **ROT-FABEDIT**: Fabric edit canvas shape rotation snap (commit-lossy on force-zero/restore cycle) — SVG-path snap only for v2.1; Fabric-path rotation interaction needs a custom pipeline before it can ship.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Rotation handle off-screen relocation (Gap 2) | 9-tool industry survey (Figma, tldraw, Excalidraw, Miro, Illustrator, Sketch, Inkscape, Nutrient, PSPDFKit) found zero tools relocate rotation handles; v2.1 typed-degree pill already addresses ~95% of the underlying pain. Closed `wontfix_superseded_by_typed_input`. |
| Fabric-side Gap 4 fixes (`controlsAboveOverlay`, custom mtr Control with `offsetY: -20`, BBOX_PADDING increase) | Require edits to `FabricEditCanvas.jsx` which is held by the counter-session. SVG-side Fix A achieves the same result (visual-only mtr handle) without the lane conflict. Fabric-side fixes remain deferred fallbacks only if SVG-side Fix A is blocked. |
| Rotation interaction in Fabric edit mode | Commit-lossy on force-zero/restore cycle; needs a custom pipeline. Users have two existing rotation paths (select-mode drag + typed-degree pill). Edit mode does not need a third. |
| Typed-value Shift-snap in RotationInputField | v2.1 locked decision: typing 44 with Shift held commits 44° — snap is drag-only gesture. |
| Blur-commit and invalid-value revert for RotationInputField | User explicitly de-scoped during v2.1 12-02 UAT. |
| SVG select-mode flip for line/arrow/path/text | Only rect/circle/ellipse supported (v2.1); per-type flip semantics out of scope. |
| Touching any file in the counter-session WIP lane | `src/App.jsx`, `src/components/PageAnnotationLayer.jsx`, `src/components/FabricEditCanvas.jsx`, `src/hooks/useDatabase.js`, `src/utils/counterNumbering.js`, `src/utils/svgAnnotationRenderers.jsx`, `dist/index.html` — these are held by a parallel session and must never be staged from v2.2 without explicit coordination. |
| Widen zoom range beyond 500% ceiling | Deferred (PERF-02); 10% floor shipped in v2.1 ZOOM-09. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Plan | Status |
|-------------|-------|------|--------|
| EDIT-13 | Phase 13 | 13-01 | Complete (2026-04-14) |
| EDIT-14 | Phase 13 | 13-02 | Pending |

**Coverage:**
- v2.2 requirements: 2 total
- Mapped to phases: 2 (100%)
- Unmapped: 0

---
*Requirements defined: 2026-04-14*
*Last updated: 2026-04-14 after v2.2 roadmap creation — both requirements mapped to Phase 13 (EDIT-13 → Plan 13-01, EDIT-14 → Plan 13-02). Coverage 100%.*
