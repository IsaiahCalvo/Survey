import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBoundaryShapeCommitJSON } from '../src/utils/annotationCreationCommit.js';
import { computeDrawnBoundaryShapePreviewGeometry } from '../src/utils/shapeCommitGeometry.js';

// Source contracts for S-01 / S-02 leftover: live rect/ellipse rubber-band
// then commit. Live proof: debug/scenarios/e2e-shape-live-create.spec.mjs
// Distinct from Style / Width / selected resize/mtr, freehand preview,
// leftover-18. Line/arrow dashed preview is a different path.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const shared = {
  id: 'shape-live',
  start: { x: 20, y: 30 },
  end: { x: 120, y: 110 },
  strokeColor: '#FF0000',
  strokeOpacity: 100,
  fillColor: 'transparent',
  fillOpacity: 100,
  strokeWidth: 3,
  lineBorderStyle: 'solid',
  cloudIntensity: 2,
  selectedModuleId: null,
  stampRegionId: null,
  activeRegionId: null,
};

test('live preview + 2pt gate + zoom keep-track + pointercancel stay wired', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /const SHAPE_CREATION_TOOLS = \['rect', 'ellipse', 'line', 'arrow', 'survey-marker'\]/);
  assert.match(layer, /className="shape-creation-preview"/);
  assert.match(layer, /computeDrawnBoundaryShapePreviewGeometry/);
  assert.match(layer, /buildBoundaryShapeCommitJSON/);
  assert.match(layer, /shapeCreation\.tool === 'rect' \|\| shapeCreation\.tool === 'ellipse'/);
  assert.match(layer, /never commit partial work/);
  assert.match(layer, /pointercancel/);
  assert.match(layer, /Drag-out shapes keep tracking/);
  assert.match(layer, /if \(state && FREEHAND_CREATION_TOOLS\.includes\(state\.tool\)\)/);
  assert.match(layer, /zoomGeneration/);
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.doesNotMatch(layer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /setZoomGeneration\(prev => prev \+ 1\)/);
  assert.match(viewer, /beginPdfjsScaleConfirmPending/);

  const preview = computeDrawnBoundaryShapePreviewGeometry({
    tool: 'rect',
    startX: 20,
    startY: 30,
    pointerX: 120,
    pointerY: 110,
    strokeWidth: 3,
  });
  assert.ok(preview.outerBounds.width > 2 && preview.outerBounds.height > 2);
  assert.equal(preview.fabricProps.width, 100 - 3);
  assert.equal(preview.fabricProps.height, 80 - 3);

  const rect = buildBoundaryShapeCommitJSON({ ...shared, tool: 'rect' });
  assert.ok(rect);
  assert.equal(rect.type, 'Rect');
  assert.equal(rect.data.strokeRenderContract, 'drawn-centered-stroke');
  assert.ok(rect.width > 2 && rect.height > 2);

  const ellipse = buildBoundaryShapeCommitJSON({ ...shared, tool: 'ellipse', id: 'ell-live' });
  assert.ok(ellipse);
  assert.equal(ellipse.type, 'Ellipse');
  assert.ok(ellipse.rx > 0 && ellipse.ry > 0);
  assert.equal(ellipse.data.strokeRenderContract, 'drawn-centered-stroke');

  const tiny = buildBoundaryShapeCommitJSON({
    ...shared,
    tool: 'rect',
    id: 'tiny',
    end: { x: 21, y: 31 },
  });
  assert.equal(tiny, null);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers preview / commit / ellipse / zoom keep-track / cancel / 390 / file.id', () => {
  const spec = read('debug/scenarios/e2e-shape-live-create.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop shape live create intended \+ break \+ edge/);
  assert.match(spec, /390 shape live create intended \+ break \+ edge/);
  assert.match(spec, /empty page live preview 0/);
  assert.match(spec, /empty Select drag invents 0/);
  assert.match(spec, /live shape preview must paint before pointerup/);
  assert.match(spec, /Rect live drag must not commit yet/);
  assert.match(spec, /Rect pointerup must drop the preview/);
  assert.match(spec, /Rect commit must pass the 2pt gate/);
  assert.match(spec, /Ellipse preview must render an ellipse/);
  assert.match(spec, /Ellipse commit stamps rx/);
  assert.match(spec, /tiny click must invent 0/);
  assert.match(spec, /pointercancel must drop the preview/);
  assert.match(spec, /pointercancel must invent 0/);
  assert.match(spec, /zoom mid-drag starts uncommitted/);
  assert.match(spec, /zoom mid-drag must not flush a drag-out shape/);
  assert.match(spec, /zoom keep-track \+ pointerup must not double-commit/);
  assert.match(spec, /390 Rect live drag must not commit yet/);
  assert.match(spec, /390 Ellipse preview must render an ellipse/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});

test('live create is not Style catalog / rotate / freehand / leftover-18 hosts', () => {
  const spec = read('debug/scenarios/e2e-shape-live-create.spec.mjs');
  assert.match(spec, /S-01 \/ S-02 leftover: live rect\/ellipse rubber-band then commit/);
  assert.match(spec, /Distinct from leftover-18/);
  assert.doesNotMatch(spec, /data-rotation-handle="mtr"|dragResizeHandle|Match fill/);
  assert.doesNotMatch(spec, /freehand-creation-preview/);
  assert.doesNotMatch(spec, /setActiveTool\('pan'\)|keyboard\.down\('Space'\)/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.doesNotMatch(layer, /file\.id\s*=/);
  assert.match(layer, /zoomGeneration/);
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
});
