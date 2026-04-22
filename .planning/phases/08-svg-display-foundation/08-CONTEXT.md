# Phase 8: SVG Display Foundation - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

All 7 annotation types (pen strokes, highlights, lines, arrows, callouts, shapes, text) render as SVG elements with browser-native zoom scaling via viewBox, replacing Canvas-based display rendering. This is display-only — no editing, no selection, no interaction. Canvas editing comes in Phases 9-11.

</domain>

<decisions>
## Implementation Decisions

### Visual fidelity
- Positionally exact: annotations must appear at correct positions, sizes, and colors matching Canvas output
- Minor differences in anti-aliasing, text kerning, or sub-pixel rendering are acceptable
- NOT pixel-perfect — effort should focus on correctness, not matching Canvas compositing artifacts
- Highlights must use `mix-blend-mode: multiply` in SVG (same blend mode as Canvas)
- Text annotations via foreignObject: minor word-wrap/line-break differences from Fabric IText are acceptable as long as content, position, font/size/color are correct
- Eraser clipPaths must work correctly in Phase 8 — erased annotations are common enough that broken rendering would be noticeable

### Development transition strategy
- Side-by-side toggle: keep both SVG and Canvas rendering available during development
- Toggle mechanism: URL parameter (`?renderer=svg` / `?renderer=canvas`) sets default, keyboard shortcut (e.g., Ctrl+Shift+V) toggles on the fly
- When SVG mode is active, PAL (PageAnnotationLayer) does NOT mount — saves ~44MB per visible page in Canvas memory
- When Canvas mode is active (toggle or default), PAL mounts normally as current behavior
- Toggle persists through all v2.0 phases (8-11), removed in final cleanup after v2.0 completion

### Annotation type priority
- Priority tier 1 (most used): pen strokes, highlights, callouts, lines/arrows
- Priority tier 2: shapes, standalone text
- Build order: priority types working across all pages first, then add tier 2 types
- This means pen/highlights/callouts/arrows are the first deliverable — user can test with real documents before shapes/text are done

### Test data
- Current test PDF ("Package 2 - Rev 4 -- IC.pdf") only has highlights and pen strokes
- Missing types (lines, arrows, callouts, shapes, text) need to be created before full verification
- Test data creation approach: Claude's discretion (script or manual)

### Claude's Discretion
- SVGAnnotationLayer component architecture (new component vs. evolving LightweightAnnotationOverlay)
- Exact keyboard shortcut for renderer toggle
- Test data creation approach (scripted vs. manual setup instructions)
- Build sequence within each tier (e.g., pen before highlights, or together)
- SVG element structure (single root `<svg viewBox>` vs. grouped `<g>` elements)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### SVG migration architecture
- `.planning/PROJECT.md` — Core value statement, constraints (Fabric.js 5.5.2, zero new deps, same JSON format)
- `.planning/REQUIREMENTS.md` — DISP-01 through DISP-11 define exact SVG display requirements
- `.planning/ROADMAP.md` — Phase 8 success criteria and dependency on v1.0 Phase 3

### Existing SVG rendering (80% foundation)
- `src/components/LightweightAnnotationOverlay.jsx` — Already renders paths, lines, arrows, callouts as SVG. Missing: pathOffset, rotation/skew, eraser clipPaths, highlight blend mode, text foreignObject, viewBox approach
- `src/utils/calloutGeometry.js` — `calculateCalloutConnection()` used by overlay for callout line/knee positioning

### Current Canvas rendering (the thing being replaced)
- `src/PageAnnotationLayer.jsx` — Full Canvas rendering with region/space/module filtering logic. Lines ~3100+ have all filtering props (selectedSpaceId, activeRegions, activeRegionId, isRegionOverlayEnabled)
- `src/utils/geometryEraser.js` — Eraser boolean path intersection/subtraction logic
- `src/utils/geometryHitTest.js` — Hit testing utilities (relevant for understanding clipPath data)

### Integration point
- `src/App.jsx` — Line ~24800: where LightweightAnnotationOverlay is rendered. Line ~66: import. This is where SVGAnnotationLayer will be integrated and where the renderer toggle will live

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `LightweightAnnotationOverlay.jsx` (505 lines): Already renders paths (SVG `<path>`), lines (SVG `<line>`), arrows (SVG `<line>` + `<polygon>`), callouts (SVG `<line>` + `<rect>` + `<circle>`). Shapes/text fall back to div-based rendering. This is the 80% starting point.
- `calculateCalloutConnection()` utility: Computes callout line geometry (line1Start, line2Start, effectiveKnee, shouldHideLine1). Already used by the overlay.
- `geometryEraser.js`: Has boolean path logic needed for eraser clipPath rendering.
- Overlay div foundation from v1.0 Phases 1-3: SVG layer will mount into these same persistent overlay divs.

### Established Patterns
- Two-stage scaling: base unscaled coordinates → scaled for render (used in LightweightAnnotationOverlay). SVG viewBox eliminates this — coordinates stay in unscaled PDF page space.
- Region/space filtering: PAL uses `selectedSpaceId`, `activeRegionId`, `isRegionOverlayEnabled`, `getRegionLightbulbState`. Overlay only handles `selectedModuleId`/`showSurveyPanel`. SVGAnnotationLayer needs the full PAL-level filtering.
- Annotation data: Fabric.js JSON with `objects[]` array. Each object has `type`, `left`, `top`, `width`, `height`, `scaleX`, `scaleY`, `angle`, `path` (for pen), `strokeUniform`, `spaceId`, `moduleId`, `regionId`, `globalCompositeOperation`, etc.
- Callouts stored separately from main annotations array with normalized (0-1) coordinates.

### Integration Points
- App.jsx line ~24800: where the overlay renders per page — SVGAnnotationLayer will replace this
- App.jsx render loop: manages which pages get overlays and passes annotation data
- AnnotationContext: state management for annotation data (unchanged by this phase)
- Supabase persistence: same JSON format, no changes needed

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Key reference: the existing LightweightAnnotationOverlay is 80% of the display layer and should be used as the starting point.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-svg-display-foundation*
*Context gathered: 2026-03-23*
