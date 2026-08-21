import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLegacyArrowGroupTransform,
  isLegacyGroupArrow,
} from '../src/utils/legacyGroupArrow.js';

const VIEWER = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const PAL = readFileSync(new URL('../src/PageAnnotationLayer.jsx', import.meta.url), 'utf8');
const RENDERERS = readFileSync(
  new URL('../src/utils/svgAnnotationRenderers.jsx', import.meta.url),
  'utf8',
);

test('P1-25: identity group transform stays omitted', () => {
  assert.equal(
    buildLegacyArrowGroupTransform({ angle: 0, scaleX: 1, scaleY: 1 }, 0, 0, 100, 0),
    undefined,
  );
  assert.equal(buildLegacyArrowGroupTransform({}, 10, 10, 20, 20), undefined);
});

test('P1-25: angle and scale wrap around the shaft midpoint', () => {
  assert.equal(
    buildLegacyArrowGroupTransform({ angle: 45 }, 0, 0, 100, 0),
    'translate(50 0) rotate(45) translate(-50 0)',
  );
  assert.equal(
    buildLegacyArrowGroupTransform({ scaleX: 2, scaleY: 0.5 }, 10, 20, 30, 40),
    'translate(20 30) scale(2 0.5) translate(-20 -30)',
  );
  assert.match(RENDERERS, /buildLegacyArrowGroupTransform\(obj, x1, y1, x2, y2\)/);
});

test('P1-26: group + triangle children count as a legacy arrow', () => {
  assert.equal(isLegacyGroupArrow({ type: 'group', objects: [{ type: 'line' }, { type: 'triangle' }] }), true);
  assert.equal(isLegacyGroupArrow({ type: 'group', name: 'arrow', objects: [] }), true);
  assert.equal(isLegacyGroupArrow({ type: 'line', tool: 'arrow' }), false);
  assert.equal(isLegacyGroupArrow({ type: 'group', objects: [{ type: 'rect' }] }), false);
  assert.match(VIEWER, /isLegacyGroupArrow\(annotationData\)/);
  assert.match(VIEWER, /isLegacyGroupArrow\(annot\)/);
});

test('P1-27: circle is a fillable/editable toolbar type', () => {
  assert.match(VIEWER, /type !== 'ellipse' && type !== 'circle' && type !== 'path'/);
  assert.match(VIEWER, /type === 'ellipse' \|\| type === 'circle' \|\| type === 'textbox'/);
  assert.match(VIEWER, /type === 'ellipse' \|\| type === 'circle' \|\| type === 'path'/);
});

test('P1-22: erase approval plans page-object and text-markup deletes', () => {
  const start = VIEWER.indexOf('const requestAtomicEraseApproval = useCallback');
  const body = VIEWER.slice(start, start + 1800);
  assert.match(body, /collectEraseDeleteCandidateIds\(intent\)/);
  assert.match(body, /target\.domain === 'page-object'/);
  assert.match(body, /target\.domain === 'text-markup'/);
  assert.match(VIEWER, /approval\.plan && approval\.plan\.count > 0/);
});

test("KB-1 leftover: PAL skip does not fall through to whole-delete", () => {
  const start = PAL.indexOf('const eraserOp = getEraserOperation');
  assert.ok(start > -1, 'PAL names eraserOp');
  const body = PAL.slice(start, start + 400);
  assert.match(body, /eraserOp === 'skip'/);
  assert.match(body, /continue;/);
});
