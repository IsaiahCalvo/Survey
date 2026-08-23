import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLineCommitJSON } from '../src/utils/annotationCreationCommit.js';
import { ARROWHEAD_STYLES } from '../src/components/Callout/types.js';

// Source contracts for S-03 / S-04 leftover: live Line / Arrow rubber-band
// then commit. Live proof: debug/scenarios/e2e-line-arrow-live-create.spec.mjs
// Distinct from p1/p2/midpoint handles, dash / arrowhead catalogs, Width,
// S-01/S-02 filled preview, leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const shared = {
  id: 'line-live',
  start: { x: 20, y: 30 },
  end: { x: 120, y: 110 },
  strokeColor: '#FF0000',
  strokeOpacity: 100,
  strokeWidth: 3,
  lineBorderStyle: 'solid',
  cloudIntensity: 2,
  selectedModuleId: null,
  stampRegionId: null,
  activeRegionId: null,
};

test('live line preview + 3pt gate + Line/Arrow head stamp + zoom keep-track stay wired', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /const SHAPE_CREATION_TOOLS = \['rect', 'ellipse', 'line', 'arrow', 'survey-marker'\]/);
  assert.match(layer, /shapeCreation\.tool === 'line' \|\| shapeCreation\.tool === 'arrow'/);
  assert.match(layer, /className="shape-creation-preview"/);
  assert.match(layer, /strokeDasharray="5,5"/);
  assert.match(layer, /opacity=\{0\.6\}/);
  assert.match(layer, /buildLineCommitJSON/);
  assert.match(layer, /never commit partial work/);
  assert.match(layer, /pointercancel/);
  assert.match(layer, /Drag-out[\s\S]*shapes keep tracking/);
  assert.match(layer, /if \(state && FREEHAND_CREATION_TOOLS\.includes\(state\.tool\)\)/);
  assert.match(layer, /zoomGeneration/);
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.doesNotMatch(layer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /setZoomGeneration\(prev => prev \+ 1\)/);
  assert.match(viewer, /beginPdfjsScaleConfirmPending/);

  const line = buildLineCommitJSON({ ...shared, tool: 'line' });
  assert.ok(line);
  assert.equal(line.type, 'Line');
  assert.equal(line.tool, 'line');
  assert.equal(line.data.arrowheadStyle, undefined);
  assert.equal(line.strokeDashArray, null);
  assert.ok(Math.hypot(line.x2 - line.x1, line.y2 - line.y1) > 3);

  const arrow = buildLineCommitJSON({
    ...shared,
    tool: 'arrow',
    id: 'arrow-live',
    arrowheadStyle: ARROWHEAD_STYLES.SOLID_TRIANGLE,
  });
  assert.ok(arrow);
  assert.equal(arrow.type, 'Line');
  assert.equal(arrow.tool, 'arrow');
  assert.equal(arrow.data.arrowheadStyle, 'solidTriangle');

  const tiny = buildLineCommitJSON({
    ...shared,
    tool: 'line',
    id: 'tiny',
    end: { x: 22, y: 31 },
  });
  assert.equal(tiny, null);

  const justOver = buildLineCommitJSON({
    ...shared,
    tool: 'line',
    id: 'just-over',
    end: { x: 23.1, y: 30 },
  });
  assert.ok(justOver);
  assert.ok(Math.hypot(justOver.x2 - justOver.x1, justOver.y2 - justOver.y1) > 3);

  const commit = read('src/utils/annotationCreationCommit.js');
  assert.match(commit, /if \(!\(Math\.hypot\(dx, dy\) > 3\)\) return null/);
  assert.match(commit, /only the ARROW tool stamps the toolbar's/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers preview / commit / arrow head / zoom keep-track / cancel / 390 / file.id', () => {
  const spec = read('debug/scenarios/e2e-line-arrow-live-create.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop line\/arrow live create intended \+ break \+ edge/);
  assert.match(spec, /390 line\/arrow live create intended \+ break \+ edge/);
  assert.match(spec, /empty page live line preview 0/);
  assert.match(spec, /empty Select drag invents 0/);
  assert.match(spec, /live line preview must paint before pointerup/);
  assert.match(spec, /Line live drag must not commit yet/);
  assert.match(spec, /Line preview is not the Rect\/Ellipse g path/);
  assert.match(spec, /CREATE-01 preview is dashed 5,5/);
  assert.match(spec, /Line pointerup must drop the preview/);
  assert.match(spec, /Line commit must pass the 3pt gate/);
  assert.match(spec, /Line create never stamps arrowheadStyle/);
  assert.match(spec, /CREATE-01 commit restores solid/);
  assert.match(spec, /Arrow live drag must not commit yet/);
  assert.match(spec, /Arrow create stamps the toolbar default head/);
  assert.match(spec, /tiny click must invent 0/);
  assert.match(spec, /pointercancel must drop the preview/);
  assert.match(spec, /pointercancel must invent 0/);
  assert.match(spec, /zoom mid-drag starts uncommitted/);
  assert.match(spec, /zoom mid-drag must not flush a drag-out line/);
  assert.match(spec, /zoom keep-track \+ pointerup must not double-commit/);
  assert.match(spec, /390 Line live drag must not commit yet/);
  assert.match(spec, /390 Arrow preview must be a <line>/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});

test('live create is not handle catalog / dash catalog / rotate / leftover-18 hosts', () => {
  const spec = read('debug/scenarios/e2e-line-arrow-live-create.spec.mjs');
  assert.match(spec, /S-03 \/ S-04 leftover: live Line \/ Arrow rubber-band then commit/);
  assert.match(spec, /Distinct from leftover-18/);
  assert.doesNotMatch(spec, /data-endpoint-handle|data-line-handle="p1"|dragResizeHandle/);
  assert.doesNotMatch(spec, /data-rotation-handle="mtr"|Match fill/);
  assert.doesNotMatch(spec, /freehand-creation-preview/);
  assert.doesNotMatch(spec, /setActiveTool\('pan'\)|keyboard\.down\('Space'\)/);
  assert.doesNotMatch(spec, /getByRole\('button', \{ name: 'Dashed'/);
  assert.doesNotMatch(spec, /getByRole\('button', \{ name: 'Solid triangle'/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.doesNotMatch(layer, /file\.id\s*=/);
  assert.match(layer, /zoomGeneration/);
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
});
