# Phase 15 Pre-Implementation Visual Baseline

**Purpose:** No-regression contract for straight lines/arrows (UI-SPEC §"Testing / Verification Contract" #1 + CONTEXT.md §"Area 4").

## When to capture

Before Plan 15-02 starts modifying `src/utils/svgAnnotationRenderers.jsx`. Wave 0 ownership — this README lives here so the capture step is scheduled, not ad-hoc.

## What to capture

1. Start dev server: `npm run dev`
2. Open `Package 2 - Rev 4 -- IC.pdf` (test PDF — see `.claude/projects/-Users-isaiahcalvo-Desktop-Survey-BetaSafeS2/memory/MEMORY.md`)
3. Navigate to Page 6 (first page with existing annotations)
4. Screenshot the full page view at these zoom levels and save to this directory:
   - `page6-zoom-50.png` (50% zoom)
   - `page6-zoom-100.png` (100% zoom)
   - `page6-zoom-200.png` (200% zoom)

After Phase 15 ships, capture matching screenshots into `debug/baselines/phase15-post/`. Any straight-line or pre-existing-arrow pixel diff is a regression bug.

## Acceptance

Diff tool: `npx playwright screenshot` or manual eyeball (phase is visual-parity-critical).

## Rationale

UI-SPEC §B locks the straight `<line>` branch byte-identical to v2.2. Phase 15's curved `<path>` branch only activates when `data.midpoint` is present. Legacy annotations with no midpoint field MUST render identically — this README is the mechanism for proving it.
