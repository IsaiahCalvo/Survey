import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFreehandCommitJSON } from '../src/utils/annotationCreationCommit.js';

// Source contracts for D-01 / D-02 leftover: live freehand preview then commit.
// Live proof: debug/scenarios/e2e-freehand-live-stroke.spec.mjs
// Distinct from Width / swatch catalogs, 1-dot tap sample, leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('live preview + zoomGeneration flush + highlighter floor stay wired', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /const FREEHAND_CREATION_TOOLS = \['pen', 'highlighter'\]/);
  assert.match(layer, /className="freehand-creation-preview"/);
  assert.match(layer, /data-preview-tick=\{shapeCreation\.tick\}/);
  assert.match(layer, /shapeCreation\.tool === 'highlighter'\s*\n\s*\? highlightColor\s*\n\s*: composeAnnotationColor\(strokeColor, strokeOpacity\)/);
  assert.match(layer, /Math\.max\(Number\(strokeWidth\) \|\| 3, 8\)/);
  assert.match(layer, /mixBlendMode: 'multiply'/);
  assert.match(layer, /zoomGeneration/);
  assert.match(layer, /FREEHAND_CREATION_TOOLS\.includes\(state\.tool\)/);
  assert.match(layer, /commitShapeCreationRef\.current\(null\)/);
  assert.match(layer, /pointercancel/);
  assert.match(layer, /never commit partial work/);
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.doesNotMatch(layer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /setZoomGeneration\(prev => prev \+ 1\)/);
  assert.match(viewer, /beginPdfjsScaleConfirmPending/);

  const pen = buildFreehandCommitJSON({
    tool: 'pen',
    id: 'pen-live',
    points: [{ x: 10, y: 10 }, { x: 40, y: 18 }],
    strokeColor: '#ff0000',
    strokeWidth: 3,
  });
  assert.ok(pen);
  assert.notEqual(pen.globalCompositeOperation, 'multiply');

  const hi = buildFreehandCommitJSON({
    tool: 'highlighter',
    id: 'hi-live',
    points: [{ x: 10, y: 10 }, { x: 40, y: 18 }],
    strokeColor: '#ffff00',
    highlightColor: '#ffff00',
    strokeWidth: 4,
  });
  assert.ok(hi);
  assert.equal(hi.globalCompositeOperation, 'multiply');
  assert.equal(hi.sourceWidth, 8);

  const empty = buildFreehandCommitJSON({
    tool: 'pen',
    id: 'empty',
    points: [],
    strokeColor: '#ff0000',
    strokeWidth: 3,
  });
  assert.equal(empty, null);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers preview / commit / highlighter / zoom flush / cancel / 390 / file.id', () => {
  const spec = read('debug/scenarios/e2e-freehand-live-stroke.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop freehand live stroke intended \+ break \+ edge/);
  assert.match(spec, /390 freehand live stroke intended \+ break \+ edge/);
  assert.match(spec, /empty page live preview 0/);
  assert.match(spec, /empty Select drag invents 0/);
  assert.match(spec, /live freehand preview must paint before pointerup/);
  assert.match(spec, /Pen live drag must not commit yet/);
  assert.match(spec, /Pen pointerup must drop the preview/);
  assert.match(spec, /Pen pointerup must commit ink/);
  assert.match(spec, /Highlighter live preview uses multiply/);
  assert.match(spec, /Highlighter live preview floors Width 4 at 8/);
  assert.match(spec, /pointercancel must drop the preview/);
  assert.match(spec, /pointercancel must invent 0/);
  assert.match(spec, /zoom mid-stroke starts uncommitted/);
  assert.match(spec, /zoom mid-stroke must drop the preview/);
  assert.match(spec, /zoom flush \+ pointerup must not double-commit/);
  assert.match(spec, /390 Pen live drag must not commit yet/);
  assert.match(spec, /390 Highlighter live preview uses multiply/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});

test('live stroke is not Width catalog / rotate / leftover-18 hosts', () => {
  const spec = read('debug/scenarios/e2e-freehand-live-stroke.spec.mjs');
  assert.match(spec, /D-01 \/ D-02 leftover: live freehand preview then commit/);
  assert.match(spec, /Distinct from leftover-18/);
  assert.doesNotMatch(spec, /data-rotation-handle="mtr"|dragResizeHandle|Match fill/);
  assert.doesNotMatch(spec, /setActiveTool\('pan'\)|keyboard\.down\('Space'\)/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.doesNotMatch(layer, /file\.id\s*=/);
  assert.match(layer, /zoomGeneration/);
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
});
