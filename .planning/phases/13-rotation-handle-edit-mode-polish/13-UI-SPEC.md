---
phase: 13
slug: rotation-handle-edit-mode-polish
status: approved
shadcn_initialized: false
preset: none
created: 2026-04-14
reviewed_at: 2026-04-14
---

# Phase 13 — UI Design Contract

> Visual and interaction contract for the rotation-handle (mtr) and its typed-degree hover pill during edit-mode entry/exit transitions. Phase 13 is a **preservation spec** — no new visual design is proposed. All values documented below already exist in `SVGSelectionOverlay.jsx:167-206` (mtr group) and `SVGAnnotationLayer.jsx:213-313` (hover-intent effect). Downstream agents MUST preserve these exactly while implementing the two structural fixes (Strategy B delegation for EDIT-13, Fix A / Option C narrowed short-circuit + `isEditing` prop for EDIT-14).

**Source of truth:** existing code in `src/components/SVGSelectionOverlay.jsx` and `src/components/SVGAnnotationLayer.jsx`. If this contract ever conflicts with the code, the code wins and this contract is updated.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (manual — Vite + React 18, no shadcn, no Tailwind) |
| Preset | not applicable |
| Component library | none (custom SVG rendering via `SVGAnnotationLayer.jsx` + `SVGSelectionOverlay.jsx`) |
| Icon library | inline SVG asset — `rotateIconSvg` (imported in `SVGSelectionOverlay.jsx`) |
| Font | `"Helvetica"` (single-name, never a CSS fallback stack — per 2026-04-08 Fabric cursor-drift gotcha in `CLAUDE.md`). Not used in Phase 13 chrome; documented for completeness. |
| Styling approach | Inline SVG attributes + inline `style` objects. No CSS modules, no CSS-in-JS library, no Tailwind classes. |
| Detection evidence | `components.json` absent · `tailwind.config.*` absent · `postcss.config.*` absent · no design-system config files at repo root |

**Scope limit for this spec:** Phase 13 edits exactly two files and touches exactly two visual surfaces (mtr handle group + hover pill listener attachment). No global tokens are created; no global styles are introduced. This spec documents only the contract those two surfaces must honor.

---

## Spacing Scale

Phase 13 does not introduce new spacing tokens. The existing SVG chrome uses **unit-scaled pixel values** that multiply by `inverseScale` (= `Math.sqrt(getInverseScale(visualTransform))`) so every visual element renders at a constant screen size regardless of PDF zoom. There is no 8-point grid because SVG chrome is dimensioned in page-coordinate pixels, not layout pixels.

### mtr handle geometry (constant — must not change)

| Property | Base value | Scaled expression | Source |
|----------|-----------|-------------------|--------|
| Rotation circle radius | 12px | `12 * is` | `SVGSelectionOverlay.jsx:183` |
| Rotation icon size (w×h) | 16.8px | `16.8 * is` (70% of circle diameter, 2 × 12 × 0.7) | `SVGSelectionOverlay.jsx:202-203` |
| Rotation icon x offset | `-8.4px` | `handles.mtr.x - (16.8 * is) / 2` | `SVGSelectionOverlay.jsx:200` |
| Rotation icon y offset | `-8.4px` | `handles.mtr.y - (16.8 * is) / 2` | `SVGSelectionOverlay.jsx:201` |
| Connector stroke width | 1px | `1 * is` | `SVGSelectionOverlay.jsx:176` |
| Circle stroke width | 1px | `1 * is` | `SVGSelectionOverlay.jsx:186` |
| mtr offset from bbox top edge | (handled by `getHandlePositions`) | `handles.mtr.y < handles.mt.y` | `src/utils/svgBoundingBox.js` (read-only, out of scope) |

**Rule:** Plan 13-02's mtr-only edit-mode branch in `SVGSelectionOverlay.jsx` MUST emit identical values. Any deviation (even rounding `16.8` to `17` or changing `12` to `14`) is a boundary violation — the visual must match select-mode rendering exactly so users don't see the handle "jump" on edit-mode entry.

### Hover pill geometry (unchanged — documented for preservation)

| Property | Value | Source |
|----------|-------|--------|
| Open delay (hover-intent) | **150ms** | `SVGAnnotationLayer.jsx` (Plan 13-01 `onOver` handler — Phase 12 invariant) |
| Close grace window | **500ms** | `SVGAnnotationLayer.jsx` (Plan 13-01 `onOut` handler — Phase 12 invariant) |
| Pill orbit math | worst-case AABB projection from shape center (constant orbit radius across rotation) | v2.1 locked decision (`STATE.md`) |
| Pill positioning | `src/utils/rotationInputHelpers.js` | OUT of scope for Phase 13 — DO NOT modify |
| Pill render component | `src/components/RotationInputField.jsx` (portaled HTML, not foreignObject) | OUT of scope for Phase 13 — DO NOT modify |

**Rule:** The 150ms / 500ms values and the `activeElement?.closest('[data-rotation-input-field]')` grace-expiry guard (Plan 12-02 Round 7 fix) are load-bearing. Plan 13-01's delegation rewrite MUST preserve all three.

### Exceptions

- **Not an 8-point grid** — SVG page-coordinate units, not layout pixels. The 12 / 16.8 / 1 values come from `SVGSelectionOverlay.jsx`'s existing rendering and cannot be shifted to a generic token system without regressing the visual baseline.
- **All values are `inverseScale`-multiplied** — zoom-invariant screen size is the key invariant. Never bake a constant pixel value into the rendered output without multiplying by `is`.

---

## Typography

Phase 13 renders **zero text characters** in the surfaces it touches. The mtr handle is a circle + connector + raster icon; the hover pill renders inside `RotationInputField.jsx` (out of scope). No font sizes, weights, or line-heights are declared or modified by this phase.

| Role | Size | Weight | Line Height | Notes |
|------|------|--------|-------------|-------|
| (none — no typography in Phase 13 surfaces) | — | — | — | Plan 13-01 touches event listeners only. Plan 13-02 renders SVG `<line>`/`<circle>`/`<image>` only. |

**Rule:** If the executor finds themselves adding a `<text>` element or a font declaration in either `SVGAnnotationLayer.jsx` or `SVGSelectionOverlay.jsx` during Phase 13 work, STOP. That's a scope violation and should be escalated before merging.

---

## Color

Phase 13 preserves the existing neutral-gray rotation-handle palette. The app is a PDF annotation tool whose dominant surface is the PDF canvas itself — annotation chrome uses muted neutrals so it never competes visually with user drawings or the underlying document.

### 60 / 30 / 10 for Phase 13 surfaces

| Role | Value | Usage in Phase 13 |
|------|-------|-------------------|
| Dominant (60%) — chrome fill | `#ffffff` | Rotation circle fill (`SVGSelectionOverlay.jsx:184`) + pill background (owned by `RotationInputField.jsx`, out of scope) |
| Secondary (30%) — chrome stroke | `#e0e0e0` | Rotation circle stroke (`SVGSelectionOverlay.jsx:185`) |
| Secondary (30%) — connector + pill stroke | `#d1d1d1` | Connector line stroke (`SVGSelectionOverlay.jsx:175`) + existing corner/edge pill strokes at `:152` (not touched by Phase 13) |
| Accent (10%) | `none` — Phase 13 intentionally introduces no accent color | The rotation-handle chrome stays neutral on purpose. Accents in the broader app belong to toolbar/selection states owned by PAL/App.jsx (out of scope). |
| Destructive | `none` — Phase 13 has zero destructive actions | No delete, no confirm, no warning surfaces in scope. |

### Accent reserved for

- **(nothing in Phase 13)** — Phase 13 is strictly a structural/behavioral fix. No new accent color is introduced. If the executor is tempted to add a blue highlight on the mtr handle to indicate "edit mode visual-only", STOP. That's a scope expansion — visual-only means visually identical to select-mode rendering, NOT visually distinct.

### Rule: edit-mode branch must match select-mode branch pixel-for-pixel

Plan 13-02's `isEditing === true` render branch in `SVGSelectionOverlay.jsx` MUST emit the exact same color values as the existing select-mode mtr group:

- `stroke="#d1d1d1"` on the connector line
- `fill="#ffffff"` on the circle
- `stroke="#e0e0e0"` on the circle
- `strokeWidth={1 * is}` on both

The only permitted difference between select-mode and edit-mode mtr rendering is the absence of the surrounding bbox rect, corner circles, and edge pills — plus `pointerEvents: 'none'` and `cursor: undefined` on the circle (because SVG root is non-interactive during edit mode). **Color values are byte-identical across branches.**

### Shadow / filter invariants (preserve)

| Property | Source | Rule |
|----------|--------|------|
| `rotationShadow` filter | `SVGSelectionOverlay.jsx:188` (existing drop-shadow applied to mtr circle) | Edit-mode branch MUST apply the same `filter: rotationShadow` — absence makes the handle look "ghosted" and users report it as broken |
| `pillShadow` filter | `SVGSelectionOverlay.jsx:155` (corner/edge pills) | Not rendered in edit-mode branch — mtr-only path has no pills |
| `cornerShadow` filter | `SVGSelectionOverlay.jsx` (corner circles) | Not rendered in edit-mode branch — mtr-only path has no corners |

---

## Copywriting Contract

Phase 13 renders **zero copy** in the surfaces it touches. The typed-degree pill inside `RotationInputField.jsx` displays a numeric angle value (e.g., `30°`) and accepts user input, but that component is explicitly out of scope for Phase 13 (see DO NOT CHANGE in `13-CONTEXT.md:257`).

| Element | Copy | Notes |
|---------|------|-------|
| Primary CTA | (none) | No buttons, no labels, no text in Phase 13 chrome |
| Empty state heading | (none) | No empty states — rotation handle always renders when a single shape is selected |
| Empty state body | (none) | — |
| Error state | (none) | Phase 13 has no error surfaces. Diagnostic script failures escalate to the user per `13-CONTEXT.md` fallback strategy |
| Destructive confirmation | (none) | Phase 13 has zero destructive actions |

### Interaction affordances (no text — visual cues only)

| Surface | Affordance | Preservation rule |
|---------|-----------|-------------------|
| Select-mode mtr handle | `cursor: 'crosshair'` on the rotation circle (`SVGSelectionOverlay.jsx:189`) | Unchanged — Plan 13-02 does NOT touch the select-mode branch |
| Edit-mode mtr handle (NEW in Plan 13-02) | `cursor: undefined` / `pointerEvents: 'none'` — visual-only | The handle is visible but inert during edit mode. The user rotates from select mode or via the typed-degree pill — NOT by dragging the edit-mode handle. Per PROJECT.md line 71. |
| Hover pill activation | No text hint — the pill appears on hover via the 150ms hover-intent listener | This is an existing pattern (Phase 12 Plan 12-02) — DO NOT add a tooltip or instructional label |
| RotationInputField (out of scope) | Uncontrolled input displays `${Math.round(angle)}°` | Unchanged — owned by `src/components/RotationInputField.jsx` |

### Rule: no new copy without approval

If the executor feels the need to add a tooltip, label, aria-hint, or placeholder text during Phase 13 work, STOP and escalate. Phase 13 is a preservation-only phase for visual chrome; any copy addition is a scope expansion requiring user approval.

---

## Interaction Contract (Phase-Specific — The Real Work)

This section replaces what a typical Phase's "visual states / interactions" would cover. Phase 13 is primarily an *interaction* fix, not a visual one — the structural behavior around the existing chrome is what changes.

### EDIT-13 — Hover pill re-arms after every edit-mode exit path (Plan 13-01)

**States the pill must transition between:**

| State | Trigger | Expected behavior |
|-------|---------|-------------------|
| `dormant` | Initial selection, no hover | mtr visible, pill not rendered |
| `arming` | Pointer enters mtr subtree (detected via `pointerover` bubbling + `closest()` filter + `relatedTarget` boundary check) | `rotInputHoverTimerRef` schedules `setRotInputVisibleDbg(true)` after **150ms** |
| `visible` | 150ms hover-intent timer fires | Pill rendered by `RotationInputField` — degree text + input displayed |
| `closing` | Pointer leaves mtr subtree (detected via `pointerout` bubbling + `closest()` filter + `relatedTarget` boundary check) | `rotInputCloseTimerRef` schedules hide after **500ms** grace window |
| `re-armed` | Pointer re-enters mtr subtree while in `closing` | Close timer cleared, pill stays visible (no flicker) |
| `focus-locked` | Pill visible and user tabs/clicks into the input | Grace timer expiry checks `document.activeElement?.closest('[data-rotation-input-field]')` — if focused, pill stays; if not, hides |
| `suppressed` | `editingAnnotationIndex != null` (user is in edit mode) | Effect top short-circuits; hover does nothing; existing timers cleared |

**Hard requirements (load-bearing — from Phase 12):**

- `rotInputVisibleRef`, `rotInputHoveredRef`, `rotInputHoverTimerRef`, `rotInputCloseTimerRef` stay as the state model. No `useState` refactor.
- The `activeElement?.closest('[data-rotation-input-field]')` guard at grace-timer expiry is LOAD-BEARING (Plan 12-02 Round 7 fix). Removing it regresses focus-loss scenarios.
- `eslint-disable react-hooks/exhaustive-deps` at `SVGAnnotationLayer.jsx:312` STAYS. Dep array is `[selectedIds, setRotInputVisibleDbg, editingAnnotationIndex]` exactly — nothing added, nothing removed.
- `console.count` on the effect body during a 2-second drag-rotate MUST fire ≤3 times (optimistic-paint pattern preserved, never 60fps). If it fires more, the dep array was polluted and the fix is wrong.
- All 12 Phase 12 debug `console.log` statements (at lines 215, 234, 238, 243, 247, 254, 263, 267, 280, 285, 289, 300) are removed in the same commit.

### EDIT-14 — mtr handle visible on pre-rotated edit-mode entry (Plan 13-02)

**Render states the `SVGSelectionOverlay` component must emit:**

| State | Trigger | Rendered output |
|-------|---------|-----------------|
| select-mode (current, unchanged) | `isEditing === false` | Full bbox + 8 resize handles (corner circles + edge pills) + mtr group — all with `pointerEvents: 'auto'` on interactive elements |
| edit-mode visual-only (NEW — `isEditing === true`) | `editingAnnotationIndex != null && selectedIndex === editingAnnotationIndex && editIsBorderFlush && angle !== 0 && !editIsCounter` | mtr group only (connector line + circle + icon) — all with `pointerEvents: 'none'`. No bbox, no corner circles, no edge pills. Transform `rotate(${angle}, ${cx}, ${cy})` wraps the mtr group so it appears at the pre-rotated screen position. |
| border-flush baseline (unchanged) | `isBeingEditedNow && editIsBorderFlush && angle === 0` | `return null` — short-circuit preserved exactly as today. Clean edit surface, no SVG chrome. |
| counter (unchanged, guarded) | `isBeingEditedNow && editIsCounter` | `return null` — counter branch at `SVGAnnotationLayer.jsx:1052-1099` is untouched. `[COUNTER WIP — DO NOT TOUCH]` guard at `:1044-1047` honored. |

**The `data-rotation-handle="mtr"` attribute MUST appear on the edit-mode mtr group** so Plan 13-01's delegated `pointerover`/`pointerout` handlers still reach the handle. (The handlers will fire, detect the handle via `closest()`, but the subsequent logic is a no-op because the edit-mode gate at effect-top already returned early. The attribute's presence is a contract for future consistency, not a functional requirement for Phase 13.)

### Interaction diagnostic (Plan 13-02 Wave 1 — MANDATORY FIRST STEP)

Before any code change in Plan 13-02, the executor runs a live-DOM diagnostic to identify the actual clipping ancestor:

- **What:** DevTools paste script that walks the ancestor chain from `document.querySelector('[data-rotation-handle="mtr"]')` up through `body`, reading `getBoundingClientRect()` + `window.getComputedStyle(el).overflow / overflowX / overflowY / clipPath / contain` on each link. Output format: compact markdown table with columns `[depth, tagName, className, rect.top, rect.left, rect.width, rect.height, overflow, clipPath]`, flagging any row where `rect.top > mtrRect.top && overflow !== 'visible'`.
- **Why:** Architecture research and Pitfalls research disagree on which clipper owns the symptom. The diagnostic resolves it before committing code.
- **Decision gate:** If clipper is Fabric canvas pixel buffer only → proceed with Fix A. If clipper is Syncfusion `e-pv-page-div` or higher → STOP and escalate to user (Fix A is insufficient; SVG is a child of the page div and will be clipped too). If clipper is both → STOP and escalate.
- **Not committed:** Script runs once, output pasted to plan workspace notes, script discarded. No diagnostic artifact enters source control.

### Out-of-scope interaction changes (DO NOT BUILD)

- Edit-mode rotation by dragging the mtr handle — the handle is visual-only per PROJECT.md line 71. Rotation in edit mode stays deferred; users rotate from select mode or by typing a degree in `RotationInputField`.
- Handle auto-scaling at low zoom — v2.1 ships the Illustrator/Photoshop stacking model. Defer to v2.3+ per `13-CONTEXT.md` deferred list.
- Tooltip / label / instructional text on the edit-mode handle — visual-only means *visually identical*, not *visually distinct*.
- Any visual difference in stroke, fill, or filter between select-mode mtr and edit-mode mtr — byte-identical rendering is the contract.
- Off-screen handle relocation (Gap 2) — closed `wontfix_superseded_by_typed_input` per 9-tool industry survey.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| (none) | (none) | not applicable — no component library, no registry, no third-party UI dependencies for Phase 13 |

Phase 13 is strictly internal — both plans edit existing files (`SVGAnnotationLayer.jsx`, `SVGSelectionOverlay.jsx`) and add zero new dependencies. Confirmed by `.planning/research/STACK.md` (quoted in `13-RESEARCH.md:161`): "Installation: None. Phase 13 adds zero dependencies."

No shadcn, no third-party registries, no vetting gate required. Registry safety = trivially PASS.

---

## Visual Acceptance Cases (Pre-Populated from CONTEXT.md)

These are the UAT cells that the ui-checker and ui-auditor will verify against. They come verbatim from `13-CONTEXT.md:188-221` acceptance criteria — cross-referenced here so the design contract and verification contract share vocabulary.

### EDIT-13 UAT grid — 24 cells

`{rect, circle, ellipse, text} × {angle=0, angle=30} × {exit via click-off, exit via Escape, exit via Enter-commit}`

Each cell verifies:

1. User selects shape → double-clicks into edit mode
2. User exits edit mode via the specified path
3. User hovers mtr handle
4. **Expected:** pill appears within 150ms without a deselect/reselect step
5. **Expected:** `console.count` on the hover-intent effect body during a separate 2-second drag-rotate fires ≤3 times
6. **Expected:** while in edit mode, hovering the mtr does NOT arm the pill (edit-mode gate)

### EDIT-14 UAT grid — 8 cells

`{rect, circle, ellipse, text} × {angle=0, angle=30}`

Each cell verifies:

1. User double-clicks a shape with the specified angle → enters edit mode
2. **Expected (angle=30):** full mtr rotation handle (circle + connector + icon) visible with no clipping by any container or page-div ancestor
3. **Expected (angle=0):** SVG selection chrome short-circuits to null (border-flush clean edit surface preserved — no mtr, no bbox, no resize pills)
4. **Expected (both):** counter annotations unchanged — counter branch at `:1052-1099` is untouched

### Expansion boundary

Do NOT expand either grid to line/arrow (EDIT-13), additional angles (90/135/180), or pen/eraser tools. Rotation path is angle-invariant; tool type is orthogonal to the hover-intent bug class. Expansion diffuses verification focus without adding coverage.

---

## Pre-Populated From

| Source | Decisions Used |
|--------|---------------|
| `13-CONTEXT.md` | Strategy B locked for EDIT-13 · Fix A / Option C locked for EDIT-14 · mandatory DevTools diagnostic · stop-and-escalate fallback · one-atomic-commit-per-plan · no new unit tests · 24-cell + 8-cell UAT grids · visual-only edit-mode handle · load-bearing invariants (refs, activeElement guard, eslint-disable) · counter branch untouched |
| `13-RESEARCH.md` | `pointerover`/`pointerout` delegation pattern with `closest()` + `relatedTarget` boundary check · exact `:1050` narrowing math (`obj.angle || 0` — not `bbox.angle`) · mtr-only render branch structure · 12 debug console.log lines to remove · load-bearing invariants cross-reference |
| `REQUIREMENTS.md` | EDIT-13 + EDIT-14 requirement descriptions · Out of Scope table (Gap 2 closed, Fabric-side fixes deferred, Fabric edit-mode rotation deferred) |
| `ROADMAP.md` §Phase 13 | 4-item Success Criteria · 2-plan breakdown · why-single-phase rationale |
| `STATE.md` v2.2 | Gap 4 strategy lock (Fix A / Option C) · counter-session 7-file allowlist · v2.1 close DONE_WITH_CONCERNS · 113-test baseline |
| `components.json` | absent — no shadcn, manual design system |
| `CLAUDE.md` (project + global) | Always Protected list · single-name font rule · canvas-aware sizing rule · GSD phase discipline (Acceptance Criteria, DO NOT CHANGE, RECONCILIATION.md) |
| Live code read — `SVGSelectionOverlay.jsx:167-206` | Exact mtr geometry (circle radius 12, icon 16.8, stroke widths 1) · exact colors (`#ffffff` fill, `#e0e0e0` + `#d1d1d1` strokes) · `data-rotation-handle="mtr"` attribute · `rotationShadow` filter · `pointerEvents` contract |
| User input during this session | 0 questions asked — all design-contract values were already locked in upstream artifacts or directly readable from existing code |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS — zero copy in Phase 13 surfaces; escalation rule documented; no new strings without approval
- [ ] Dimension 2 Visuals: PASS — mtr geometry preserved byte-for-byte (circle r=12, icon 16.8, stroke widths, `pointerEvents` contract); edit-mode branch matches select-mode branch pixel-for-pixel; no accent added
- [ ] Dimension 3 Color: PASS — neutral-gray palette (`#ffffff` / `#e0e0e0` / `#d1d1d1`) preserved; zero new colors; accent intentionally empty for this phase; `rotationShadow` filter preserved
- [ ] Dimension 4 Typography: PASS — not applicable (no text surfaces in Phase 13); single-name font rule documented for completeness
- [ ] Dimension 5 Spacing: PASS — no new spacing tokens; all existing dimensions documented as zoom-invariant (`inverseScale`-multiplied); 8-point grid exception explained (SVG page-coordinate units, not layout pixels)
- [ ] Dimension 6 Registry Safety: PASS — no registry, no component library, zero new dependencies; trivially safe

**Approval:** pending (awaiting `gsd-ui-checker` validation)

---

*Phase: 13-rotation-handle-edit-mode-polish*
*UI-SPEC authored: 2026-04-14 by `gsd-ui-researcher`*
*Contract type: preservation-only (no new visual design proposed)*
*Downstream consumers: `gsd-ui-checker` (validation) · `gsd-planner` (plan authoring) · `gsd-executor` (implementation reference) · `gsd-ui-auditor` (retroactive audit)*
