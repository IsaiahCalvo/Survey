# Feature Research — Stage 0 Shape Edit Polish

**Domain:** Professional annotation / design tool interaction conventions
**Scope:** Shift+rotate snap and extreme-zoom-out floor (v2.1 Stage 0, ~11 LOC total)
**Researched:** 2026-04-12
**Confidence:** HIGH

> **NOTE — scoped research.** This file covers ONLY the two Stage 0 polish
> features. The v2.0 SVG Migration feature landscape (table stakes for annotation
> rendering, selection, editing, etc.) was researched separately on 2026-03-23
> and is out of scope here. Do not treat this as a superset.

---

## TL;DR — Just Ship It

**Ship exactly what the backlog says. No visual feedback. No configurability. No scope creep.**

- **Shift+rotate snaps to 45°** while held. Default off (unmodified drag is free rotate). Matches Illustrator + Miro + Sketch + Photoshop, matches the engineering-blueprint intuition of the target user (mechanical/electrical engineers stamp shapes on orthogonal/diagonal axes), and matches what the user already wrote in FEATURE-BACKLOG.md.
- **Zoom floor = 10%.** Exactly matches Excalidraw. Sits in the middle of the competitive range (Figma 1-2% practical, Miro 25% practical). No dynamic floor, no handle auto-scaling, no "zoom back in to edit" warning UI.
- **No visual feedback, no cursor angle readout, no tick marks.** Pure behavior is table stakes; readout is a differentiator explicitly out of scope. The right panel angle readout (if/when one exists) is a Stage 3 Preferences concern, not Stage 0.

**Net LOC estimate:** ~11 lines, exactly as scoped. No extra.

---

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Shift held during rotate drag snaps to discrete angle** | Universal convention across every major tool (Illustrator, Figma, Excalidraw, Miro, Sketch, Photoshop, Acrobat, FigJam). Users will TRY Shift first when they need a horizontal/vertical/diagonal shape. Missing = tool feels unfinished. | LOW (minutes) | Both SVG path (`useSVGInteraction.js` ~L391, check `e.shiftKey` + `Math.round(angle/45)*45`) and Fabric path (`obj.snapAngle=45` toggled via keydown/keyup in `FabricEditCanvas.jsx`). |
| **Shift = momentary modifier, not a toggle** | Every tool surveyed treats Shift as "only while held". No tool makes snap the default-on behavior that Shift disables. | LOW | Already the backlog spec. Do not invert. |
| **Free rotate when Shift is NOT held** | Users need fine control for non-orthogonal callouts. Hard-locking rotation to multiples always is an anti-pattern. | LOW | Already how the current code works; just don't break it. |
| **Zoom floor low enough to see whole multi-page PDFs** | 50% is painfully high for engineering drawings. Competitive floors: Excalidraw 10%, Figma 1-2%, Miro 25% (dynamic). Target user reviews full-page mechanical drawings. | LOW (1 LOC) | Change `MIN_SCALE` from `0.5` to `0.1` in `src/utils/zoomController.js`. |
| **Clamp honored on every zoom path** | Keyboard, toolbar, pinch, wheel, fit-to-page must all respect the new floor without accidentally breaking the upper bound or allowing 0 / negative scale. | LOW | Backlog confirms "every zoom path goes through `clampScale()`" — so this is already a single-constant change. Verify with a grep before calling done. |

### Differentiators (Competitive Advantage)

Features that would improve UX beyond basic snap+floor. **Explicitly out of scope for Stage 0** — listed here so the planner can see the complexity gradient and NOT accidentally slide into them.

| Feature | Value Proposition | Complexity | Verdict |
|---------|-------------------|------------|---------|
| Live angle readout next to cursor during rotate | Matches Figma's sidebar readout on the canvas itself; removes the need to look away | MEDIUM (new overlay component, coordinate transform, hide on commit) | **DEFER.** Stage 3 UX polish. Not worth the scope expansion for a ~11 LOC milestone. |
| Configurable snap increment in preferences (15°/22.5°/45°/90°) | Matches Illustrator's Constrain Angle preference, and Figma's 15° differs from Illustrator's 45° — some users will have muscle memory for either. | MEDIUM (needs Preferences surface, which Stage 3 hasn't built yet) | **DEFER.** Depends on Stage 3 Preferences → Annotations tab. Ship the 45° default first; revisit when the prefs surface exists. |
| Auto-scale rotation/edit handles at low zoom so they stay clickable | Solves the Q4 edge case: at <25% zoom, handles become too small to target (confirmed pain point in Illustrator/Affinity/Photoshop per [bjango design-tool-canvas-handles analysis](https://bjango.com/articles/designtoolcanvashandles/) and [Excalidraw issue #9059](https://github.com/excalidraw/excalidraw/issues/9059)). | MEDIUM-HIGH (needs `vector-effect`-style sizing for handle rects in `SVGAnnotationLayer`, non-trivial in Fabric edit canvas) | **DEFER.** See "Edge Case Analysis" below. Accept stacked handles at extreme zoom (Illustrator/Photoshop model) and document the workaround ("zoom back in to edit"). Do not build this in Stage 0. |
| Sketch-style "enlarge bounding box to keep handles accessible" | Alternate solution to the same edge case. | HIGH (changes selection geometry) | **DEFER.** Too invasive for a polish pass. |
| Figma-style "hide handles, move-only at low zoom" | Another alternate solution — disables resize/rotate below a threshold, keeps select+drag. | MEDIUM (threshold check + conditional rendering in `SVGAnnotationLayer`) | **DEFER unless the 10% floor ships and users complain.** This is the cheapest of the three handle strategies if it ever becomes a real problem. Note for v2.2 backlog if needed. |
| Momentary visual snap indicator (tick mark flash, highlight on snap) | Makes the snap feel tactile. | MEDIUM (animation state, render) | **ANTI-FEATURE for this tool.** No surveyed annotation tool ships this — behavior alone is the convention. Adding it would be inventing UX that users don't expect. |

### Anti-Features (Looked Tempting, DO NOT BUILD)

Things a planner might propose that we should explicitly reject for Stage 0.

| Feature | Why Tempting | Why Wrong | What to Do Instead |
|---------|--------------|-----------|--------------------|
| **Make snap the default, Shift disables it** | "Makes precision free" | Inverts every user's muscle memory from Illustrator/Figma/Miro/Acrobat/Sketch/FigJam. Users will rotate one degree, find themselves pinned to 45°, and get angry. | Shift-to-enable. Ship the convention. |
| **Pick 15° instead of 45° to match Figma** | Figma's 15° is newer; it's slightly more "modern" | The backlog already specifies 45°. Target user is mechanical/electrical engineers stamping shapes on PDFs — their intuition is 0°/45°/90° (blueprint axes), not 15° (vector design). Illustrator + Miro + Sketch + Photoshop all use 45° for shift-rotate. The "15° camp" (Figma, Excalidraw) is the minority in the tools this user actually compares against. | Ship 45°. If a user ever asks for 15°, expose it via the Stage 3 Preferences → Annotations tab. |
| **Configurable snap increment in Stage 0** | "It's just another input field" | Adds a preferences surface that doesn't exist yet (Stage 3). Adds a migration path. Adds test coverage. Kills the ~11 LOC scope. | Defer to Stage 3 Preferences. |
| **Dynamic zoom floor that depends on annotation size (Miro-style)** | "Smart, content-aware" | Non-trivial to compute correctly across multi-page PDFs. Introduces a new failure mode (mis-computed floor). Not required for the engineer persona. | Static 10%. Matches Excalidraw. |
| **Handle auto-scaling at low zoom** | "Solves the edge case the research flagged" | 3 surveyed tools don't scale handles (Illustrator, Affinity, Photoshop) and their users mostly deal with it by zooming back in. Fabric + SVG dual-rendering makes this 2x the work. Not a ~11 LOC feature. | Accept stacked handles at extreme zoom. Document the "zoom back in to edit" workaround. Flag for v2.2 if users complain. |
| **Angle readout tooltip next to cursor during rotate** | "Figma-like nice touch" | Figma shows angle in the sidebar, NOT at the cursor. The cursor readout is ambitious UX not even Figma ships. Adds a new overlay component. | Defer. Not table stakes anywhere. |
| **Momentary snap indicator animation (tick / highlight)** | "Gives tactile feedback" | Zero surveyed tools do this. Inventing new UX is strictly worse than matching convention. | Pure behavior. |
| **Lowering the UPPER zoom bound or touching any other constant in `zoomController.js`** | "While we're in the file" | Out of scope. Upper bound unrelated, already works. | Change only `MIN_SCALE`. |

---

## Edge Case Analysis — Handles at Low Zoom

**The Q4 concern:** At very low zoom (<25%), rotation/resize handles may become too small to click. Does this break the 10% floor?

**Convention survey** (source: [bjango — Design tool canvas handles](https://bjango.com/articles/designtoolcanvashandles/)):

| Tool | Strategy | Tradeoff |
|------|----------|----------|
| **Sketch** | Enlarges bounding box so handles stay outside content | Distorts the visual "truth" of the selection |
| **Figma** | Hides resize/rotate handles at low zoom, allows move only | Feels limited but is consistent |
| **Illustrator / Affinity / Photoshop** | Lets handles stack/overlap — accepts the problem | Users learn to zoom back in to edit |
| **Excalidraw** | Also has the pain point (see [issue #9059](https://github.com/excalidraw/excalidraw/issues/9059)) and ships without a solution | Same as Illustrator |

**Verdict for Stage 0:** Accept the **Illustrator/Photoshop model** — handles stack at extreme zoom, users zoom back in to edit. This is:

1. The majority behavior among surveyed tools.
2. Zero additional code (consistent with the ~11 LOC budget).
3. Not a regression — today the zoom floor is 50%, so the handles problem doesn't exist. At 10% zoom the user intent is "see the whole page," not "edit a single annotation." The natural workflow is zoom-to-see → zoom-in-to-edit.
4. Reversible — if user feedback is "I hit this all the time," add the Figma-style "hide handles below N% zoom" strategy in v2.2 as a small follow-up (~20-40 LOC, one threshold check in `SVGAnnotationLayer.jsx`).

**Flag for planner:** Add an acceptance criterion to the Stage 0 phase CONTEXT.md that says:

> **Given** the zoom floor is 10%, **when** the user zooms below 25% and tries to grab a resize/rotation handle, **then** the handle may be difficult to target — this is accepted table-stakes behavior matching Illustrator/Photoshop. The user is expected to zoom back in to edit. This is NOT a defect.

Document this in RECONCILIATION.md as a known carry-forward so future sessions don't relitigate it.

---

## MVP Definition for Stage 0

### Must Ship (v2.1 Stage 0)

- [x] **Shift+rotate → 45° snap** in SVG rotation path (`useSVGInteraction.js`)
- [x] **Shift+rotate → 45° snap** in Fabric edit path (`FabricEditCanvas.jsx` via `obj.snapAngle`)
- [x] **Zoom floor 10%** via `MIN_SCALE = 0.1` in `zoomController.js`
- [x] **Verify every zoom path still clamps** — grep for `clampScale` / `MIN_SCALE` usages, confirm no hardcoded `0.5` bypasses the constant

### Explicitly Deferred (NOT in Stage 0)

- [ ] Angle readout at cursor during rotate → **Stage 3 UX polish**
- [ ] Configurable snap increment (15°/22.5°/45°/90°) → **Stage 3 Preferences → Annotations**
- [ ] Handle auto-scaling at low zoom → **v2.2 backlog IF users complain**
- [ ] Dynamic/content-aware zoom floor → **rejected**
- [ ] Momentary snap indicator animation → **rejected (anti-feature)**

---

## Dependency Graph

```
Shift+rotate snap (SVG path)  ──independent──
Shift+rotate snap (Fabric path) ──independent──
Zoom floor 10%                 ──independent──
```

All three items are fully independent. No ordering constraints inside Stage 0.
They all depend on v2.0 SVG Migration being complete (it is, per PROJECT.md).

**Soft coupling to watch for:**
- The Fabric `obj.snapAngle=45` toggle needs keydown/keyup listeners. Make sure they're scoped to the edit session (mounted when `FabricEditCanvas` mounts, removed on unmount) — a global listener would leak.
- The new 10% zoom floor may expose latent assumptions in `SVGAnnotationLayer.jsx` about minimum stroke widths or handle sizes. Nothing obviously breaks at 10%, but include a smoke test: zoom to 10%, confirm pen strokes still visible (they use `non-scaling-stroke`, should be fine), confirm a shape is selectable by clicking inside its bbox (not its handle).

---

## Competitor Convention Matrix

| Behavior | Figma | Illustrator | Miro | Excalidraw | Sketch | Acrobat | **Our Choice** |
|----------|-------|-------------|------|-----------|--------|---------|----------------|
| Shift-rotate increment | **15°** | **45°** | **45°** | **15°** | **45°** (inferred) | 15° or 45° (sources conflict) | **45°** |
| Shift = enables snap (momentary) | Yes | Yes | Yes | Yes | Yes | Yes | **Yes** |
| Default snap off (free rotate unmodified) | Yes | Yes | Yes | Yes | Yes | Yes | **Yes** |
| Cursor angle readout during rotate | No (sidebar only) | No | No | No | No | No | **No** (matches all) |
| Configurable increment | No | Yes (Constrain Angle pref, affects other tools) | No | No | No | No | **No** (defer to Stage 3) |
| Zoom floor | ~1-2% | low (tiled) | 25% practical / 1% min | **10%** | low | ~10% | **10%** (matches Excalidraw exactly) |
| Handles at low zoom | Hides (move-only) | Stacks | N/A | Stacks (known pain) | Enlarges bbox | Stacks | **Stacks** (Illustrator model) |

**Interpretation:** The 45° camp wins 4-2 among tools where the source is unambiguous. Every tool treats Shift as a momentary enable, not a toggle. No tool ships cursor-readout feedback during rotate. The 10% zoom floor matches Excalidraw exactly and is comfortably within the industry norm.

---

## Sources

- [Figma — Adjust alignment, rotation, position, and dimensions](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions) — Shift snaps to **15°** increments; angle displays in right sidebar (not cursor). **HIGH confidence** (official docs, verified via WebFetch)
- [Adobe Illustrator community — Shift+rotate = 45° default](https://community.adobe.com/t5/illustrator-discussions/rotate-snap-not-adhering-to-45-degree-turns/m-p/13551716) — Shift constrains rotation to **45°** increments (default, hardcoded). Constrain Angle preference affects other tools but not the Shift-rotate snap. **MEDIUM-HIGH** (community-verified Adobe docs)
- [Miro community — Shift = 45° snap](https://community.miro.com/ask-the-community-45/turn-off-rotation-aligment-45-degrees-off-9986) — confirmed 45° snap behavior. **MEDIUM**
- [Excalidraw DeepWiki — Element Transformations](https://deepwiki.com/excalidraw/excalidraw/3.4-element-transformations) — Shift snaps rotation to **15°** increments. **MEDIUM-HIGH**
- [Excalidraw Issue #9059 — Handle area too small](https://github.com/excalidraw/excalidraw/issues/9059) — confirmed handles-at-low-zoom is an unsolved pain point in Excalidraw. **HIGH**
- [bjango — Design tool canvas handles](https://bjango.com/articles/designtoolcanvashandles/) — Sketch enlarges bbox, Figma hides handles, Illustrator/Affinity/Photoshop stack them. **HIGH** (well-known industry reference)
- [Figma zoom — 1% min typeable, relative to window size](https://help.figma.com/hc/en-us/articles/360041065034-Adjust-your-zoom-and-view-options) — 1% is the minimum typed zoom value. Practical floor depends on window size. **HIGH**
- [Excalidraw zoom 10% min / 3000% max](https://github.com/excalidraw/excalidraw/issues/8741) — Excalidraw ships a 10% zoom floor. **MEDIUM**
- [Miro — 25% practical zoom floor](https://community.miro.com/ask-the-community-45/miro-board-does-not-zoom-out-below-25-14825) — dynamic floor based on content, practical minimum ~25%. **MEDIUM**
- [Nutrient/PSPDFKit — annotation rotation API](https://www.nutrient.io/guides/web/annotations/annotation-rotation/) — quantizes to 1° integer precision; no documented Shift-snap convention. **HIGH** (official API docs)
- [Adobe Acrobat — Shift constrains rotation](https://community.adobe.com/t5/acrobat-discussions/rotate-shape-in-adobe-acrobat-pro/td-p/14238696) — Shift constrains rotation; sources conflict on 15° vs 45°. **LOW** (conflicting community sources)

---

*Research for: Stage 0 Shape Edit Polish (v2.1), ~11 LOC scope*
*Researched: 2026-04-12*
*Downstream consumer: REQUIREMENTS.md and Stage 0 phase CONTEXT.md*
