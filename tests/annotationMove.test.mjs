import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { constrainToPage } from '../src/utils/svgTransformMath.js';

// Source contracts for E-03 leftover: selected-annotation move.
// Live proof: debug/scenarios/e2e-annotation-move.spec.mjs
// Distinct from E-01 resize, E-02 rotation, V-01 pan, V-02 select,
// survey-marker body, leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('constrainToPage + single/group move commit stay on the page', () => {
  assert.deepEqual(constrainToPage(-10, -8, 50, 40, 612, 792), { left: 0, top: 0 });
  assert.deepEqual(constrainToPage(600, 780, 50, 40, 612, 792), { left: 562, top: 752 });
  assert.deepEqual(constrainToPage(100, 120, 50, 40, 612, 792), { left: 100, top: 120 });

  const hook = read('src/hooks/useSVGInteraction.js');
  assert.match(hook, /import \{[^}]*constrainToPage/);
  assert.match(hook, /mode: 'move'/);
  assert.match(hook, /mode: 'group-move'/);
  assert.match(hook, /Only commit if there was actual movement \(> 2px threshold/);
  assert.match(hook, /if \(Math\.abs\(dx\) > 2 \|\| Math\.abs\(dy\) > 2\)/);
  assert.match(hook, /Constrain against the ABSOLUTE bbox/);
  assert.match(hook, /const constrained = constrainToPage\(newAbsLeft, newAbsTop, bbox\.width, bbox\.height, pageWidth, pageHeight\)/);
  assert.match(hook, /const actualDx = constrained\.left - bbox\.left/);
  assert.match(hook, /const actualDy = constrained\.top - bbox\.top/);
  assert.match(hook, /action: 'move'/);
  assert.match(hook, /action: 'group-move'/);
  assert.match(hook, /justDraggedAtRef\.current = Date\.now\(\)/);
  assert.match(hook, /Initiate drag-to-move/);
  assert.match(hook, /Group drag: when multiple annotations are selected/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.doesNotMatch(layer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);
  assert.match(layer, /data-group-selection-bbox="true"/);

  const math = read('src/utils/svgTransformMath.js');
  assert.match(math, /export function constrainToPage/);
  assert.match(math, /Math\.max\(0, Math\.min\(left, pageWidth - width\)\)/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers single / group-move / clamp / hollow / Pen / 390 / file.id', () => {
  const spec = read('debug/scenarios/e2e-annotation-move.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop annotation move intended \+ break \+ edge/);
  assert.match(spec, /390 annotation move intended \+ break \+ edge/);
  assert.match(spec, /empty Select drag invents 0/);
  assert.match(spec, /single move must change A left\/top/);
  assert.match(spec, /single move must hold A width/);
  assert.match(spec, /single move must isolate B left/);
  assert.match(spec, /undo must restore A left\/top/);
  assert.match(spec, /redo must restore moved A/);
  assert.match(spec, /group-move must translate A and B/);
  assert.match(spec, /group-move must keep B dx with A/);
  assert.match(spec, /undo group-move must restore A and B/);
  assert.match(spec, /micro-drag must not commit left/);
  assert.match(spec, /hollow-fill drag must not move A left/);
  assert.match(spec, /off-page drag must clamp to page origin/);
  assert.match(spec, /Pen drag must invent ink/);
  assert.match(spec, /Pen drag must not move A/);
  assert.match(spec, /390 single move must change A left\/top/);
  assert.match(spec, /390 group-move must translate A and B/);
  assert.match(spec, /390 off-page drag must clamp to page origin/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});

test('move is not resize / rotation / pan / leftover-18 hosts', () => {
  const spec = read('debug/scenarios/e2e-annotation-move.spec.mjs');
  assert.match(spec, /E-03 leftover: selected-annotation move/);
  assert.match(spec, /Distinct from leftover-18/);
  assert.doesNotMatch(spec, /Rotation angle in degrees|Match fill|Zoom percentage|Jump to page/);
  assert.doesNotMatch(spec, /setActiveTool\('pan'\)|keyboard\.down\('Space'\)/);

  const hook = read('src/hooks/useSVGInteraction.js');
  assert.doesNotMatch(hook, /file\.id\s*=/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /zoomGeneration/);
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
});
