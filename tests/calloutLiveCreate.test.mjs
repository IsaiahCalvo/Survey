import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createCallout } from '../src/components/Callout/types.js';

// Source contracts for T-02 leftover: live Callout rubber-band then
// commit. Live proof: debug/scenarios/e2e-callout-live-create.spec.mjs
// Distinct from knee / corners / arrowhead / dash / formatting catalogs,
// T-01 textbox auto-edit, leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('live callout preview + 4px gate + CREATE-01 ghost + zoom keep-track stay wired', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /className="callout-preview"/);
  assert.match(layer, /opacity=\{0\.6\}/);
  assert.match(layer, /strokeDasharray="5,5"/);
  assert.match(layer, /const previewW = 120/);
  assert.match(layer, /const previewH = 32/);
  assert.match(layer, /previewKneeRadius = 40/);
  assert.match(layer, /ARROWHEAD_STYLES\.SOLID_TRIANGLE/);
  assert.match(layer, /if \(dx \* dx \+ dy \* dy < 16\) return/);
  assert.match(layer, /createCallout\(/);
  assert.match(layer, /if \(activeTool !== 'callout'\) \{\s*setCalloutCreation\(null\)/);
  assert.match(layer, /setCalloutCreation\(\{ arrowTip: pt, currentPointer: pt \}\)/);
  assert.match(layer, /Drag-out[\s\S]*shapes keep tracking/);
  assert.match(layer, /if \(state && FREEHAND_CREATION_TOOLS\.includes\(state\.tool\)\)/);
  assert.match(layer, /zoomGeneration/);
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.doesNotMatch(layer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /setZoomGeneration\(prev => prev \+ 1\)/);
  assert.match(viewer, /beginPdfjsScaleConfirmPending/);

  const made = createCallout(
    1,
    { x: 0.20, y: 0.30 },
    { x: 0.24, y: 0.28 },
    { x: 0.40, y: 0.42 },
    120 / 612,
    32 / 792,
  );
  assert.ok(made.id.startsWith('callout-'));
  assert.equal(made.pageNumber, 1);
  assert.equal(made.text, '');
  assert.equal(made.style.fontFamily, 'Arial');
  assert.equal(made.style.arrowheadStyle, 'solidTriangle');
  assert.equal(made.style.lineStyle, 'solid');
  assert.ok(made.textBoxWidth > 0.15);
  assert.ok(made.textBoxHeight > 0.03);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers preview / commit / 4px gate / tool-switch / zoom keep-track / 390 / file.id', () => {
  const spec = read('debug/scenarios/e2e-callout-live-create.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop callout live create intended \+ break \+ edge/);
  assert.match(spec, /390 callout live create intended \+ break \+ edge/);
  assert.match(spec, /empty page live callout preview 0/);
  assert.match(spec, /empty Select drag invents 0/);
  assert.match(spec, /live callout preview must paint before pointerup/);
  assert.match(spec, /Callout live drag must not commit yet/);
  assert.match(spec, /Callout preview is not the Rect\/Ellipse g path/);
  assert.match(spec, /Callout preview is not the Line\/Arrow path/);
  assert.match(spec, /CREATE-01 preview box is dashed 5,5/);
  assert.match(spec, /CREATE-01 preview is translucent/);
  assert.match(spec, /CREATE-01 preview shows a solid-triangle ghost head/);
  assert.match(spec, /Callout pointerup must drop the preview/);
  assert.match(spec, /CREATE-01 commit restores solid box/);
  assert.match(spec, /create stamps a single-name fontFamily/);
  assert.match(spec, /tiny click must invent 0/);
  assert.match(spec, /tool-switch mid-drag must drop the preview/);
  assert.match(spec, /tool-switch mid-drag must invent 0/);
  assert.match(spec, /zoom mid-drag starts uncommitted/);
  assert.match(spec, /zoom mid-drag must not flush a drag-out callout/);
  assert.match(spec, /zoom keep-track \+ pointerup must not double-commit/);
  assert.match(spec, /390 Callout live drag must not commit yet/);
  assert.match(spec, /390 CREATE-01 preview is dashed 5,5/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});

test('live create is not knee catalog / dash catalog / rotate / leftover-18 hosts', () => {
  const spec = read('debug/scenarios/e2e-callout-live-create.spec.mjs');
  assert.match(spec, /T-02 leftover: live Callout rubber-band then commit/);
  assert.match(spec, /Distinct from leftover-18/);
  assert.doesNotMatch(spec, /data-callout-part="knee"|textBox-tl|dragResizeHandle/);
  assert.doesNotMatch(spec, /data-rotation-handle="mtr"|Match fill/);
  assert.doesNotMatch(spec, /freehand-creation-preview|shape-creation-preview must paint/);
  assert.doesNotMatch(spec, /setActiveTool\('pan'\)|keyboard\.down\('Space'\)/);
  assert.doesNotMatch(spec, /getByRole\('button', \{ name: 'Dashed'/);
  assert.doesNotMatch(spec, /getByRole\('button', \{ name: 'Solid triangle'/);
  assert.doesNotMatch(spec, /getByRole\('button', \{ name: 'Bold'/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.doesNotMatch(layer, /file\.id\s*=/);
  assert.match(layer, /zoomGeneration/);
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
});
