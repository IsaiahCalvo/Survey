import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getMarqueeDirection,
  getMarqueeRect,
  isBBoxFullyContained,
  isBBoxOverlapping,
  MIN_DRAG_PX,
} from '../src/utils/marqueeSelection.js';

// Source contracts for V-02 select-all / multi-select (intended + break + edge).
// Live proof: debug/scenarios/e2e-select-all-multi-select.spec.mjs
// Distinct from hub Documents Select All, Archive Select, survey-rail
// Delete selected, adversarial marquee→Delete, leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('window vs crossing + Shift union / Alt subtract; Ctrl+A is not wired', () => {
  assert.equal(MIN_DRAG_PX, 5);
  assert.equal(getMarqueeDirection({ startX: 10, endX: 40 }), 'window');
  assert.equal(getMarqueeDirection({ startX: 40, endX: 10 }), 'crossing');

  const windowRect = getMarqueeRect({ startX: 10, startY: 10, endX: 40, endY: 40 });
  const inside = { left: 12, top: 12, right: 30, bottom: 30 };
  const clipped = { left: 30, top: 30, right: 60, bottom: 60 };
  assert.equal(isBBoxFullyContained(windowRect, inside), true);
  assert.equal(isBBoxFullyContained(windowRect, clipped), false);
  assert.equal(isBBoxOverlapping(windowRect, clipped), true);

  const interaction = read('src/hooks/useSVGInteraction.js');
  assert.match(interaction, /window\.__selectedAnnotationIds = ids/);
  assert.match(interaction, /Toggle in selection set \(multi-select, Plan 03\)/);
  assert.match(interaction, /shiftHeld: !!e\.shiftKey/);
  assert.match(interaction, /altHeld: !!e\.altKey/);
  assert.match(interaction, /both Shift and Alt are held, Alt wins/);
  assert.match(interaction, /Subtract: remove marquee hits from the existing selection/);
  assert.match(interaction, /Union: add marquee hits to the existing selection/);
  assert.match(interaction, /Replace: marquee hits become the entire selection/);
  assert.match(interaction, /e\.target === svgRef\.current && activeTool === 'select'/);
  assert.match(interaction, /if \(!marqueeState\) return undefined/);
  assert.match(interaction, /Escape/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /e\.key === 'a' \|\| e\.key === 'A'/);
  assert.match(viewer, /!e\.metaKey && !e\.ctrlKey && !e\.altKey && !e\.shiftKey/);
  assert.match(viewer, /setActiveTool\('arrow'\)/);
  assert.doesNotMatch(viewer, /selectAllAnnotations|selectEveryAnnotation|Ctrl\+A select-all/);

  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /keys: \['V'\]/);
  assert.match(overlay, /description: 'Select annotations'/);
  assert.match(overlay, /keys: \['A'\]/);
  assert.match(overlay, /description: 'Arrow'/);
  assert.doesNotMatch(overlay, /Select all/);
  assert.doesNotMatch(overlay, /keys: \['Ctrl', 'A'\]/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /data-group-selection-bbox="true"/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers click / Shift-click / window+crossing / Ctrl+A no-op + 390', () => {
  const spec = read('debug/scenarios/e2e-select-all-multi-select.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /overlay lists Select annotations/);
  assert.match(spec, /overlay must omit Select all/);
  assert.match(spec, /overlay must omit Ctrl\+A/);
  assert.match(spec, /empty-page Ctrl\+A must invent 0/);
  assert.match(spec, /stroke-click must select A/);
  assert.match(spec, /Shift-click must add B/);
  assert.match(spec, /Shift-click must toggle B off/);
  assert.match(spec, /empty click must clear multi-select/);
  assert.match(spec, /window marquee around A must select A/);
  assert.match(spec, /crossing marquee that clips B must select B/);
  assert.match(spec, /window marquee that only clips B must miss B/);
  assert.match(spec, /window marquee around both must select A\+B/);
  assert.match(spec, /Shift-marquee around B must union B/);
  assert.match(spec, /Alt-marquee around B must subtract B/);
  assert.match(spec, /tiny marquee must deselect like an empty click/);
  assert.match(spec, /Esc mid-marquee must keep A\+B/);
  assert.match(spec, /Ctrl\+A must not add B/);
  assert.match(spec, /bare A must not change selection/);
  assert.match(spec, /Arrow-armed empty click must deselect/);
  assert.match(spec, /Ctrl\+A in zoom INPUT must keep A and B/);
  assert.match(spec, /390 Shift-click must add B/);
  assert.match(spec, /390 window marquee around A must select A/);
  assert.match(spec, /390 Ctrl\+A must not add B/);
  assert.match(spec, /hubPreview/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});

test('this slice is annotation V-02, not hub / archive / rail Select All', () => {
  const spec = read('debug/scenarios/e2e-select-all-multi-select.spec.mjs');
  assert.match(spec, /V-02 select-all \/ multi-select/);
  assert.match(spec, /Distinct from hub Documents Select All, Archive Select, survey-rail/);
  assert.doesNotMatch(spec, /docSelectMode|setSelDocs|archiveSelect/);
  assert.doesNotMatch(spec, /Delete selected categories/);

  const hub = read('debug/scenarios/e2e-hub-docs-select-all.spec.mjs');
  assert.match(hub, /hubPreview=1/);
  assert.doesNotMatch(hub, /__selectedAnnotationIds/);
});
